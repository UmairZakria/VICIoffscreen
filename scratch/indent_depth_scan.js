// Throwaway scanner: finds the line where a JS file silently stays one block deeper
// than its indentation says, which is what a missing "}" looks like.
// Run: node scratch/indent_depth_scan.js <file>

const fs = require('fs');

const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const lines = src.split(/\r?\n/);

const PAIRS = { '(': ')', '{': '}', '[': ']' };
const CLOSERS = new Set([')', '}', ']']);
const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>', '\n']);
const KEYWORDS = ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof', 'do', 'else', 'yield', 'await'];

let depth = 0;
let mode = 'code';
let quote = '';
let lastSignificant = '';
let word = '';

lines.forEach((lineText, idx) => {
  const lineNo = idx + 1;
  const depthAtStart = depth;
  const indent = lineText.match(/^ */)[0].length;
  const firstChar = (lineText.trim()[0] || '');

  // flag silently-nested top level lines (indent 2 = inside the IIFE body)
  if (indent === 2 && depthAtStart > 1 && firstChar !== '}' && firstChar !== ')' && firstChar !== ']' && lineText.trim() !== '') {
    console.log(`line ${lineNo} (depth ${depthAtStart}, indent ${indent}): ${lineText.trim().slice(0, 90)}`);
  }

  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    const next = lineText[i + 1];

    if (mode === 'line-comment') break;
    if (mode === 'block-comment') {
      if (ch === '*' && next === '/') {
        mode = 'code';
        i++;
      }
      continue;
    }
    if (mode === 'string') {
      if (ch === '\\') i++;
      else if (ch === quote) mode = 'code';
      continue;
    }
    if (mode === 'regex') {
      if (ch === '\\') i++;
      else if (ch === '[') mode = 'regex-class';
      else if (ch === '/') mode = 'code';
      continue;
    }
    if (mode === 'regex-class') {
      if (ch === '\\') i++;
      else if (ch === ']') mode = 'regex';
      continue;
    }

    if (ch === '/' && next === '/') {
      mode = 'line-comment';
      continue;
    }
    if (ch === '/' && next === '*') {
      mode = 'block-comment';
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      mode = 'string';
      quote = ch;
      lastSignificant = ch;
      continue;
    }
    if (ch === '/' && (REGEX_PREV.has(lastSignificant) || KEYWORDS.includes(word))) {
      mode = 'regex';
      continue;
    }
    if (PAIRS[ch]) {
      depth++;
      lastSignificant = ch;
      word = '';
      continue;
    }
    if (CLOSERS.has(ch)) {
      depth--;
      lastSignificant = ch;
      word = '';
      continue;
    }
    if (/\s/.test(ch)) continue;
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < lineText.length && /[A-Za-z0-9_$]/.test(lineText[j])) j++;
      word = lineText.slice(i, j);
      lastSignificant = 'w';
      i = j - 1;
      continue;
    }
    lastSignificant = ch;
    word = '';
  }

  if (mode === 'line-comment' || mode === 'block-comment') mode = mode === 'line-comment' ? 'code' : mode;
});

console.log(`\nfinal depth: ${depth} (0 = balanced)`);
