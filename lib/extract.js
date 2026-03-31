'use strict';

const vm = require('vm');
const { createSandbox, findFnBody, neutralize } = require('./sandbox');

function replaceZjBody(src, newBody) {
  const info = findFnBody(src, 'zJ');
  if (!info) throw new Error('Cannot find function zJ');
  return src.substring(0, info.start) + '{' + newBody + '}' + src.substring(info.end);
}

function extract(src, opts = {}) {
  const timeout = opts.timeout || 30000;
  const verbose = opts.verbose || false;
  const safeSrc = neutralize(src);

  // Pass 1: Capture IL blob by stubbing zJ and injecting capture before the while loop
  let blobCode = replaceZjBody(safeSrc, 'return undefined;');
  const wp = blobCode.indexOf('while(!(anf(');
  if (wp !== -1) blobCode = blobCode.substring(0, wp) + '__G__.IL=IL;\n' + blobCode.substring(wp);

  const ctx1 = createSandbox({ extraGlobals: { __G__: {} } });
  try { vm.runInContext(blobCode, ctx1, { timeout }); } catch (e) {}
  const IL = ctx1.__G__.IL;
  if (!IL) throw new Error('IL extraction failed');
  if (verbose) console.log('[extract] IL: ' + Object.keys(IL.dC || {}).length + ' functions, ' + (IL.hA || []).length + ' constants');

  // Pass 2: Run zJ's setup code to capture crypto primitives and strings
  // The setup = everything inside zJ before the do{ loop
  const zjInfo = findFnBody(safeSrc, 'zJ');
  if (!zjInfo) throw new Error('Cannot find zJ body');
  const doPos = zjInfo.body.indexOf('do{');
  if (doPos === -1) throw new Error('Cannot find do{ loop in zJ');

  let setup = zjInfo.body.substring(0, doPos);
  setup = neutralize(setup);

  // The setup has 2 unclosed try blocks — close them before the capture code
  const captureCode =
    '} catch(__e0) {} } catch(__e1) {}' +
    'if(typeof __G__!=="undefined"){' +
    '__G__.SS=typeof SS!=="undefined"?JSON.parse(JSON.stringify(SS)):null;' +
    '__G__.XS=typeof XS!=="undefined"?JSON.parse(JSON.stringify(XS)):null;' +
    '__G__.Es_keys=typeof Es!=="undefined"?Object.keys(Es).map(Number):null;' +
    '__G__.Hw=typeof Hw!=="undefined"?Array.from(Hw):null;' +
    '__G__.Tc_src=typeof Tc!=="undefined"?Tc.toString():null;' +
    '__G__.DT_src=typeof DT!=="undefined"?DT.toString():null;' +
    '__G__.vT_src=typeof vT!=="undefined"?vT.toString():null;' +
    '__G__.Dh_fn=typeof Dh!=="undefined"?Dh:null;' +
    '__G__.vT_fn=typeof vT!=="undefined"?vT:null;' +
    '__G__.Tc_fn=typeof Tc!=="undefined"?Tc:null;' +
    '__G__.Ge_fn=typeof Ge!=="undefined"?Ge:null;' +
    '__G__.KT_fn=typeof KT!=="undefined"?KT:null;' +
    '__G__.Wv=typeof Wv!=="undefined"?Wv:null;' +
    '__G__.XQ=typeof XQ!=="undefined"?XQ:null;' +
    '__G__.MK=typeof MK!=="undefined"?MK:null;' +
    'if(typeof Vk!=="undefined"){__G__.strings=[];' +
    'for(var __i=0;__i<(MK||[]).length;__i++){' +
    'try{__G__.strings.push(Vk(MK[__i],tc,typeof NV!=="undefined"?NV:null));}' +
    'catch(e){try{__G__.strings.push(typeof NW!=="undefined"?NW(MK[__i],tc,typeof NV!=="undefined"?NV:null):null);}catch(e2){__G__.strings.push(null);}}}}' +
    '}return undefined;';

  const closureCode = replaceZjBody(safeSrc, setup + captureCode);
  const ctx2 = createSandbox({ extraGlobals: { __G__: {} } });
  try { vm.runInContext(closureCode, ctx2, { timeout }); } catch (e) {}
  const cl = ctx2.__G__;

  // Pass 3: Extract Dh function source
  let dhSrc = null;
  const dhInfo = findFnBody(safeSrc, 'Dh');
  if (dhInfo) {
    const dhStart = safeSrc.lastIndexOf('function', dhInfo.start);
    dhSrc = safeSrc.substring(dhStart, dhInfo.end);
  }

  // Build function name map: string table index → source function name
  const fnStringMap = {};
  for (let i = 0; i < (IL.hA || []).length; i++) {
    const entry = IL.hA[i];
    if (entry && entry.ao && IL.dC && IL.dC[entry.ao]) {
      fnStringMap[i] = IL.dC[entry.ao].cC || entry.ao;
    }
  }

  const crypto = {
    SS: cl.SS || null,
    XS: cl.XS || null,
    Hw: cl.Hw || null,
    Dh_fn: cl.Dh_fn || null,
    vT_fn: cl.vT_fn || null,
    Tc_fn: cl.Tc_fn || null,
    Ge_fn: cl.Ge_fn || null,
    KT_fn: cl.KT_fn || null,
    Wv: cl.Wv || null,
    XQ: cl.XQ || null,
    Tc_src: cl.Tc_src || null,
    DT_src: cl.DT_src || null,
    vT_src: cl.vT_src || null,
    Dh_src: dhSrc,
  };

  const strings = cl.strings || [];

  if (verbose) {
    console.log('[extract] SS: ' + (crypto.SS ? Object.keys(crypto.SS).length + ' ops' : 'missing'));
    console.log('[extract] Hw: ' + (crypto.Hw ? crypto.Hw.length + ' entries' : 'missing'));
    console.log('[extract] Strings: ' + strings.filter(s => s != null).length + '/' + strings.length);
    console.log('[extract] Functions: ' + Object.keys(fnStringMap).length + ' mapped');
    console.log('[extract] Dh: ' + (dhSrc ? dhSrc.length + ' chars' : 'missing'));
  }

  return { IL, crypto, strings, fnStringMap };
}

module.exports = { extract };
