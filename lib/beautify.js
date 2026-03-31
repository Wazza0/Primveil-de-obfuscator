'use strict';

/**
 * Text-level post-processing for emitted JavaScript.
 * Cleans up patterns that survive IR normalization.
 */
function beautify(source) {
  let lines = source.split('\n');

  for (let pass = 0; pass < 3; pass++) {
    const before = lines.length;
    lines = removeEmptyBlocks(lines);
    lines = removeRedundantTypeof(lines);
    lines = cleanExpressions(lines);
    lines = removeOrphanLabels(lines);
    lines = removeUnreachableAfterReturn(lines);
    lines = collapseRedundantGotos(lines);
    lines = renameStackVars(lines);
    lines = cleanFormatting(lines);
    if (lines.length === before) break;
  }

  return lines.join('\n');
}

// Remove empty if/else blocks and empty labeled blocks
function removeEmptyBlocks(lines) {
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    // Empty else: "} else {\n}"
    if (t === '} else {' && i + 1 < lines.length && lines[i + 1].trim() === '}') {
      result.push(lines[i].replace('} else {', '}'));
      i++; // skip the closing }
      continue;
    }

    // Empty if: "if (...) {\n}"
    if (t.startsWith('if (') && t.endsWith('{') && i + 1 < lines.length && lines[i + 1].trim() === '}') {
      i++; // skip both
      continue;
    }

    // Empty labeled block: "L_N: {\n}"
    if (/^L_\d+:\s*\{/.test(t) && i + 1 < lines.length && lines[i + 1].trim() === '}') {
      i++;
      continue;
    }

    // Lines with excessive stk_ (>5 unique) — unreachable noise
    if ((t.match(/stk_/g) || []).length > 10) {
      result.push(lines[i].substring(0, lines[i].indexOf('stk_')) + '/* unreachable */');
      continue;
    }

    result.push(lines[i]);
  }
  return result;
}

// Remove redundant typeof wrappers
// "typeof var_N" used as a value (not in typeof context) → "var_N"
function removeRedundantTypeof(lines) {
  return lines.map(line => {
    // Don't touch actual typeof checks: typeof X === "string" etc
    if (/typeof\s+\w+\s*===\s*"/.test(line)) return line;
    if (/typeof\s+\w+\s*!==\s*"/.test(line)) return line;

    // typeof var_N used as argument, assignment value, or property → just var_N
    // Pattern: typeof var_N followed by ) or , or ] or ; or . or [ (not ===)
    let result = line;
    result = result.replace(/typeof (var_\d+)(?=\s*[),;\].\[])/g, '$1');
    result = result.replace(/typeof (var_\d+)(?=\s*$)/g, '$1');

    // typeof <identifier> used as assignment value: X = typeof Y → X = Y
    // Only when not followed by comparison
    result = result.replace(/=\s*typeof (\w+)\s*;/g, '= $1;');

    // typeof in return: return typeof X; → return X; (unless it's an actual typeof check)
    if (/^\s*return typeof \w+;$/.test(result) && !/===|!==/.test(result)) {
      result = result.replace(/return typeof (\w+);/, 'return $1;');
    }

    return result;
  });
}

// Clean up expression patterns
function cleanExpressions(lines) {
  return lines.map(line => {
    let r = line;

    // 0[prop] → scope[prop] (numeric literal as object base)
    r = r.replace(/\b0\[/g, 'scope[');

    // "0" as variable name → v0
    r = r.replace(/"0"/g, 'v0');

    // Double negation: !!x → x (in boolean context)
    r = r.replace(/!!(\w+)/g, '$1');

    // x === true → x
    r = r.replace(/(\w+) === true/g, '$1');

    // x === false → !x
    r = r.replace(/(\w+) === false/g, '!$1');

    // Simplify: x - x → 0, x ^ x → 0
    r = r.replace(/(\w+) - \1(?!\w)/g, '0');
    r = r.replace(/(\w+) \^ \1(?!\w)/g, '0');

    // Remove trailing semicolons from comments
    r = r.replace(/\/\*.*?\*\/;$/g, m => m.slice(0, -1));

    return r;
  });
}

// Remove labels that no goto points to
function removeOrphanLabels(lines) {
  // Collect all goto targets
  const targets = new Set();
  for (const l of lines) {
    const m = l.match(/goto (L_\d+)/);
    if (m) targets.add(m[1]);
  }

  return lines.filter(l => {
    const labelMatch = l.trim().match(/^(L_\d+):\s*\{?$/);
    if (labelMatch && !targets.has(labelMatch[1])) {
      // Orphan label — check if it's just "L_N: {", if so also skip next "}"
      return false;
    }
    return true;
  });
}

// Remove code after unconditional return/throw within same block
function removeUnreachableAfterReturn(lines) {
  const result = [];
  let depth = 0;
  let unreachable = false;
  let unreachableDepth = 0;

  for (const line of lines) {
    const t = line.trim();

    // Track brace depth
    for (const c of t) {
      if (c === '{') depth++;
      if (c === '}') {
        depth--;
        if (unreachable && depth < unreachableDepth) {
          unreachable = false;
        }
      }
    }

    if (unreachable && depth >= unreachableDepth && t !== '}') {
      continue; // skip unreachable line
    }

    result.push(line);

    // Mark unreachable after return/throw at current depth
    if (/^\s*(return\b|throw\b)/.test(t) && !t.includes('{')) {
      unreachable = true;
      unreachableDepth = depth;
    }
  }

  return result;
}

// Collapse redundant gotos: goto L_X immediately before L_X: → remove goto
function collapseRedundantGotos(lines) {
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const gotoMatch = t.match(/^\/\* goto (L_\d+) \*\/$/);
    if (gotoMatch) {
      // Check if next non-empty, non-brace line is the target label
      let found = false;
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const nt = lines[j].trim();
        if (nt === '' || nt === '}' || nt === '{') continue;
        if (nt.startsWith(gotoMatch[1] + ':')) { found = true; break; }
        break;
      }
      if (found) continue; // skip redundant goto
    }
    result.push(lines[i]);
  }
  return result;
}

// Rename stk_N_M to t0, t1, ... and ctx_N to ctx[N]
function renameStackVars(lines) {
  const stkMap = new Map();
  let counter = 0;

  return lines.map(line => {
    let r = line;

    // Replace stk_N_M with tN (short temporaries)
    r = r.replace(/stk_\d+_\d+/g, match => {
      if (!stkMap.has(match)) stkMap.set(match, 't' + (counter++));
      return stkMap.get(match);
    });

    // Replace ctx_N with ctx[N] for readability
    r = r.replace(/ctx_(\d+)/g, 'ctx[$1]');

    return r;
  });
}

// Final formatting cleanup
function cleanFormatting(lines) {
  const result = [];
  let prevEmpty = false;

  for (const line of lines) {
    const t = line.trim();

    // Collapse multiple empty lines
    if (t === '') {
      if (prevEmpty) continue;
      prevEmpty = true;
    } else {
      prevEmpty = false;
    }

    // Remove lines that are just a semicolon
    if (t === ';') continue;

    // Remove lines that are just "undefined;"
    if (t === 'undefined;') continue;

    result.push(line);
  }

  return result;
}

module.exports = { beautify };
