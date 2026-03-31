'use strict';

const ir = require('./ir');
const { OP, JUMP_OPS, RET_OPS } = require('./opcodes');

function lift(disasmResult, fn, strings, fnStringMap) {
  const { instructions, labels, pcToIndex } = disasmResult;

  if (!instructions.length) {
    return { blocks: new Map(), entryBlock: 0, cfg: { successors: new Map(), predecessors: new Map() } };
  }

  // Step 1: Split into basic blocks
  const blocks = new Map();
  let currentBlock = null;

  for (let i = 0; i < instructions.length; i++) {
    const instr = instructions[i];

    if (labels.has(instr.pc) || !currentBlock) {
      if (currentBlock && !currentBlock.terminator) {
        currentBlock.terminator = { type: 'fallthrough', target: instr.pc };
      }
      currentBlock = { pc: instr.pc, instructions: [], stmts: [], terminator: null };
      blocks.set(instr.pc, currentBlock);
    }

    currentBlock.instructions.push(instr);

    if (instr.isTerminator) {
      if (instr.isReturn) {
        currentBlock.terminator = { type: 'return', instr };
      } else if (instr.isThrow) {
        currentBlock.terminator = { type: 'throw', instr };
      } else if (instr.jumpType === 'unconditional') {
        currentBlock.terminator = { type: 'jump', target: instr.jumpTarget };
      } else if (instr.jumpType === 'cond-false' || instr.jumpType === 'cond-true') {
        currentBlock.terminator = {
          type: instr.jumpType,
          target: instr.jumpTarget,
          fallthrough: (i + 1 < instructions.length) ? instructions[i + 1].pc : null,
          instr,
        };
      }
      currentBlock = null;
    }
  }

  // Step 2: Build CFG edges
  const successors = new Map();
  const predecessors = new Map();
  for (const [pc] of blocks) {
    successors.set(pc, []);
    predecessors.set(pc, []);
  }
  for (const [pc, blk] of blocks) {
    const term = blk.terminator;
    if (!term) continue;
    const addEdge = (target) => {
      if (target != null && blocks.has(target)) {
        successors.get(pc).push(target);
        predecessors.get(target).push(pc);
      }
    };
    if (term.type === 'jump' || term.type === 'fallthrough') addEdge(term.target);
    else if (term.type === 'cond-false' || term.type === 'cond-true') {
      addEdge(term.target);
      addEdge(term.fallthrough);
    }
  }

  // Step 3: Compute reverse postorder for worklist
  const visited = new Set();
  const rpo = [];
  function dfs(pc) {
    if (visited.has(pc)) return;
    visited.add(pc);
    for (const succ of (successors.get(pc) || [])) dfs(succ);
    rpo.push(pc);
  }
  const entryPC = instructions[0].pc;
  dfs(entryPC);
  rpo.reverse();

  // Step 4: Forward dataflow — propagate stack and register state
  // State: { stack: IRNode[], regs: {index: IRNode} }
  // At merge points with different stack heights, use PHI nodes.
  // PrimeVeil guarantees stacks are empty at most merge points,
  // so PHI is rarely needed — but we handle it for correctness.

  const entryState = { stack: [], regs: {} };
  const inStates = new Map();  // blockPC -> incoming state
  inStates.set(entryPC, entryState);

  let phiCounter = 0;

  function cloneState(st) {
    return { stack: st.stack.slice(), regs: Object.assign({}, st.regs) };
  }

  function mergeStates(existing, incoming, blockPC) {
    if (!existing) return cloneState(incoming);

    const merged = { stack: [], regs: {} };

    // Merge stacks: use shorter length, PHI for mismatches
    const len = Math.min(existing.stack.length, incoming.stack.length);
    for (let i = 0; i < len; i++) {
      const a = existing.stack[i];
      const b = incoming.stack[i];
      if (a === b || (a && b && a.type === b.type && a.type === 'Literal' && a.value === b.value)) {
        merged.stack.push(a);
      } else {
        merged.stack.push(ir.variable('phi_' + blockPC + '_' + (phiCounter++)));
      }
    }

    // Merge registers: keep values that match, PHI for conflicts
    const allRegs = new Set([...Object.keys(existing.regs), ...Object.keys(incoming.regs)]);
    for (const r of allRegs) {
      const a = existing.regs[r];
      const b = incoming.regs[r];
      if (a && b && a === b) merged.regs[r] = a;
      else if (a && !b) merged.regs[r] = a;
      else if (!a && b) merged.regs[r] = b;
      else merged.regs[r] = ir.variable('phi_r' + r + '_' + (phiCounter++));
    }

    return merged;
  }

  // Worklist: process blocks in RPO, propagate exit states to successors
  // Iterate until stable (max 4 passes for loops)
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;

    for (const pc of rpo) {
      const blk = blocks.get(pc);
      if (!blk) continue;

      const state = inStates.get(pc) || { stack: [], regs: {} };
      const exitState = executeBlock(blk, cloneState(state));

      // Propagate to successors
      for (const succ of (successors.get(pc) || [])) {
        const old = inStates.get(succ);
        const merged = mergeStates(old, exitState, succ);

        // Check if state changed
        if (!old || merged.stack.length !== old.stack.length ||
            Object.keys(merged.regs).length !== Object.keys(old.regs).length) {
          inStates.set(succ, merged);
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  // Step 5: Final pass — execute each block with propagated input state
  let unknownCounter = 0;

  for (const pc of rpo) {
    const blk = blocks.get(pc);
    if (!blk) continue;
    const state = inStates.get(pc) || { stack: [], regs: {} };
    executeBlockFinal(blk, cloneState(state));
  }

  // Also process unreachable blocks (not in RPO)
  for (const [pc, blk] of blocks) {
    if (!visited.has(pc)) {
      executeBlockFinal(blk, { stack: [], regs: {} });
    }
  }

  // Step 6: Attach lifted conditions/values to terminators
  for (const [pc, blk] of blocks) {
    const term = blk.terminator;
    if (!term) continue;

    // Attach branch condition from the lifted JF/JT
    if ((term.type === 'cond-false' || term.type === 'cond-true') && blk.conditionValue) {
      term.condition = blk.conditionValue;
    }

    // Attach return value
    if (term.type === 'return' && blk.returnValue) {
      term.value = blk.returnValue;
    }

    // Attach throw value
    if (term.type === 'throw' && blk.throwValue) {
      term.value = blk.throwValue;
    }
  }

  return { blocks, entryBlock: entryPC, cfg: { successors, predecessors } };

  // Execute a block symbolically, return exit state (for dataflow)
  function executeBlock(blk, state) {
    const stack = state.stack;
    const regs = state.regs;

    for (const instr of blk.instructions) {
      const info = OP.get(instr.opcode);
      if (!info) continue;
      applyInstruction(info, instr, stack, regs, null);
    }

    return { stack, regs };
  }

  // Execute a block and emit IR (final pass)
  function executeBlockFinal(blk, state) {
    const stack = state.stack;
    const regs = state.regs;
    const stmts = [];

    function pop() {
      if (stack.length === 0) return ir.variable('stk_' + blk.pc + '_' + (unknownCounter++));
      return stack.pop();
    }
    function push(val) { stack.push(val); }
    function emit(stmt) { stmts.push(stmt); }

    for (const instr of blk.instructions) {
      const info = OP.get(instr.opcode);
      if (!info) {
        emit(ir.exprStmt(ir.literal('/* unknown opcode ' + instr.opcode + ' */')));
        continue;
      }
      applyInstructionFull(info, instr, stack, regs, pop, push, emit, blk);
    }

    blk.stmts = stmts;
    blk.exitStack = stack.slice();
    blk.exitRegs = Object.assign({}, regs);
  }

  // Lightweight instruction simulation for dataflow (no IR emission)
  function applyInstruction(info, instr, stack, regs, _) {
    const name = info.name;
    const operands = instr.operands || [];

    // Register 3-op: no stack effect
    if (info.r3 && info.op && operands.length >= 3) {
      regs[operands[0]] = ir.literal(0); // placeholder
      return;
    }

    // Context ops with pushes
    if ((name === 'CX' || name === 'CX_PUSH') && info.pushes === 1) {
      stack.push(ir.variable('__cx'));
      return;
    }

    // Fixed-effect opcodes: pop N, push M
    if (typeof info.pops === 'number' && info.pops >= 0) {
      for (let i = 0; i < info.pops && stack.length > 0; i++) stack.pop();
      for (let i = 0; i < (info.pushes || 0); i++) stack.push(ir.literal(0));
      return;
    }

    // Variable-pop opcodes (CALL, MCALL, NEW, ARR_NEW, OBJ_SPREAD)
    if (info.pops === 'N') {
      const argc = instr.argCount || 0;
      // CALL: pops argc + fn + this = argc + 2
      // MCALL: pops argc + method + obj = argc + 2
      // NEW: pops argc + constructor = argc + 1
      // ARR_NEW: pops argc elements
      let totalPops = argc;
      if (name === 'CALL') totalPops = argc + 2;
      else if (name === 'MCALL') totalPops = argc + 2;
      else if (name === 'NEW') totalPops = argc + 1;

      for (let i = 0; i < totalPops && stack.length > 0; i++) stack.pop();
      for (let i = 0; i < (info.pushes || 0); i++) stack.push(ir.literal(0));
      return;
    }
  }

  // Full instruction processing with IR emission
  function applyInstructionFull(info, instr, stack, regs, pop, push, emit, blk) {
    const name = info.name;
    const operands = instr.operands || [];

    // Literals
    if (name === 'PUSH_0') { push(ir.literal(0)); return; }
    if (name === 'PUSH_1') { push(ir.literal(1)); return; }
    if (name === 'PUSH_N1') { push(ir.literal(-1)); return; }
    if (name === 'PUSH_TRUE') { push(ir.literal(true)); return; }
    if (name === 'PUSH_FALSE') { push(ir.literal(false)); return; }
    if (name === 'PUSH_NULL') { push(ir.literal(null)); return; }
    if (name === 'PUSH_UNDEF') { push(ir.literal(undefined)); return; }

    // Constants
    if (name === 'PUSH_CONST') {
      if (instr.fnRef) push(ir.variable(instr.fnRef));
      else if (instr.resolvedString != null && typeof instr.resolvedString !== 'function' && !(typeof instr.resolvedString === 'string' && instr.resolvedString.length > 200))
        push(ir.literal(instr.resolvedString));
      else push(ir.literal(operands[0]));
      return;
    }
    if (name === 'LOAD_CONST') {
      const regIdx = operands[0];
      if (instr.fnRef) regs[regIdx] = ir.variable(instr.fnRef);
      else if (instr.resolvedString != null && typeof instr.resolvedString !== 'function' && !(typeof instr.resolvedString === 'string' && instr.resolvedString.length > 200))
        regs[regIdx] = ir.literal(instr.resolvedString);
      else regs[regIdx] = ir.literal(operands[1]);
      return;
    }

    // Register 3-op
    if (info.r3 && info.op && operands.length >= 3) {
      const src1 = regs[operands[1]] || ir.reg(operands[1]);
      const src2 = regs[operands[2]] || ir.reg(operands[2]);
      regs[operands[0]] = ir.binOp(info.op, src1, src2);
      return;
    }

    // Stack binary ops
    if (info.pops === 2 && info.pushes === 1 && info.op) {
      const right = pop();
      const left = pop();
      push(info.op === '&&' ? ir.logicalOp('&&', left, right) : ir.binOp(info.op, left, right));
      return;
    }

    // Unary
    if (name === 'NOT') { push(ir.unaryOp('!', pop())); return; }
    if (name === 'BITNOT') { push(ir.unaryOp('~', pop())); return; }
    if (name === 'NEG') { push(ir.unaryOp('-', pop())); return; }
    if (name === 'TYPEOF') { push(ir.typeofExpr(pop())); return; }
    if (name === 'TYPEOF_C' || name === 'TYPEOF_VAR') {
      let v = instr.fnRef || instr.varName;
      if (!v || typeof v !== 'string' || v.length > 100) v = 'var_' + operands[0];
      push(ir.typeofExpr(ir.variable(v)));
      return;
    }
    if (name === 'IS_NULLISH') { push(ir.nullishCheck(pop())); return; }

    // Property
    if (name === 'PGET') { const k = pop(), o = pop(); push(ir.propGet(o, k)); return; }
    if (name === 'PSET' || name === 'PSET_TRY') {
      const v = pop(), k = pop(), o = pop();
      emit(ir.exprStmt(ir.propSet(o, k, v)));
      return;
    }
    if (name === 'DEF_GETTER') {
      const g = pop(), k = pop(), o = pop();
      push(ir.call(ir.propGet(ir.variable('Object'), ir.literal('defineProperty')), [o, k, ir.objectExpr([{key: ir.literal('get'), value: g}])]));
      return;
    }
    if (name === 'DEF_SETTER') {
      const s = pop(), k = pop(), o = pop();
      push(ir.call(ir.propGet(ir.variable('Object'), ir.literal('defineProperty')), [o, k, ir.objectExpr([{key: ir.literal('set'), value: s}])]));
      return;
    }
    if (name === 'DEL') { const k = pop(), o = pop(); push(ir.unaryOp('delete', ir.propGet(o, k))); return; }

    // Call / New
    if (name === 'CALL') {
      const argc = instr.argCount || 0;
      const args = []; for (let i = 0; i < argc; i++) args.unshift(pop());
      const callee = pop(), thisArg = pop();
      push(ir.call(callee, args, thisArg));
      return;
    }
    if (name === 'MCALL') {
      const argc = instr.argCount || 0;
      const args = []; for (let i = 0; i < argc; i++) args.unshift(pop());
      const method = pop(), obj = pop();
      push(ir.methodCall(obj, method, args));
      return;
    }
    if (name === 'NEW') {
      const argc = instr.argCount || 0;
      const args = []; for (let i = 0; i < argc; i++) args.unshift(pop());
      push(ir.newExpr(pop(), args));
      return;
    }

    // Scope
    if (name === 'THIS') { push(ir.thisExpr()); return; }
    if (name === 'MODULE') { push(ir.variable('module')); return; }
    if (name === 'LD_VAR' || name === 'GET_VAR') {
      push(ir.variable(instr.varName || ('var_' + operands[0])));
      return;
    }
    if (name === 'SET_VAR') { emit(ir.assign(ir.variable(instr.varName || ('var_' + operands[0])), pop())); return; }
    if (name === 'INC_VAR') {
      emit(ir.varIncrement(instr.varName || ('var_' + operands[0])));
      if (info.pushes === 1) push(ir.variable(instr.varName || ('var_' + operands[0])));
      return;
    }
    if (name === 'SC_PROP') { push(ir.variable('scope_' + operands[0])); return; }
    if (name === 'SC_GET') { push(ir.propGet(pop(), ir.literal('value'))); return; }
    if (name === 'SC_SET') { const v = pop(), s = pop(); emit(ir.exprStmt(ir.propSet(s, ir.literal('value'), v))); push(v); return; }
    if (name === 'SC_SET2') { const v = pop(), s = pop(); emit(ir.exprStmt(ir.propSet(s, ir.literal('value'), v))); return; }
    if (name === 'LD_SC_R') { return; } // noop — loads scope ref into register (handled by register state)

    // Stack manipulation
    if (name === 'DUP') { const t = stack.length > 0 ? stack[stack.length - 1] : ir.literal(undefined); push(t); return; }
    if (name === 'POP') {
      const v = pop();
      if (v.type === 'Call' || v.type === 'MethodCall' || v.type === 'New' || v.type === 'PropSet' || v.type === 'Assign')
        emit(ir.exprStmt(v));
      return;
    }
    if (name === 'SPREAD') { push(ir.spreadExpr(pop())); return; }
    if (name === 'OBJ_SPREAD') {
      const count = instr.argCount || 0;
      const props = []; for (let i = 0; i < count; i++) { const v = pop(), k = pop(); props.unshift({key: k, value: v}); }
      push(ir.objectExpr(props));
      return;
    }

    // Array
    if (name === 'ARR_NEW') {
      const count = instr.argCount || 0;
      const els = []; for (let i = 0; i < count; i++) els.unshift(pop());
      push(ir.arrayExpr(els));
      return;
    }

    // Register
    if (name === 'LD_REG') { push(regs[operands[0]] || ir.reg(operands[0])); return; }
    if (name === 'STORE_REG') { regs[operands[0]] = pop(); return; }

    // Iterator
    if (name === 'ITER_NX') { push(ir.methodCall(pop(), ir.literal('next'), [])); return; }
    if (name === 'FORIN') {
      const obj = pop();
      push(ir.call(ir.propGet(ir.variable('Object'), ir.literal('keys')), [obj]));
      push(ir.literal(0));
      return;
    }

    // Control flow
    if (name === 'RET' || name === 'RET_EX') { blk.returnValue = pop(); return; }
    if (name === 'THROW') { blk.throwValue = pop(); return; }
    if (name === 'YIELD') { emit(ir.yieldStmt(pop())); return; }
    if (name === 'JF' || name === 'JT') { blk.conditionValue = pop(); return; }
    if (name === 'JMP') { return; }

    // Exception
    if (name === 'TRY') { emit(ir.exprStmt(ir.literal('/* try { */'))); return; }
    if (name === 'TRY_END') { emit(ir.exprStmt(ir.literal('/* } end try */'))); return; }

    // Context
    if (name === 'CX' || name === 'CX_PUSH') {
      if (info.pushes === 1) push(ir.variable('ctx_' + blk.pc));
      return;
    }

    // Multi / NOP / AT
    if (name === 'MULTI' || name === 'NOP' || name === 'AT') { return; }

    // Generic fallback based on declared pops/pushes
    if (typeof info.pops === 'number') {
      for (let i = 0; i < info.pops; i++) pop();
      for (let i = 0; i < (info.pushes || 0); i++) push(ir.variable('result_' + instr.pc));
      return;
    }

    emit(ir.exprStmt(ir.literal('/* unhandled: ' + name + ' */')));
  }
}

module.exports = { lift };
