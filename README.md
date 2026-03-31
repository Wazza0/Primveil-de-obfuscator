# primeveil-deobfuscator

static devirtualizer for PrimeVeil v1.0.5 VM-protected javascript

## usage

```
node index.js obfuscated.js -o clean.js
```

standalone vm:
```js
const pv = require('./vm.js'); const blob = JSON.parse(fs.readFileSync('blob.json'));
pv.run(blob);
```

## what it does

six stage pipeline: extract → decrypt → disassemble → lift → structure → emit. pure static analysis, no program execution.

- named functions with correct signatures (async, generator, param count)
- resolved string constants, structured control flow (if/else/while/try-catch), cleaned expressions
- 100% decryption accuracy (9370/9370 validated against VM), 162 functions devirtualized, zero dependencies, node 18+

## limitations

- only primeveil v1.0.5
- variable names are generic (lost during compilation)
- some gotos remain for complex control flow
- scope/closure values are approximated

## how it works

extracts encrypted bytecode blob via sandbox, decrypts per-function with Dh decompression + Ge XOR + rolling key with guard maps and anti-tamper simulation, lifts to typed IR via symbolic stack simulation with forward dataflow propagation, recovers control flow via dominator/post-dominator analysis, normalizes and beautifies output

## structure

```
index.js        cli + pipeline
vm.js           standalone extracted vm
lib/
  extract.js    blob + crypto extraction
  decrypt.js    Dh decompress + XOR decrypt
  disasm.js     instruction enrichment
  opcodes.js    140 opcode definitions
  ir.js         typed IR nodes
  lift.js       symbolic stack sim → IR
  structure.js  dominator-based CFG recovery
  normalize.js  IR cleanup
  beautify.js   text-level post-processing
  emit.js       IR → javascript
  sandbox.js    V8 sandbox factory
```
