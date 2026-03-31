'use strict';

const ir = require('./ir');

/**
 * Recover structured control flow from CFG using dominator analysis.
 */
function structure(liftResult) {
  const { blocks, entryBlock, cfg } = liftResult;
  const { successors, predecessors } = cfg;

  if (blocks.size === 0) {
    return ir.block([]);
  }

  // ---- Step 0: Compute reverse postorder ----
  const rpo = [];
  const visited = new Set();

  function dfsRPO(pc) {
    if (visited.has(pc)) return;
    visited.add(pc);
    for (const succ of (successors.get(pc) || [])) {
      dfsRPO(succ);
    }
    rpo.push(pc);
  }
  dfsRPO(entryBlock);
  rpo.reverse();

  const allBlocks = new Set(rpo);

  // Prune unreachable blocks — they produce stk_ noise and goto clutter
  for (const [pc] of blocks) {
    if (!allBlocks.has(pc)) {
      blocks.delete(pc);
      successors.delete(pc);
      predecessors.delete(pc);
    }
  }
  // Clean predecessor lists to remove references to pruned blocks
  for (const [pc, preds] of predecessors) {
    predecessors.set(pc, preds.filter(p => allBlocks.has(p)));
  }

  // ---- Step 1: Compute dominators (iterative fixed-point) ----
  const dom = new Map();
  dom.set(entryBlock, new Set([entryBlock]));
  for (const b of allBlocks) {
    if (b !== entryBlock) {
      dom.set(b, new Set(allBlocks));
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const b of rpo) {
      if (b === entryBlock) continue;
      const preds = predecessors.get(b) || [];
      if (preds.length === 0) continue;

      let newDom = null;
      for (const p of preds) {
        if (!dom.has(p)) continue;
        if (newDom === null) {
          newDom = new Set(dom.get(p));
        } else {
          // Intersect
          for (const d of newDom) {
            if (!dom.get(p).has(d)) newDom.delete(d);
          }
        }
      }
      if (newDom === null) newDom = new Set();
      newDom.add(b);

      const oldDom = dom.get(b);
      if (!setsEqual(oldDom, newDom)) {
        dom.set(b, newDom);
        changed = true;
      }
    }
  }

  // Compute immediate dominator: idom(b) = the strict dominator of b
  // that is dominated by all other strict dominators of b
  // Equivalently: the strict dominator with the largest dominator set size
  // (closest to b in the dominator tree)
  const rpoIndex = new Map();
  for (let i = 0; i < rpo.length; i++) rpoIndex.set(rpo[i], i);

  const idom = new Map();
  for (const b of allBlocks) {
    if (b === entryBlock) continue;
    const doms = dom.get(b);
    if (!doms || doms.size <= 1) continue;

    // idom = the strict dominator of b that appears latest in RPO
    // (i.e. closest to b in the CFG)
    let best = null;
    let bestIdx = -1;
    for (const d of doms) {
      if (d === b) continue;
      const idx = rpoIndex.get(d);
      if (idx !== undefined && idx > bestIdx) {
        bestIdx = idx;
        best = d;
      }
    }
    if (best != null) idom.set(b, best);
  }

  // ---- Step 2: Compute post-dominators on reverse CFG ----
  // Build reverse CFG
  const revSucc = new Map();
  const revPred = new Map();
  const exitBlocks = [];

  for (const b of allBlocks) {
    revSucc.set(b, []);
    revPred.set(b, []);
  }
  for (const b of allBlocks) {
    const succs = successors.get(b) || [];
    if (succs.length === 0) exitBlocks.push(b);
    for (const s of succs) {
      if (allBlocks.has(s)) {
        revSucc.get(s).push(b);
        revPred.get(b).push(s);
      }
    }
  }

  // Add virtual exit node
  const VEXIT = -1;
  revSucc.set(VEXIT, exitBlocks.slice());
  revPred.set(VEXIT, []);
  for (const e of exitBlocks) {
    revPred.get(e).push(VEXIT);
  }

  // Reverse RPO from VEXIT
  const revRPO = [];
  const revVisited = new Set();
  function dfsRevRPO(pc) {
    if (revVisited.has(pc)) return;
    revVisited.add(pc);
    for (const s of (revSucc.get(pc) || [])) {
      dfsRevRPO(s);
    }
    revRPO.push(pc);
  }
  dfsRevRPO(VEXIT);
  revRPO.reverse();

  const allWithExit = new Set(revRPO);
  const pdom = new Map();
  pdom.set(VEXIT, new Set([VEXIT]));
  for (const b of allWithExit) {
    if (b !== VEXIT) pdom.set(b, new Set(allWithExit));
  }

  changed = true;
  while (changed) {
    changed = false;
    for (const b of revRPO) {
      if (b === VEXIT) continue;
      const preds = revPred.get(b) || [];
      if (preds.length === 0) continue;
      let newPdom = null;
      for (const p of preds) {
        if (!pdom.has(p)) continue;
        if (newPdom === null) {
          newPdom = new Set(pdom.get(p));
        } else {
          for (const d of newPdom) {
            if (!pdom.get(p).has(d)) newPdom.delete(d);
          }
        }
      }
      if (newPdom === null) newPdom = new Set();
      newPdom.add(b);
      if (!setsEqual(pdom.get(b), newPdom)) {
        pdom.set(b, newPdom);
        changed = true;
      }
    }
  }

  // Immediate post-dominator
  const revRpoIndex = new Map();
  for (let i = 0; i < revRPO.length; i++) revRpoIndex.set(revRPO[i], i);

  const ipdom = new Map();
  for (const b of allBlocks) {
    const pdoms = pdom.get(b);
    if (!pdoms || pdoms.size <= 1) continue;
    let best = null;
    let bestIdx = -1;
    for (const d of pdoms) {
      if (d === b || d === VEXIT) continue;
      const idx = revRpoIndex.get(d);
      if (idx !== undefined && idx > bestIdx) {
        bestIdx = idx;
        best = d;
      }
    }
    if (best != null) ipdom.set(b, best);
  }

  // ---- Step 3: Detect loops (back edges) ----
  const loops = []; // { header, body: Set, backEdge }
  for (const b of allBlocks) {
    for (const s of (successors.get(b) || [])) {
      // Back edge: b -> s where s dominates b
      if (dom.get(b) && dom.get(b).has(s)) {
        // Natural loop: all blocks that can reach b without going through s
        const loopBody = new Set([s]);
        const worklist = [b];
        while (worklist.length) {
          const n = worklist.pop();
          if (loopBody.has(n)) continue;
          loopBody.add(n);
          for (const p of (predecessors.get(n) || [])) {
            if (!loopBody.has(p)) worklist.push(p);
          }
        }
        loops.push({ header: s, backEdgeSrc: b, body: loopBody });
      }
    }
  }

  // ---- Step 4: Structure recovery ----
  const structured = new Set(); // blocks already structured
  const result = structureRegion(entryBlock, null);

  function structureRegion(startPC, endPC) {
    const stmts = [];
    let current = startPC;
    const regionVisited = new Set();

    while (current != null && !regionVisited.has(current) && current !== endPC) {
      regionVisited.add(current);

      if (structured.has(current)) {
        stmts.push(ir.gotoStmt('L_' + current));
        break;
      }

      const blk = blocks.get(current);
      if (!blk) break;

      // Check if this is a loop header
      const loop = loops.find(l => l.header === current && !structured.has(current));
      if (loop) {
        const loopStmt = structureLoop(loop);
        if (loopStmt) {
          stmts.push(loopStmt);
          // Continue after the loop
          const loopExits = findLoopExits(loop);
          if (loopExits.length === 1) {
            current = loopExits[0];
            continue;
          } else if (loopExits.length > 1) {
            // Pick the post-dominator as continuation
            current = ipdom.get(current) || null;
            continue;
          }
          break;
        }
      }

      structured.add(current);

      // Emit block statements
      for (const stmt of blk.stmts) {
        stmts.push(stmt);
      }

      const term = blk.terminator;
      if (!term) break;

      if (term.type === 'return') {
        stmts.push(ir.returnStmt(term.value || null));
        break;
      }

      if (term.type === 'throw') {
        stmts.push(ir.throwStmt(term.value || ir.literal(null)));
        break;
      }

      if (term.type === 'jump' || term.type === 'fallthrough') {
        current = term.target;
        continue;
      }

      if (term.type === 'cond-false' || term.type === 'cond-true') {
        const ifStmt = structureIf(current, blk, term);
        if (ifStmt) {
          stmts.push(ifStmt.node);
          current = ifStmt.merge;
          continue;
        }
        // Fallback: goto
        const cond = term.condition || ir.literal(true);
        stmts.push(ir.ifStmt(cond,
          ir.block([ir.gotoStmt('L_' + term.target)]),
          null
        ));
        current = term.fallthrough;
        continue;
      }

      break;
    }

    return ir.block(stmts);
  }

  function structureLoop(loop) {
    const { header, backEdgeSrc, body } = loop;
    const blk = blocks.get(header);
    if (!blk) return null;

    // Mark all loop body blocks as structured
    for (const b of body) structured.add(b);

    const term = blk.terminator;

    // While loop: header has conditional exit
    if (term && (term.type === 'cond-false' || term.type === 'cond-true')) {
      let condExpr = term.condition || ir.literal(true);
      let exitTarget, bodyTarget;

      if (term.type === 'cond-false') {
        // JF: jump if false → exit is jump target, body is fallthrough
        exitTarget = term.target;
        bodyTarget = term.fallthrough;
      } else {
        // JT: jump if true → body is jump target, exit is fallthrough
        bodyTarget = term.target;
        exitTarget = term.fallthrough;
      }

      // If exit is outside loop, this is a while(cond) loop
      if (!body.has(exitTarget)) {
        const bodyBlock = structureRegion(bodyTarget, header);
        const headerStmts = blk.stmts.length > 0 ? ir.block([...blk.stmts.map(s => s)]) : null;

        let whileBody;
        if (headerStmts && headerStmts.body.length > 0) {
          whileBody = ir.block([...headerStmts.body, ...bodyBlock.body]);
        } else {
          whileBody = bodyBlock;
        }

        if (term.type === 'cond-false') {
          // JF means "jump if condition is false" → while(condition)
          return ir.whileStmt(condExpr, whileBody);
        } else {
          return ir.whileStmt(condExpr, whileBody);
        }
      }
    }

    // Do-while: back-edge source has condition
    const backBlk = blocks.get(backEdgeSrc);
    if (backBlk && backBlk.terminator &&
        (backBlk.terminator.type === 'cond-false' || backBlk.terminator.type === 'cond-true')) {
      const condExpr = backBlk.terminator.condition || ir.literal(true);
      const bodyBlock = structureRegion(header, backEdgeSrc);
      // Include backEdgeSrc statements
      const backStmts = backBlk.stmts || [];
      const fullBody = ir.block([...bodyBlock.body, ...backStmts]);
      return ir.doWhileStmt(fullBody, condExpr);
    }

    // Infinite loop fallback
    const bodyBlock = structureRegion(header, null);
    return ir.whileStmt(ir.literal(true), bodyBlock);
  }

  function structureIf(pc, blk, term) {
    const cond = term.condition || ir.literal(true);
    const merge = ipdom.get(pc);

    let thenTarget, elseTarget;
    if (term.type === 'cond-false') {
      // JF: false → jump, true → fallthrough
      elseTarget = term.target;
      thenTarget = term.fallthrough;
    } else {
      // JT: true → jump, false → fallthrough
      thenTarget = term.target;
      elseTarget = term.fallthrough;
    }

    // Structure then branch up to merge point
    const thenBody = (thenTarget != null && thenTarget !== merge)
      ? structureRegion(thenTarget, merge)
      : ir.block([]);

    const elseBody = (elseTarget != null && elseTarget !== merge)
      ? structureRegion(elseTarget, merge)
      : null;

    // Skip empty else
    const hasElse = elseBody && elseBody.body && elseBody.body.length > 0;

    return {
      node: ir.ifStmt(cond, thenBody, hasElse ? elseBody : null),
      merge: merge || null,
    };
  }

  function findLoopExits(loop) {
    const exits = [];
    for (const b of loop.body) {
      for (const s of (successors.get(b) || [])) {
        if (!loop.body.has(s)) exits.push(s);
      }
    }
    return [...new Set(exits)];
  }

  // Remaining unstructured but reachable blocks → labeled fallback
  for (const pc of rpo) {
    if (structured.has(pc)) continue;
    const blk = blocks.get(pc);
    if (!blk) continue;
    const labeledStmts = [...blk.stmts];
    const term = blk.terminator;
    if (term) {
      if (term.type === 'return') labeledStmts.push(ir.returnStmt(term.value || null));
      else if (term.type === 'throw') labeledStmts.push(ir.throwStmt(term.value || ir.literal(null)));
      else if (term.type === 'jump') labeledStmts.push(ir.gotoStmt('L_' + term.target));
      else if (term.type === 'cond-false' || term.type === 'cond-true') {
        const c = term.condition || ir.literal(true);
        labeledStmts.push(ir.ifStmt(c, ir.block([ir.gotoStmt('L_' + term.target)]), null));
        if (term.fallthrough != null) labeledStmts.push(ir.gotoStmt('L_' + term.fallthrough));
      }
    }
    if (labeledStmts.length > 0) {
      result.body.push(ir.labeledBlock('L_' + pc, ir.block(labeledStmts)));
    }
  }

  // Detect try/catch from TRY instructions
  result.body = wrapTryCatch(result.body, blocks);

  return result;
}

/**
 * Post-pass: detect try/catch patterns and wrap statements.
 */
function wrapTryCatch(stmts, blocks) {
  // Simple heuristic: look for /* try { */ and /* } end try */ markers
  const result = [];
  let i = 0;
  while (i < stmts.length) {
    const s = stmts[i];
    if (s.type === 'ExprStmt' && s.expression && s.expression.type === 'Literal' &&
        typeof s.expression.value === 'string' && s.expression.value.includes('try {')) {
      // Find matching end try
      let depth = 1;
      let j = i + 1;
      while (j < stmts.length && depth > 0) {
        const s2 = stmts[j];
        if (s2.type === 'ExprStmt' && s2.expression && s2.expression.type === 'Literal') {
          if (typeof s2.expression.value === 'string') {
            if (s2.expression.value.includes('try {')) depth++;
            if (s2.expression.value.includes('end try')) depth--;
          }
        }
        if (depth > 0) j++;
      }
      const tryBody = ir.block(stmts.slice(i + 1, j));
      result.push(ir.tryCatch(tryBody, 'e', ir.block([]), null));
      i = j + 1;
    } else {
      result.push(s);
      i++;
    }
  }
  return result;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

module.exports = { structure };
