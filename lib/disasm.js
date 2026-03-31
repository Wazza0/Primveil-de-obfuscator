'use strict';

const { OP, STR_IDX, JUMP_OPS, RET_OPS } = require('./opcodes');

/**
 * Enrich raw instructions with mnemonic, category, resolved strings, jump targets, etc.
 */
function disasm(instructions, strings, fnStringMap) {
  const enriched = [];
  const labels = new Set();
  const pcToIndex = new Map();

  for (let idx = 0; idx < instructions.length; idx++) {
    const instr = instructions[idx];
    const { pc, opcode, operands } = instr;
    const info = OP.get(opcode);

    pcToIndex.set(pc, idx);

    const entry = {
      pc,
      index: idx,
      opcode,
      operands: operands || [],
      mnemonic: info ? info.name : ('UNK_' + opcode),
      category: info ? info.category : 'unknown',
      pops: info ? info.pops : 0,
      pushes: info ? info.pushes : 0,
      r3: info ? info.r3 : false,
      op: info ? info.op : null,
      jumpType: info ? info.jumpType : null,
      jumpTarget: null,
      resolvedString: null,
      isTerminator: false,
      isJump: false,
      isReturn: false,
      isThrow: false,
    };

    // Jump target resolution
    if (JUMP_OPS.has(opcode) && operands.length >= 2) {
      entry.jumpTarget = ((operands[0] << 8) | operands[1]) & 0xFFFF;
      entry.isJump = true;
      entry.isTerminator = true;
      labels.add(entry.jumpTarget);
    }

    // Unconditional jumps are terminators
    if (entry.jumpType === 'unconditional') {
      entry.isTerminator = true;
    }

    // Conditional jumps: fallthrough is also a successor
    if (entry.jumpType === 'cond-true' || entry.jumpType === 'cond-false') {
      entry.isTerminator = true;
    }

    // Returns
    if (RET_OPS.has(opcode)) {
      entry.isReturn = true;
      entry.isTerminator = true;
    }

    // Throw
    if (opcode === 119) {
      entry.isThrow = true;
      entry.isTerminator = true;
    }

    // Yield
    if (opcode === 83) {
      entry.isTerminator = false; // yield resumes
    }

    // String resolution for PUSH_CONST (49)
    if (opcode === 49 && operands.length >= 1) {
      const strIdx = STR_IDX(operands[0]);
      // Check fnStringMap FIRST — maps str index to function source name
      if (fnStringMap[strIdx] !== undefined) {
        entry.resolvedString = fnStringMap[strIdx];
        entry.fnRef = fnStringMap[strIdx];
      } else if (strIdx >= 0 && strIdx < strings.length && strings[strIdx] != null) {
        const val = strings[strIdx];
        // Skip function source strings (closure builders)
        if (typeof val === 'function' || (typeof val === 'string' && val.length > 200)) {
          entry.resolvedString = null; // too long / function source — not a real constant
        } else {
          entry.resolvedString = val;
        }
      }
    }

    // String resolution for LOAD_CONST (140, 159) — register, string index
    if ((opcode === 140 || opcode === 159) && operands.length >= 2) {
      const strIdx = STR_IDX(operands[1]);
      if (fnStringMap[strIdx] !== undefined) {
        entry.resolvedString = fnStringMap[strIdx];
        entry.fnRef = fnStringMap[strIdx];
      } else if (strIdx >= 0 && strIdx < strings.length && strings[strIdx] != null) {
        const val = strings[strIdx];
        if (typeof val === 'function' || (typeof val === 'string' && val.length > 200)) {
          entry.resolvedString = null;
        } else {
          entry.resolvedString = val;
        }
      }
      entry.targetRegister = operands[0];
    }

    // Variable name resolution for scope ops and typeof
    if ((opcode === 84 || opcode === 234 || opcode === 108 ||
         opcode === 136 || opcode === 236 || opcode === 46 ||
         opcode === 235 || opcode === 157 || opcode === 38 || opcode === 73) && operands.length >= 1) {
      const strIdx = STR_IDX(operands[0]);
      if (fnStringMap[strIdx] !== undefined) {
        // Function reference — use the function's source name
        entry.varName = fnStringMap[strIdx];
      } else if (strIdx >= 0 && strIdx < strings.length && strings[strIdx] != null) {
        const val = strings[strIdx];
        // Only use as varName if it's a valid JS identifier
        if (typeof val === 'string' && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(val) && val.length < 50) {
          entry.varName = val;
        }
        // Numbers, booleans, long strings, special chars → NOT variable names
        // These are scope slot indices — use var_N
      }
    }

    // TYPEOF_C string resolution — only use valid identifiers
    if ((opcode === 38 || opcode === 73) && operands.length >= 1) {
      const strIdx = STR_IDX(operands[0]);
      if (fnStringMap[strIdx] !== undefined) {
        entry.varName = fnStringMap[strIdx];
      } else if (strIdx >= 0 && strIdx < strings.length) {
        const val = strings[strIdx];
        if (typeof val === 'string' && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(val) && val.length < 50) {
          entry.varName = val;
        }
      }
    }

    // TRY — catch target
    if (opcode === 51 && operands.length >= 1) {
      entry.catchTarget = operands[0];
      labels.add(entry.catchTarget);
    }

    // ARR_NEW, CALL, MCALL, NEW — arg count
    if (opcode === 10 || opcode === 33 || opcode === 16 ||
        opcode === 158 || opcode === 53 || opcode === 96 ||
        opcode === 100) {
      entry.argCount = operands.length > 0 ? operands[0] : 0;
    }

    // LD_REG — register index
    if (opcode === 42 && operands.length >= 1) {
      entry.regIndex = operands[0];
    }

    // STORE_REG — register index
    if (opcode === 141 && operands.length >= 1) {
      entry.regIndex = operands[0];
    }

    enriched.push(entry);
  }

  // Add entry point label
  labels.add(0);

  // Add fallthrough labels: instruction after a terminator
  for (let i = 0; i < enriched.length; i++) {
    if (enriched[i].isTerminator && i + 1 < enriched.length) {
      labels.add(enriched[i + 1].pc);
    }
  }

  return {
    instructions: enriched,
    labels,
    pcToIndex,
    strings,
    fnStringMap,
  };
}

/**
 * Format a single instruction as a human-readable string.
 */
function formatInstr(instr) {
  let s = `${String(instr.pc).padStart(5)} | ${instr.mnemonic}`;
  if (instr.operands.length) s += ' ' + instr.operands.join(', ');
  if (instr.jumpTarget != null) s += ` -> L_${instr.jumpTarget}`;
  if (instr.resolvedString != null) s += ` ; "${truncStr(instr.resolvedString)}"`;
  if (instr.varName != null) s += ` ; var:${instr.varName}`;
  return s;
}

function truncStr(s, max) {
  max = max || 40;
  if (typeof s !== 'string') return String(s);
  return s.length > max ? s.slice(0, max) + '...' : s;
}

/**
 * Dump full disassembly as string.
 */
function dumpDisasm(result) {
  const lines = [];
  for (const instr of result.instructions) {
    const prefix = result.labels.has(instr.pc) ? `L_${instr.pc}:` : '      ';
    lines.push(prefix + ' ' + formatInstr(instr));
  }
  return lines.join('\n');
}

module.exports = { disasm, formatInstr, dumpDisasm };
