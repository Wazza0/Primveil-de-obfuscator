'use strict';

const ir = require('./ir');

/**
 * Normalize IR: remove no-ops, fold constants, sanitize names,
 * clean up before structuring and emission.
 */
function normalize(structured) {
  if (!structured || !structured.body) return structured;
  for (let pass = 0; pass < 5; pass++) {
    const before = JSON.stringify(structured.body).length;
    structured.body = cleanStatements(structured.body);
    structured.body = eliminateGotos(structured.body);
    const after = JSON.stringify(structured.body).length;
    if (after === before) break;
  }
  return structured;
}

function eliminateGotos(stmts) {
  if (!Array.isArray(stmts)) return stmts;
  const result = [];

  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    if (!s) continue;

    // Pattern 1: goto L_X followed by L_X: { ... } → remove goto, unwrap label
    if (s.type === 'Goto' && i + 1 < stmts.length) {
      const next = stmts[i + 1];
      if (next && next.type === 'LabeledBlock' && next.label === s.label) {
        continue;
      }
    }

    // Pattern 2: goto that targets a labeled block appearing later at same level
    if (s.type === 'Goto') {
      const targetLabel = s.label;
      // Check if the target label exists later in this statement list
      let found = false;
      for (let j = i + 1; j < stmts.length; j++) {
        if (stmts[j] && stmts[j].type === 'LabeledBlock' && stmts[j].label === targetLabel) {
          found = true;
          break;
        }
      }
      if (found) {
        // This goto jumps forward to a label at the same level — it's a fallthrough
        continue;
      }
    }

    // Pattern 3: if(cond) { goto L_X } → if(cond) goto is fine, but if the goto
    // target is the immediate next sibling, it's a no-op
    if (s.type === 'If' && s.consequent) {
      const thenBody = s.consequent.type === 'Block' ? s.consequent.body : [s.consequent];
      if (thenBody.length === 1 && thenBody[0].type === 'Goto') {
        const target = thenBody[0].label;
        // Check if target is the next sibling
        if (i + 1 < stmts.length && stmts[i + 1] && stmts[i + 1].type === 'LabeledBlock' && stmts[i + 1].label === target) {
          // if(cond) { goto next } → skip (the condition was irrelevant)
          continue;
        }
      }
    }

    // Recurse into nested structures
    if (s.type === 'Block' && s.body) s.body = eliminateGotos(s.body);
    if (s.type === 'If') {
      if (s.consequent && s.consequent.body) s.consequent.body = eliminateGotos(s.consequent.body);
      if (s.alternate && s.alternate.body) s.alternate.body = eliminateGotos(s.alternate.body);
    }
    if (s.type === 'While' && s.body && s.body.body) s.body.body = eliminateGotos(s.body.body);
    if (s.type === 'DoWhile' && s.body && s.body.body) s.body.body = eliminateGotos(s.body.body);
    if (s.type === 'LabeledBlock' && s.body && s.body.body) s.body.body = eliminateGotos(s.body.body);
    if (s.type === 'TryCatch') {
      if (s.tryBlock && s.tryBlock.body) s.tryBlock.body = eliminateGotos(s.tryBlock.body);
      if (s.catchBlock && s.catchBlock.body) s.catchBlock.body = eliminateGotos(s.catchBlock.body);
    }

    result.push(s);
  }

  // Remove orphan labeled blocks
  const usedLabels = new Set();
  collectLabels(result, usedLabels);
  return result.flatMap(s => {
    if (s && s.type === 'LabeledBlock' && !usedLabels.has(s.label)) {
      if (s.body && s.body.type === 'Block' && s.body.body && s.body.body.length > 0) return s.body.body;
      return [];
    }
    return [s];
  });
}

function collectLabels(stmts, labels) {
  for (const s of stmts) {
    if (!s) continue;
    if (s.type === 'Goto') labels.add(s.label);
    if (s.type === 'Block' && s.body) collectLabels(s.body, labels);
    if (s.type === 'If') {
      if (s.consequent && s.consequent.body) collectLabels(s.consequent.body, labels);
      if (s.alternate && s.alternate.body) collectLabels(s.alternate.body, labels);
    }
    if (s.type === 'While' && s.body && s.body.body) collectLabels(s.body.body, labels);
    if (s.type === 'LabeledBlock' && s.body && s.body.body) collectLabels(s.body.body, labels);
    if (s.type === 'TryCatch') {
      if (s.tryBlock && s.tryBlock.body) collectLabels(s.tryBlock.body, labels);
      if (s.catchBlock && s.catchBlock.body) collectLabels(s.catchBlock.body, labels);
    }
  }
}

function cleanStatements(stmts) {
  if (!Array.isArray(stmts)) return stmts;
  const result = [];

  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i];
    if (!s) continue;

    // Remove empty if blocks (any condition)
    if (s.type === 'If' && isEmpty(s.consequent) && (!s.alternate || isEmpty(s.alternate))) continue;

    // Simplify if(true) { body } → body (flatten)
    if (s.type === 'If' && isLiteralTrue(s.test) && !isEmpty(s.consequent) && !s.alternate) {
      const inner = s.consequent.type === 'Block' ? s.consequent.body : [s.consequent];
      result.push(...cleanStatements(inner));
      continue;
    }

    // Simplify if(true) { then } else { else } → then
    if (s.type === 'If' && isLiteralTrue(s.test) && !isEmpty(s.consequent)) {
      const inner = s.consequent.type === 'Block' ? s.consequent.body : [s.consequent];
      result.push(...cleanStatements(inner));
      continue;
    }

    // Remove trailing bare return at end of function
    if (s.type === 'Return' && !s.value && i === stmts.length - 1) continue;

    // Remove try/catch comment markers
    if (s.type === 'ExprStmt' && s.expression && s.expression.type === 'Literal') {
      const v = s.expression.value;
      if (typeof v === 'string' && (v.includes('try {') || v.includes('end try') || v.includes('unknown opcode'))) continue;
    }

    // Remove assignments to literal 0: `0 = X` → emit X as expression
    if (s.type === 'Assign' && s.target && s.target.type === 'Literal' && s.target.value === 0) {
      // This is a VM artifact — the target was a stack slot.
      // Emit the value as an expression statement if it has side effects
      if (hasSideEffects(s.value)) {
        result.push(ir.exprStmt(s.value));
      }
      continue;
    }

    // Remove VarIncrement on literal 0
    if (s.type === 'VarIncrement' && s.target === '0') continue;

    // Clean empty while(true) { goto } → just the goto
    if (s.type === 'While' && isLiteralTrue(s.test) && s.body) {
      const bodyStmts = s.body.type === 'Block' ? s.body.body : [s.body];
      if (bodyStmts.length === 1 && bodyStmts[0].type === 'Goto') {
        result.push(bodyStmts[0]);
        continue;
      }
      if (bodyStmts.length === 0) continue;
    }

    // Recurse into block bodies
    if (s.type === 'Block' && s.body) {
      s.body = cleanStatements(s.body);
      if (s.body.length === 0) continue;
    }
    if (s.type === 'If') {
      if (s.consequent) s.consequent = cleanBlock(s.consequent);
      if (s.alternate) s.alternate = cleanBlock(s.alternate);
      // Remove if with empty then and no else
      if (isEmpty(s.consequent) && !s.alternate) continue;
    }
    if (s.type === 'While' && s.body) s.body = cleanBlock(s.body);
    if (s.type === 'DoWhile' && s.body) s.body = cleanBlock(s.body);
    if (s.type === 'TryCatch') {
      if (s.tryBlock) s.tryBlock = cleanBlock(s.tryBlock);
      if (s.catchBlock) s.catchBlock = cleanBlock(s.catchBlock);
    }
    if (s.type === 'LabeledBlock' && s.body) {
      s.body = cleanBlock(s.body);
      if (isEmpty(s.body)) continue;
      // Unwrap labeled blocks with single statement
      if (s.body.type === 'Block' && s.body.body.length === 1) {
        result.push(s.body.body[0]);
        continue;
      }
    }

    result.push(s);
  }

  return result;
}

function cleanBlock(node) {
  if (!node) return node;
  if (node.type === 'Block' && node.body) {
    node.body = cleanStatements(node.body);
  }
  return node;
}

function isLiteralTrue(node) {
  return node && node.type === 'Literal' && node.value === true;
}

function isEmpty(node) {
  if (!node) return true;
  if (node.type === 'Block') return !node.body || node.body.length === 0;
  return false;
}

function hasSideEffects(node) {
  if (!node) return false;
  return node.type === 'Call' || node.type === 'MethodCall' || node.type === 'New' ||
         node.type === 'PropSet' || node.type === 'Assign';
}

module.exports = { normalize };
