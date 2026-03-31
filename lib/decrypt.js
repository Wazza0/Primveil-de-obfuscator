'use strict';

function Wz(offset) {
  return (845562036 * ((offset + 1) & 0xFF) + (offset ^ 16384)) & 0xFFFF;
}

function createDecryptor(crypto, opts = {}) {
  const verbose = opts.verbose || false;

  const Dh_fn = crypto.Dh_fn || null;
  const vT_fn = crypto.vT_fn || null;
  const Tc_fn = crypto.Tc_fn || null;
  const Ge_fn = crypto.Ge_fn || null;
  const KT_fn = crypto.KT_fn || null;
  const Wv = crypto.Wv || null;
  const XQ = crypto.XQ || null;
  const SS = crypto.SS || {};
  const XS = crypto.XS || {};

  if (verbose) {
    console.log('[decrypt] Dh:', !!Dh_fn, 'vT:', !!vT_fn, 'Ge:', !!Ge_fn, 'KT:', !!KT_fn, 'Wv:', !!Wv);
  }

  function decrypt(fn, fnName) {
    // Step 1: Decompress + decrypt bytecodes
    // Mirrors Qx logic:
    //   if (hw & 0x20): gQ = Dh(gQ, eX, bF)  (decompress)
    //   if (hw & 0x8 && Wv): gQ = Ge(gQ, gi, eX, Wv)  (per-function XOR)
    //   else if (XQ): gQ = KT(gQ)  (global XOR)
    let rawBc;
    let hw = fn.hw || 0;

    if (!fn.gQ) throw new Error('no bytecode');
    rawBc = Array.from(fn.gQ);

    // Dh decompression
    if ((hw & 0x20) && Dh_fn) {
      try {
        rawBc = Array.from(Dh_fn(rawBc, fn.eX || 0, fn.bF || rawBc.length));
      } catch (e) {
        throw new Error('Dh: ' + e.message);
      }
    }

    // Ge per-function XOR (using gi key)
    if ((hw & 0x8) && Wv && Ge_fn) {
      try {
        rawBc = Array.from(Ge_fn(rawBc, fn.gi, fn.eX || 0, Wv));
      } catch (e) {
        if (verbose) console.warn('[decrypt] Ge failed:', e.message);
      }
    } else if (XQ && KT_fn) {
      // Global KT XOR
      try {
        rawBc = Array.from(KT_fn(rawBc));
      } catch (e) {
        if (verbose) console.warn('[decrypt] KT failed:', e.message);
      }
    }

    // Step 2: Decrypt — exact mirror of the VM inner loop
    const guards = (fnName && XS[fnName]) ? XS[fnName] : (fn.gd || null);
    // Nd: per-function guard ranges for BO() check
    // BO(PC, Nd) returns true when PC falls in a guarded range [Nd[i], Nd[i+1])
    const Nd = fn.gd || null;
    function isGuarded(pc, nd) {
      if (!nd || !nd.length) return false;
      for (let i = 0; i < nd.length; i += 2) {
        if (pc >= nd[i] && pc < nd[i + 1]) return true;
      }
      return false;
    }

    const Ia = rawBc.slice(); // reference buffer (for vT)
    const Ff = rawBc.slice(); // working buffer (mutated by anti-tamper)
    let Ix = Wz(0);
    let QN = 0;
    const instructions = [];

    while (QN < Ff.length) {
      if (guards && guards[QN]) Ix = Wz(QN);

      const Lq = QN;
      const raw = Ff[QN++];
      let UI = (raw ^ (Ix & 0xFF)) & 0xFF;

      if (UI !== 92 && UI !== 26 && UI !== 71) {
        Ix = (Ix * 65 + (UI ^ 11776)) & 0xFFFF;
      }

      // Anti-tamper and NOP opcodes read operands differently:
      // They read raw bytes from Ia (not vT-decoded) and advance QN themselves.
      if (UI === 92) {
        // Opcode 92: patch a future tape position
        // Reads 4 raw bytes from Ia: target(16-bit), mode, value
        const Eg = (Ia[QN] << 8) | Ia[QN + 1];
        const On = Ia[QN + 2];
        const NH = Ia[QN + 3];
        QN += 4;

        if (Eg >= 0 && Eg < Ia.length) {
          if (On === 0) Ia[Eg] = (Ia[Eg] + NH) & 0xFFFF;
          else if (On === 1) Ia[Eg] = (Ia[Eg] - NH) & 0xFFFF;
          else Ia[Eg] = (Ia[Eg] ^ NH) & 0xFFFF;
          Ff[Eg] = Ia[Eg];
        }
        Ff[Lq] = (71 ^ (Ix & 0xFF)) & 0xFF;
        Ia[Lq] = Ff[Lq];

        instructions.push({ pc: Lq, opcode: UI, operands: [Eg, On, NH] });
        continue;
      }

      if (UI === 26) {
        // Opcode 26: swap two future tape positions
        // Reads 4 raw bytes from Ia: base(16-bit), offset1, offset2
        const XE = (Ia[QN] << 8) | Ia[QN + 1];
        const Tl = XE + Ia[QN + 2];
        const VR = XE + Ia[QN + 3];
        QN += 4;

        if (Tl >= 0 && Tl < Ia.length && VR >= 0 && VR < Ia.length) {
          const tmp = Ia[Tl];
          Ia[Tl] = Ia[VR];
          Ia[VR] = tmp;
          Ff[Tl] = Ia[Tl];
          Ff[VR] = Ia[VR];
        }
        Ff[Lq] = (71 ^ (Ix & 0xFF)) & 0xFF;
        Ia[Lq] = Ff[Lq];

        instructions.push({ pc: Lq, opcode: UI, operands: [XE, Tl, VR] });
        continue;
      }

      if (UI === 71) {
        // Opcode 71 (NOP): skip 4 bytes
        QN += 4;
        instructions.push({ pc: Lq, opcode: UI, operands: [] });
        continue;
      }

      // Normal opcodes: read operands via vT
      const vi = SS[UI] || 0;
      const operands = [];

      // BO(Lq, Nd): check if this PC is in a guarded range
      // If guarded, handlers read raw Vh (vT-decoded) without Tc
      // If not guarded, handlers apply Tc on top of vT
      const guarded = isGuarded(Lq, Nd);

      for (let i = 0; i < vi && QN < Ff.length; i++) {
        // Pass 1: vT decryption (loop-level, always applied when !BO for the loop check)
        // The loop has its own BO check using Nd, but it checks QN-1 not Lq
        let decoded;
        if (vT_fn && !guarded) {
          try { decoded = vT_fn(Ia[QN], i, Lq); } catch (e) { decoded = Ff[QN]; }
        } else {
          decoded = Ff[QN];
        }
        Ff[QN] = decoded;

        // Pass 2: Tc decryption (handler-level, only when !BO)
        let finalVal = decoded;
        if (Tc_fn && !guarded) {
          try { finalVal = Tc_fn(decoded, Lq); } catch (e) { finalVal = decoded; }
        }

        operands.push(finalVal & 0xFFFF);
        QN++;
      }

      instructions.push({ pc: Lq, opcode: UI, operands });
    }

    return instructions;
  }

  return { decrypt };
}

module.exports = { createDecryptor, Wz };
