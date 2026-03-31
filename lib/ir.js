'use strict';

// ---------- Expression node types ----------
const EXPR_TYPES = new Set([
  'Literal', 'BinOp', 'UnaryOp', 'Var', 'Reg', 'PropGet', 'PropSet',
  'Call', 'MethodCall', 'New', 'ArrayExpr', 'ObjectExpr', 'SpreadExpr',
  'ThisExpr', 'Typeof', 'LogicalOp', 'NullishCheck',
]);

// ---------- Statement node types ----------
const STMT_TYPES = new Set([
  'ExprStmt', 'Return', 'Throw', 'Yield', 'Assign', 'VarIncrement',
  'Block', 'If', 'While', 'DoWhile', 'ForOf', 'ForIn', 'TryCatch',
  'LabeledBlock', 'Goto', 'FunctionDecl',
]);

function isExpr(n) { return n && EXPR_TYPES.has(n.type); }
function isStmt(n) { return n && STMT_TYPES.has(n.type); }

// ---------- Factory functions ----------

// Expressions
function literal(value) {
  return { type: 'Literal', value };
}

function binOp(op, left, right) {
  return { type: 'BinOp', op, left, right };
}

function unaryOp(op, argument, prefix) {
  return { type: 'UnaryOp', op, argument, prefix: prefix !== false };
}

function variable(name) {
  return { type: 'Var', name };
}

function reg(index) {
  return { type: 'Reg', index };
}

function propGet(object, property) {
  return { type: 'PropGet', object, property };
}

function propSet(object, property, value) {
  return { type: 'PropSet', object, property, value };
}

function call(callee, args, thisArg) {
  return { type: 'Call', callee, args: args || [], thisArg: thisArg || null };
}

function methodCall(object, method, args) {
  return { type: 'MethodCall', object, method, args: args || [] };
}

function newExpr(callee, args) {
  return { type: 'New', callee, args: args || [] };
}

function arrayExpr(elements) {
  return { type: 'ArrayExpr', elements: elements || [] };
}

function objectExpr(properties) {
  return { type: 'ObjectExpr', properties: properties || [] };
}

function spreadExpr(argument) {
  return { type: 'SpreadExpr', argument };
}

function thisExpr() {
  return { type: 'ThisExpr' };
}

function typeofExpr(argument) {
  return { type: 'Typeof', argument };
}

function logicalOp(op, left, right) {
  return { type: 'LogicalOp', op, left, right };
}

function nullishCheck(argument) {
  return { type: 'NullishCheck', argument };
}

// Statements
function exprStmt(expression) {
  return { type: 'ExprStmt', expression };
}

function returnStmt(value) {
  return { type: 'Return', value: value || null };
}

function throwStmt(value) {
  return { type: 'Throw', value };
}

function yieldStmt(value) {
  return { type: 'Yield', value: value || null };
}

function assign(target, value) {
  return { type: 'Assign', target, value };
}

function varIncrement(name, delta) {
  return { type: 'VarIncrement', name, delta: delta || 1 };
}

// Control flow
function block(body) {
  return { type: 'Block', body: body || [] };
}

function ifStmt(condition, consequent, alternate) {
  return { type: 'If', condition, consequent, alternate: alternate || null };
}

function whileStmt(condition, body) {
  return { type: 'While', condition, body };
}

function doWhileStmt(body, condition) {
  return { type: 'DoWhile', body, condition };
}

function forOfStmt(variable, iterable, body) {
  return { type: 'ForOf', variable, iterable, body };
}

function forInStmt(variable, object, body) {
  return { type: 'ForIn', variable, object, body };
}

function tryCatch(tryBody, catchParam, catchBody, finallyBody) {
  return {
    type: 'TryCatch',
    tryBody,
    catchParam: catchParam || null,
    catchBody: catchBody || null,
    finallyBody: finallyBody || null,
  };
}

function labeledBlock(label, body) {
  return { type: 'LabeledBlock', label, body };
}

function gotoStmt(label) {
  return { type: 'Goto', label };
}

// Function
function functionDecl(name, params, body, flags) {
  return {
    type: 'FunctionDecl',
    name: name || null,
    params: params || [],
    body,
    isAsync: !!(flags && flags.async),
    isGenerator: !!(flags && flags.generator),
  };
}

// ---------- Walk utility ----------
function walk(node, visitor) {
  if (!node || typeof node !== 'object') return;

  if (visitor.enter) {
    const result = visitor.enter(node);
    if (result === false) return;
  }

  switch (node.type) {
    case 'BinOp':
    case 'LogicalOp':
      walk(node.left, visitor);
      walk(node.right, visitor);
      break;
    case 'UnaryOp':
    case 'Typeof':
    case 'SpreadExpr':
    case 'NullishCheck':
      walk(node.argument, visitor);
      break;
    case 'PropGet':
      walk(node.object, visitor);
      walk(node.property, visitor);
      break;
    case 'PropSet':
      walk(node.object, visitor);
      walk(node.property, visitor);
      walk(node.value, visitor);
      break;
    case 'Call':
      walk(node.callee, visitor);
      if (node.thisArg) walk(node.thisArg, visitor);
      node.args.forEach(a => walk(a, visitor));
      break;
    case 'MethodCall':
      walk(node.object, visitor);
      walk(node.method, visitor);
      node.args.forEach(a => walk(a, visitor));
      break;
    case 'New':
      walk(node.callee, visitor);
      node.args.forEach(a => walk(a, visitor));
      break;
    case 'ArrayExpr':
      node.elements.forEach(e => walk(e, visitor));
      break;
    case 'ObjectExpr':
      node.properties.forEach(p => { walk(p.key, visitor); walk(p.value, visitor); });
      break;
    case 'ExprStmt':
      walk(node.expression, visitor);
      break;
    case 'Return':
    case 'Throw':
    case 'Yield':
      if (node.value) walk(node.value, visitor);
      break;
    case 'Assign':
      walk(node.target, visitor);
      walk(node.value, visitor);
      break;
    case 'Block':
      node.body.forEach(s => walk(s, visitor));
      break;
    case 'If':
      walk(node.condition, visitor);
      walk(node.consequent, visitor);
      if (node.alternate) walk(node.alternate, visitor);
      break;
    case 'While':
      walk(node.condition, visitor);
      walk(node.body, visitor);
      break;
    case 'DoWhile':
      walk(node.body, visitor);
      walk(node.condition, visitor);
      break;
    case 'ForOf':
    case 'ForIn':
      walk(node.variable, visitor);
      walk(node.iterable || node.object, visitor);
      walk(node.body, visitor);
      break;
    case 'TryCatch':
      walk(node.tryBody, visitor);
      if (node.catchBody) walk(node.catchBody, visitor);
      if (node.finallyBody) walk(node.finallyBody, visitor);
      break;
    case 'LabeledBlock':
      walk(node.body, visitor);
      break;
    case 'FunctionDecl':
      walk(node.body, visitor);
      break;
  }

  if (visitor.leave) visitor.leave(node);
}

module.exports = {
  // Expressions
  literal, binOp, unaryOp, variable, reg, propGet, propSet,
  call, methodCall, newExpr, arrayExpr, objectExpr, spreadExpr,
  thisExpr, typeofExpr, logicalOp, nullishCheck,
  // Statements
  exprStmt, returnStmt, throwStmt, yieldStmt, assign, varIncrement,
  // Control flow
  block, ifStmt, whileStmt, doWhileStmt, forOfStmt, forInStmt,
  tryCatch, labeledBlock, gotoStmt,
  // Function
  functionDecl,
  // Utilities
  walk, isExpr, isStmt,
};
