'use strict';

// PrimeVeil v1.0.5 — full opcode table (140 opcodes)
// Each entry: { name, pops, pushes, r3, op, category, jumpType }

const OP = new Map();

function def(code, name, pops, pushes, opts = {}) {
  OP.set(code, {
    name,
    pops,
    pushes,
    r3: opts.r3 || false,
    op: opts.op || null,
    category: opts.cat || 'meta',
    jumpType: opts.jt || null,
  });
}

// --- Literals ---
def(49,  'PUSH_CONST',  0, 1, { cat: 'literal' });
def(224, 'PUSH_0',      0, 1, { cat: 'literal' });
def(225, 'PUSH_1',      0, 1, { cat: 'literal' });
def(226, 'PUSH_N1',     0, 1, { cat: 'literal' });
def(227, 'PUSH_TRUE',   0, 1, { cat: 'literal' });
def(228, 'PUSH_FALSE',  0, 1, { cat: 'literal' });
def(229, 'PUSH_NULL',   0, 1, { cat: 'literal' });
def(230, 'PUSH_UNDEF',  0, 1, { cat: 'literal' });

// --- Arithmetic (register-based, r3) ---
def(116, 'REG_ADD',  0, 0, { r3: true, op: '+',   cat: 'arithmetic' });
def(57,  'REG_SUB',  0, 0, { r3: true, op: '-',   cat: 'arithmetic' });
def(113, 'REG_MUL',  0, 0, { r3: true, op: '*',   cat: 'arithmetic' });
def(45,  'REG_DIV',  0, 0, { r3: true, op: '/',   cat: 'arithmetic' });
def(54,  'REG_MOD',  0, 0, { r3: true, op: '%',   cat: 'arithmetic' });

// --- Comparison (register-based, r3) ---
def(11,  'REG_EQ',   0, 0, { r3: true, op: '==',  cat: 'comparison' });
def(133, 'REG_SEQ',  0, 0, { r3: true, op: '===', cat: 'comparison' });
def(131, 'REG_NEQ',  0, 0, { r3: true, op: '!=',  cat: 'comparison' });
def(80,  'REG_SNEQ', 0, 0, { r3: true, op: '!==', cat: 'comparison' });
def(43,  'REG_LT',   0, 0, { r3: true, op: '<',   cat: 'comparison' });
def(79,  'REG_GT',   0, 0, { r3: true, op: '>',   cat: 'comparison' });
def(122, 'REG_LTE',  0, 0, { r3: true, op: '<=',  cat: 'comparison' });
def(63,  'REG_GTE',  0, 0, { r3: true, op: '>=',  cat: 'comparison' });

// --- Stack-based binary arithmetic ---
def(120, 'BIN_ADD',  2, 1, { op: '+',   cat: 'arithmetic' });
def(144, 'BIN_SUB',  2, 1, { op: '-',   cat: 'arithmetic' });
def(177, 'BIN_SUB',  2, 1, { op: '-',   cat: 'arithmetic' });
def(87,  'SMUL',     2, 1, { op: '*',   cat: 'arithmetic' });
def(178, 'SMUL',     2, 1, { op: '*',   cat: 'arithmetic' });
def(187, 'SMUL',     2, 1, { op: '*',   cat: 'arithmetic' });
def(246, 'SMUL',     2, 1, { op: '*',   cat: 'arithmetic' });
def(247, 'SDIV',     2, 1, { op: '/',   cat: 'arithmetic' });
def(248, 'SMOD',     2, 1, { op: '%',   cat: 'arithmetic' });
def(249, 'SPOW',     2, 1, { op: '**',  cat: 'arithmetic' });

// --- Stack-based binary comparison ---
def(60,  'SEQ',      2, 1, { op: '===', cat: 'comparison' });
def(114, 'SEQ',      2, 1, { op: '===', cat: 'comparison' });
def(180, 'SEQ',      2, 1, { op: '===', cat: 'comparison' });
def(184, 'SEQ',      2, 1, { op: '===', cat: 'comparison' });
def(207, 'SEQ',      2, 1, { op: '===', cat: 'comparison' });
def(126, 'SNEQ',     2, 1, { op: '!==', cat: 'comparison' });
def(74,  'BIN_LT',   2, 1, { op: '<',   cat: 'comparison' });
def(78,  'BIN_LTE',  2, 1, { op: '<=',  cat: 'comparison' });
def(121, 'BIN_GTE',  2, 1, { op: '>=',  cat: 'comparison' });
def(56,  'IN',       2, 1, { op: 'in',  cat: 'comparison' });
def(142, 'INSTANCEOF', 2, 1, { op: 'instanceof', cat: 'comparison' });

// --- Binary (bitwise) ---
def(14,  'BIN_AND',  2, 1, { op: '&',   cat: 'binary' });
def(59,  'BIN_AND',  2, 1, { op: '&',   cat: 'binary' });
def(205, 'BIN_AND',  2, 1, { op: '&',   cat: 'binary' });
def(30,  'BIN_OR',   2, 1, { op: '|',   cat: 'binary' });
def(188, 'BIN_OR',   2, 1, { op: '|',   cat: 'binary' });
def(21,  'BIN_XOR',  2, 1, { op: '^',   cat: 'binary' });
def(186, 'BIN_XOR',  2, 1, { op: '^',   cat: 'binary' });
def(156, 'BIN_SHL',  2, 1, { op: '<<',  cat: 'binary' });
def(185, 'BIN_SHL',  2, 1, { op: '<<',  cat: 'binary' });
def(72,  'BIN_SHR',  2, 1, { op: '>>',  cat: 'binary' });
def(190, 'BIN_SHR',  2, 1, { op: '>>',  cat: 'binary' });
def(85,  'BIN_USHR', 2, 1, { op: '>>>', cat: 'binary' });
def(201, 'BIN_USHR', 2, 1, { op: '>>>', cat: 'binary' });

// --- Unary ---
def(244, 'NOT',      1, 1, { op: '!',  cat: 'unary' });
def(29,  'BITNOT',   1, 1, { op: '~',  cat: 'unary' });
def(68,  'NEG',      1, 1, { op: '-',  cat: 'unary' });
def(245, 'NEG',      1, 1, { op: '-',  cat: 'unary' });
def(155, 'TYPEOF',   1, 1, { cat: 'unary' });
def(250, 'TYPEOF',   1, 1, { cat: 'unary' });
def(38,  'TYPEOF_C', 0, 1, { cat: 'unary' });
def(73,  'TYPEOF_C', 0, 1, { cat: 'unary' });
def(157, 'TYPEOF_VAR', 0, 1, { cat: 'unary' });
def(138, 'IS_NULLISH', 1, 1, { cat: 'unary' });

// --- Logical ---
def(93, 'LOG_AND', 2, 1, { op: '&&', cat: 'binary' });

// --- Property ---
def(23,  'PGET',     2, 1, { cat: 'property' });
def(25,  'PGET',     2, 1, { cat: 'property' });
def(62,  'PGET',     2, 1, { cat: 'property' });
def(107, 'PGET',     2, 1, { cat: 'property' });
def(167, 'PSET',     3, 0, { cat: 'property' });
def(101, 'PSET_TRY', 3, 0, { cat: 'property' });
def(31,  'DEF_GETTER', 3, 1, { cat: 'property' });
def(128, 'DEF_SETTER', 3, 1, { cat: 'property' });
def(36,  'DEL',      2, 1, { cat: 'property' });

// --- Call ---
def(33,  'CALL',  -1, 1, { cat: 'call' }); // N args (variable)
def(16,  'MCALL', -1, 1, { cat: 'call' });
def(158, 'MCALL', -1, 1, { cat: 'call' });
def(53,  'NEW',   -1, 1, { cat: 'call' });
def(96,  'NEW',   -1, 1, { cat: 'call' });

// --- Control flow ---
def(50,  'JF',   1, 0, { cat: 'control', jt: 'cond-false' });
def(195, 'JF',   1, 0, { cat: 'control', jt: 'cond-false' });
def(206, 'JF',   1, 0, { cat: 'control', jt: 'cond-false' });
def(111, 'JT',   1, 0, { cat: 'control', jt: 'cond-true' });
def(181, 'JT',   1, 0, { cat: 'control', jt: 'cond-true' });
def(151, 'JMP',  0, 0, { cat: 'control', jt: 'unconditional' });
def(189, 'JMP',  0, 0, { cat: 'control', jt: 'unconditional' });
def(194, 'JMP',  0, 0, { cat: 'control', jt: 'unconditional' });
def(204, 'JMP',  0, 0, { cat: 'control', jt: 'unconditional' });
def(89,  'RET',  1, 0, { cat: 'control' });
def(95,  'RET',  1, 0, { cat: 'control' });
def(146, 'RET_EX', 1, 0, { cat: 'control' });
def(119, 'THROW', 1, 0, { cat: 'control' });
def(83,  'YIELD', 1, 0, { cat: 'control' });

// --- Scope ---
def(15,  'SC_PROP',  0, 1, { cat: 'scope' });
def(32,  'SC_GET',   1, 1, { cat: 'scope' });
def(35,  'LD_SC_R',  0, 0, { cat: 'scope' });
def(47,  'SC_SET',   2, 1, { cat: 'scope' });
def(104, 'SC_SET2',  2, 0, { cat: 'scope' });
def(84,  'LD_VAR',   0, 1, { cat: 'scope' });
def(234, 'GET_VAR',  0, 1, { cat: 'scope' });
def(108, 'SET_VAR',  1, 0, { cat: 'scope' });
def(136, 'SET_VAR',  1, 0, { cat: 'scope' });
def(236, 'SET_VAR',  1, 0, { cat: 'scope' });
def(46,  'INC_VAR',  0, 0, { cat: 'scope' });
def(235, 'INC_VAR',  0, 1, { cat: 'scope' });
def(76,  'THIS',     0, 1, { cat: 'scope' });
def(109, 'MODULE',   0, 1, { cat: 'scope' });

// --- Stack ---
def(97,  'DUP',  0, 1, { cat: 'stack' });
def(238, 'DUP',  0, 1, { cat: 'stack' });
def(137, 'POP',  1, 0, { cat: 'stack' });
def(176, 'POP',  1, 0, { cat: 'stack' });
def(198, 'POP',  1, 0, { cat: 'stack' });
def(199, 'POP',  1, 0, { cat: 'stack' });
def(88,  'SPREAD', 1, 1, { cat: 'stack' });
def(103, 'SPREAD', 1, 1, { cat: 'stack' });
def(100, 'OBJ_SPREAD', -1, 1, { cat: 'stack' });

// --- Register ---
def(42,  'LD_REG',    0, 1, { cat: 'stack' });
def(141, 'STORE_REG', 1, 0, { cat: 'stack' });
def(140, 'LOAD_CONST', 0, 0, { cat: 'literal' });
def(159, 'LOAD_CONST', 0, 0, { cat: 'literal' });

// --- Exception ---
def(51,  'TRY',     0, 0, { cat: 'exception' });
def(106, 'TRY_END', 0, 0, { cat: 'exception' });

// --- Array / Object ---
def(10,  'ARR_NEW', -1, 1, { cat: 'literal' });

// --- Iterator ---
def(17,  'ITER_NX', 1, 1, { cat: 'iterator' });
def(41,  'FORIN',   1, 2, { cat: 'iterator' });

// --- Anti-tamper ---
def(26,  'AT', 0, 0, { cat: 'meta' });
def(92,  'AT', 0, 0, { cat: 'meta' });

// --- NOP ---
def(71,  'NOP', 0, 0, { cat: 'meta' });

// --- Context ---
def(163, 'CX',      0, 0, { cat: 'meta' });
def(165, 'CX',      0, 0, { cat: 'meta' });
def(166, 'CX',      0, 0, { cat: 'meta' });
def(170, 'CX',      0, 0, { cat: 'meta' });
def(174, 'CX',      0, 0, { cat: 'meta' });
def(175, 'CX',      0, 0, { cat: 'meta' });
def(169, 'CX_PUSH', 0, 1, { cat: 'meta' });
def(171, 'CX_PUSH', 0, 1, { cat: 'meta' });
def(172, 'CX_PUSH', 0, 1, { cat: 'meta' });

// --- Multi ---
def(208, 'MULTI', 0, 0, { cat: 'meta' });
def(209, 'MULTI', 0, 0, { cat: 'meta' });

// String index permutation
function STR_IDX(i) {
  return ((33 * i + 104) % 170 + 170) % 170;
}

const JUMP_OPS = new Set([50, 111, 151, 181, 189, 194, 195, 204, 206]);
const RET_OPS = new Set([89, 95, 146]);
const AT_OPS = new Set([26, 92]);

module.exports = { OP, STR_IDX, JUMP_OPS, RET_OPS, AT_OPS };
