'use strict';

const vm = require('vm');

/**
 * Create a V8 sandbox context with all PrimeVeil globals.
 */
function createSandbox(opts = {}) {
  const sandbox = {
    // Standard globals
    Object, Array, String, Number, Boolean, Date, RegExp, Error,
    TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError,
    Math, JSON, parseInt, parseFloat, isNaN, isFinite,
    encodeURI, encodeURIComponent, decodeURI, decodeURIComponent,
    Map, Set, WeakMap, WeakSet, Promise, Symbol, Proxy, Reflect,
    ArrayBuffer, Uint8Array, Int8Array, Uint16Array, Int16Array,
    Uint32Array, Int32Array, Float32Array, Float64Array, DataView,
    BigInt: typeof BigInt !== 'undefined' ? BigInt : undefined,
    BigInt64Array: typeof BigInt64Array !== 'undefined' ? BigInt64Array : undefined,
    BigUint64Array: typeof BigUint64Array !== 'undefined' ? BigUint64Array : undefined,
    WeakRef: typeof WeakRef !== 'undefined' ? WeakRef : class WeakRef {
      constructor(t) { this._t = t; }
      deref() { return this._t; }
    },
    TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : class TextDecoder {
      decode(buf) {
        const arr = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
        return s;
      }
    },
    TextEncoder: typeof TextEncoder !== 'undefined' ? TextEncoder : class TextEncoder {
      encode(s) {
        const a = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
        return a;
      }
    },
    atob: typeof atob !== 'undefined' ? atob : function atob(s) {
      return Buffer.from(s, 'base64').toString('binary');
    },
    btoa: typeof btoa !== 'undefined' ? btoa : function btoa(s) {
      return Buffer.from(s, 'binary').toString('base64');
    },
    Function,
    globalThis,
    self: globalThis,
    window: undefined,
    Buffer: typeof Buffer !== 'undefined' ? Buffer : undefined,
    console: opts.silent ? { log(){}, warn(){}, error(){}, info(){}, debug(){} } : console,
    setTimeout: (fn) => fn(),
    clearTimeout() {},
    undefined: undefined,
    NaN: NaN,
    Infinity: Infinity,
    __G__: {},
  };

  if (opts.extraGlobals) {
    Object.assign(sandbox, opts.extraGlobals);
  }

  return vm.createContext(sandbox);
}

/**
 * Find a named function body in source — handles nested braces and strings.
 */
function findFnBody(src, name) {
  const pattern = new RegExp('function\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(');
  const m = pattern.exec(src);
  if (!m) return null;

  let idx = src.indexOf('{', m.index + m[0].length);
  if (idx === -1) return null;

  const start = idx;
  let depth = 1;
  let i = idx + 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') { depth++; }
    else if (ch === '}') { depth--; }
    else if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
    } else if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length - 1 && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i++;
    }
    i++;
  }

  const end = i;
  return { start, end, body: src.slice(start + 1, end - 1) };
}

/**
 * Neutralize crash traps: (function X(){X();})()
 */
function neutralize(src) {
  return src.replace(/\(function\s+(\w+)\s*\(\)\s*\{\s*\1\s*\(\)\s*;\s*\}\)\s*\(\)/g, '(function $1(){})()');
}

/**
 * Run code in a sandbox context.
 */
function runInSandbox(code, extraGlobals = {}, timeout = 30000) {
  const ctx = createSandbox({ extraGlobals });
  vm.runInContext(code, ctx, { timeout });
  return ctx.__G__;
}

module.exports = { createSandbox, findFnBody, neutralize, runInSandbox };
