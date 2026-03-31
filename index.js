#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { extract } = require('./lib/extract');
const { createDecryptor } = require('./lib/decrypt');
const { disasm } = require('./lib/disasm');
const { lift } = require('./lib/lift');
const { structure } = require('./lib/structure');
const { normalize } = require('./lib/normalize');
const { emit } = require('./lib/emit');
const { beautify } = require('./lib/beautify');
const ir = require('./lib/ir');

// ---- CLI argument parsing ----
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log('PrimeVeil v1.0.5 Devirtualization Framework');
  console.log('');
  console.log('Usage: node index.js <input.js> [-o output.js] [--verbose] [--timeout 30000]');
  console.log('');
  console.log('Options:');
  console.log('  -o <file>       Output file (default: <input>.devirt.js)');
  console.log('  --verbose       Enable verbose logging');
  console.log('  --timeout <ms>  Sandbox timeout in milliseconds (default: 30000)');
  console.log('  --dump-disasm   Also write disassembly to <input>.disasm.txt');
  process.exit(0);
}

const inputFile = args[0];
let outputFile = null;
let verbose = false;
let timeout = 30000;
let dumpDisasm = false;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '-o' && i + 1 < args.length) { outputFile = args[++i]; }
  else if (args[i] === '--verbose') { verbose = true; }
  else if (args[i] === '--timeout' && i + 1 < args.length) { timeout = parseInt(args[++i], 10); }
  else if (args[i] === '--dump-disasm') { dumpDisasm = true; }
}

if (!outputFile) {
  const ext = path.extname(inputFile);
  outputFile = inputFile.replace(ext, '.devirt' + ext);
}

// ---- Stack size guard ----
// Re-exec with larger stack if needed
if (!process.env.PRIMEVEIL_STACK_GUARD) {
  const { execFileSync } = require('child_process');
  try {
    process.env.PRIMEVEIL_STACK_GUARD = '1';
    const result = execFileSync(process.execPath, ['--stack-size=65536', ...process.argv.slice(1)], {
      env: process.env,
      stdio: 'inherit',
      timeout: timeout + 30000,
    });
    process.exit(0);
  } catch (e) {
    if (e.status != null) process.exit(e.status);
    // If re-exec fails, continue with current stack
    delete process.env.PRIMEVEIL_STACK_GUARD;
  }
}

// ---- Main pipeline ----
(function main() {
  // Step 1: Read + validate
  let src;
  try {
    src = fs.readFileSync(inputFile, 'utf-8');
  } catch (e) {
    console.error('Error reading input file:', e.message);
    process.exit(1);
  }

  if (!src.includes('function zJ(')) {
    console.error('Error: Input does not appear to be PrimeVeil-protected (no function zJ found)');
    process.exit(1);
  }

  if (verbose) console.log('[main] Input file:', inputFile, '(' + src.length + ' bytes)');

  // Step 2: Extract IL, crypto, strings
  let extracted;
  try {
    extracted = extract(src, { timeout, verbose });
  } catch (e) {
    console.error('Error during extraction:', e.message);
    if (verbose) console.error(e.stack);
    process.exit(1);
  }

  const { IL, crypto, strings, fnStringMap } = extracted;
  const dC = IL.dC || {};
  const fnEntries = Object.entries(dC).filter(([, f]) => f.gQ && f.gQ.length > 0);
  if (verbose) console.log('[main] Functions to decompile:', fnEntries.length);

  // Step 3: Create decryptor
  let decryptor;
  try {
    decryptor = createDecryptor(crypto, { timeout, verbose });
  } catch (e) {
    console.error('Error creating decryptor:', e.message);
    if (verbose) console.error(e.stack);
    process.exit(1);
  }

  // Step 4: Process each function
  const output = [];
  let successCount = 0;
  let failCount = 0;
  let disasmLines = [];

  for (const [internalName, fn] of fnEntries) {
    const fnName = fn.cC || internalName;

    try {
      // 4a: Decrypt bytecode
      // XS guard map uses internal names (Y field), not source names
      const instructions = decryptor.decrypt(fn, fn.Y || internalName);

      // 4b: Disassemble
      const disasmResult = disasm(instructions, strings, fnStringMap);

      if (dumpDisasm) {
        const { dumpDisasm: dumpFn } = require('./lib/disasm');
        disasmLines.push('=== Function ' + fi + ': ' + fnName + ' ===');
        disasmLines.push(dumpFn(disasmResult));
        disasmLines.push('');
      }

      // 4c: Lift to IR
      const liftResult = lift(disasmResult, fn, strings, fnStringMap);

      // 4d: Structure recovery
      let structured = structure(liftResult);

      // 4d.5: Normalize IR
      structured = normalize(structured);

      // 4e: Emit JavaScript
      // Build function params from IL metadata
      const params = [];
      for (let p = 0; p < (fn.r || 0); p++) params.push('arg' + p);

      const flags = {
        async: !!fn.fE,
        generator: !!fn.ag,
      };

      const funcDecl = ir.functionDecl(fnName, params, structured, flags);
      const jsSource = emit(funcDecl);

      output.push(jsSource);
      output.push('');
      successCount++;

      if (verbose) console.log('[main] OK: ' + fnName + ' (' + instructions.length + ' instructions)');
    } catch (e) {
      output.push('/* decompile error [' + fnName + ']: ' + e.message.replace(/\*\//g, '* /') + ' */');
      output.push('');
      failCount++;

      if (verbose) console.warn('[main] FAIL: ' + fnName + ': ' + e.message);
    }
  }

  // Step 5: Write output
  const header = [
    '// PrimeVeil v1.0.5 — Devirtualized output',
    '// Generated by primeveil-deobfuscator',
    '// Functions: ' + successCount + ' OK, ' + failCount + ' failed',
    '// Total: ' + fnEntries.length,
    '',
  ].join('\n');

  // Post-processing: beautify the final output
  const rawOutput = header + output.join('\n');
  const finalOutput = beautify(rawOutput);

  try {
    fs.writeFileSync(outputFile, finalOutput, 'utf-8');
    console.log('Output written to:', outputFile);
    console.log('Results: ' + successCount + '/' + fnEntries.length + ' functions decompiled successfully');
  } catch (e) {
    console.error('Error writing output:', e.message);
    process.exit(1);
  }

  // Write disasm dump if requested
  if (dumpDisasm && disasmLines.length > 0) {
    const disasmFile = inputFile.replace(path.extname(inputFile), '.disasm.txt');
    try {
      fs.writeFileSync(disasmFile, disasmLines.join('\n'), 'utf-8');
      console.log('Disassembly written to:', disasmFile);
    } catch (e) {
      console.error('Error writing disassembly:', e.message);
    }
  }

  if (failCount > 0) {
    process.exit(failCount === fnEntries.length ? 1 : 0);
  }
})();
