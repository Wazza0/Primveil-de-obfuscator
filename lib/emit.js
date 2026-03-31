'use strict';

const ir = require('./ir');

// Operator precedence table (higher = binds tighter)
const PREC = {
  '**': 15,
  '*': 14, '/': 14, '%': 14,
  '+': 13, '-': 13,
  '<<': 12, '>>': 12, '>>>': 12,
  '<': 11, '<=': 11, '>': 11, '>=': 11, 'in': 11, 'instanceof': 11,
  '==': 10, '!=': 10, '===': 10, '!==': 10,
  '&': 9,
  '^': 8,
  '|': 7,
  '&&': 6,
  '||': 5,
  '??': 4,
};

const INDENT = '  ';

function isValidIdentifier(s) {
  if (typeof s !== 'string') return false;
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s);
}

/**
 * Emit JavaScript source from an IR tree.
 */
function emit(node, opts) {
  opts = opts || {};
  const indent = opts.indent || 0;
  const pad = INDENT.repeat(indent);

  if (!node) return '';

  switch (node.type) {
    case 'Literal':
      return emitLiteral(node);

    case 'BinOp':
      return emitBinOp(node, opts);

    case 'UnaryOp':
      return emitUnaryOp(node, opts);

    case 'Var':
      return sanitizeName(node.name);

    case 'Reg':
      return 'r' + node.index;

    case 'PropGet':
      return emitPropGet(node, opts);

    case 'PropSet':
      return emitExpr(node.object, opts) + emitPropAccess(node.property, opts) +
             ' = ' + emitExpr(node.value, opts);

    case 'Call':
      return emitCall(node, opts);

    case 'MethodCall':
      return emitMethodCall(node, opts);

    case 'New':
      return 'new ' + emitExpr(node.callee, opts) +
             '(' + node.args.map(a => emitExpr(a, opts)).join(', ') + ')';

    case 'ArrayExpr':
      return '[' + node.elements.map(e => emitExpr(e, opts)).join(', ') + ']';

    case 'ObjectExpr':
      if (node.properties.length === 0) return '{}';
      return '{ ' + node.properties.map(p => {
        const key = emitExpr(p.key, opts);
        const val = emitExpr(p.value, opts);
        return key + ': ' + val;
      }).join(', ') + ' }';

    case 'SpreadExpr':
      return '...' + emitExpr(node.argument, opts);

    case 'ThisExpr':
      return 'this';

    case 'Typeof':
      return 'typeof ' + emitExpr(node.argument, opts);

    case 'LogicalOp':
      return emitBinOp({ type: 'BinOp', op: node.op, left: node.left, right: node.right }, opts);

    case 'NullishCheck': {
      const arg = emitExpr(node.argument, opts);
      return arg + ' == null';
    }

    // --- Statements ---
    case 'ExprStmt':
      return pad + emitExpr(node.expression, opts) + ';';

    case 'Return': {
      if (node.value === null || node.value === undefined) return pad + 'return;';
      // Simplify: return undefined → return
      if (node.value && node.value.type === 'Literal' && node.value.value === undefined) {
        return pad + 'return;';
      }
      return pad + 'return ' + emitExpr(node.value, opts) + ';';
    }

    case 'Throw':
      return pad + 'throw ' + emitExpr(node.value, opts) + ';';

    case 'Yield':
      if (node.value) return pad + 'yield ' + emitExpr(node.value, opts) + ';';
      return pad + 'yield;';

    case 'Assign':
      return pad + emitExpr(node.target, opts) + ' = ' + emitExpr(node.value, opts) + ';';

    case 'VarIncrement':
      return pad + node.name + '++;';

    case 'Block':
      return emitBlock(node, opts);

    case 'If':
      return emitIf(node, opts);

    case 'While':
      return pad + 'while (' + emitExpr(node.condition, opts) + ') {\n' +
             emitBody(node.body, indent + 1) + '\n' +
             pad + '}';

    case 'DoWhile':
      return pad + 'do {\n' +
             emitBody(node.body, indent + 1) + '\n' +
             pad + '} while (' + emitExpr(node.condition, opts) + ');';

    case 'ForOf':
      return pad + 'for (const ' + emitExpr(node.variable, opts) + ' of ' +
             emitExpr(node.iterable, opts) + ') {\n' +
             emitBody(node.body, indent + 1) + '\n' +
             pad + '}';

    case 'ForIn':
      return pad + 'for (const ' + emitExpr(node.variable, opts) + ' in ' +
             emitExpr(node.object, opts) + ') {\n' +
             emitBody(node.body, indent + 1) + '\n' +
             pad + '}';

    case 'TryCatch': {
      let s = pad + 'try {\n' +
              emitBody(node.tryBody, indent + 1) + '\n' +
              pad + '}';
      if (node.catchBody) {
        const param = node.catchParam || 'e';
        s += ' catch (' + param + ') {\n' +
             emitBody(node.catchBody, indent + 1) + '\n' +
             pad + '}';
      }
      if (node.finallyBody) {
        s += ' finally {\n' +
             emitBody(node.finallyBody, indent + 1) + '\n' +
             pad + '}';
      }
      return s;
    }

    case 'LabeledBlock':
      return pad + node.label + ': {\n' +
             emitBody(node.body, indent + 1) + '\n' +
             pad + '}';

    case 'Goto':
      return pad + '/* goto ' + node.label + ' */';

    case 'FunctionDecl':
      return emitFunctionDecl(node, opts);

    default:
      return pad + '/* unknown IR node: ' + (node.type || 'null') + ' */';
  }
}

function emitExpr(node, opts) {
  if (!node) return 'undefined';
  return emit(node, { ...opts, indent: 0 });
}

function sanitizeName(name) {
  if (!name || typeof name !== 'string') return 'unknown';
  // If it's a valid JS identifier, use as-is
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) return name;
  // If it's a short readable name with only minor issues, clean it
  if (name.length < 30 && /^[a-zA-Z_$]/.test(name)) return name.replace(/[^a-zA-Z0-9_$]/g, '_');
  // It's a resolved string constant being used as a name — shouldn't happen
  // but emit as a string literal instead
  return JSON.stringify(name);
}

function emitLiteral(node) {
  const v = node.value;
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'string') {
    // Check for comment-like strings
    if (v.startsWith('/*') && v.endsWith('*/')) return v;
    return JSON.stringify(v);
  }
  if (typeof v === 'number') {
    if (Object.is(v, -0)) return '-0';
    if (v !== v) return 'NaN';
    if (v === Infinity) return 'Infinity';
    if (v === -Infinity) return '-Infinity';
    return String(v);
  }
  return String(v);
}

function emitBinOp(node, opts) {
  const parentPrec = opts && opts.parentPrec || 0;
  const myPrec = PREC[node.op] || 0;

  let left = emitExpr(node.left, { ...opts, parentPrec: myPrec });
  let right = emitExpr(node.right, { ...opts, parentPrec: myPrec + 1 });

  // Simplification: x === true → x, x === false → !x
  if ((node.op === '===' || node.op === '==') && node.right && node.right.type === 'Literal') {
    if (node.right.value === true) return left;
    if (node.right.value === false) return '!' + left;
  }

  const result = left + ' ' + node.op + ' ' + right;

  if (myPrec > 0 && myPrec < parentPrec) {
    return '(' + result + ')';
  }
  return result;
}

function emitUnaryOp(node, opts) {
  const arg = emitExpr(node.argument, opts);

  // Simplification: !!x → x (double negation)
  if (node.op === '!' && node.argument && node.argument.type === 'UnaryOp' && node.argument.op === '!') {
    return emitExpr(node.argument.argument, opts);
  }

  if (node.op === 'delete' || node.op === 'typeof' || node.op === 'void') {
    return node.op + ' ' + arg;
  }
  if (node.prefix !== false) {
    return node.op + arg;
  }
  return arg + node.op;
}

function emitPropGet(node, opts) {
  const obj = emitExpr(node.object, opts);
  return obj + emitPropAccess(node.property, opts);
}

function emitPropAccess(prop, opts) {
  // Use dot notation if property is a string literal that's a valid identifier
  if (prop && prop.type === 'Literal' && typeof prop.value === 'string' && isValidIdentifier(prop.value)) {
    return '.' + prop.value;
  }
  return '[' + emitExpr(prop, opts) + ']';
}

function emitCall(node, opts) {
  const callee = emitExpr(node.callee, opts);
  const args = node.args.map(a => emitExpr(a, opts)).join(', ');
  return callee + '(' + args + ')';
}

function emitMethodCall(node, opts) {
  const obj = emitExpr(node.object, opts);
  const method = emitPropAccess(node.method, opts);
  const args = node.args.map(a => emitExpr(a, opts)).join(', ');
  return obj + method + '(' + args + ')';
}

function emitBlock(node, opts) {
  const indent = opts && opts.indent || 0;
  if (!node.body || node.body.length === 0) return '';
  return node.body.map(s => emit(s, { indent })).join('\n');
}

function emitBody(node, indent) {
  if (!node) return '';
  if (node.type === 'Block') {
    return node.body.map(s => emit(s, { indent })).join('\n');
  }
  return emit(node, { indent });
}

function emitIf(node, opts) {
  const indent = opts && opts.indent || 0;
  const pad = INDENT.repeat(indent);

  let s = pad + 'if (' + emitExpr(node.condition, opts) + ') {\n' +
          emitBody(node.consequent, indent + 1) + '\n' +
          pad + '}';

  if (node.alternate) {
    // Check for else-if chain
    if (node.alternate.type === 'If') {
      s += ' else ' + emit(node.alternate, { indent }).trimStart();
    } else {
      s += ' else {\n' +
           emitBody(node.alternate, indent + 1) + '\n' +
           pad + '}';
    }
  }

  return s;
}

function emitFunctionDecl(node, opts) {
  const indent = opts && opts.indent || 0;
  const pad = INDENT.repeat(indent);

  let prefix = '';
  if (node.isAsync) prefix += 'async ';
  prefix += 'function';
  if (node.isGenerator) prefix += '*';
  if (node.name) prefix += ' ' + node.name;

  const params = (node.params || []).join(', ');

  return pad + prefix + '(' + params + ') {\n' +
         emitBody(node.body, indent + 1) + '\n' +
         pad + '}';
}

module.exports = { emit };
