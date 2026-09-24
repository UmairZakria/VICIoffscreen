// Throwaway scanner: locate the first unbalanced paren/brace/bracket in a JS file.
// Run: node scratch/balance_scan.js <file>
// Handles line/block comments, '...' / "..." strings and regex literals (heuristic).

const fs = require('fs');

const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');

const PAIRS = { '(': ')', '{': '}', '[': ']' };
const CLOSERS = { ')': '(', '}': '{', ']': '[' };
const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>', '\n']);
const KEYWORDS = ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof', 'do', 'else', 'yield', 'await'];

const stack = [];
let line = 1;
let i = 0;
let lastSignificant = '';
let word = '';

function push(ch, atLine, column) {
  stack.push({ ch, line: atLine, column });
}

function pop(ch, atLine, column) {
  const top = stack.pop();
  if (!top) {
    console.log(`EXTRA ${ch} at line ${atLine} col ${column} (nothing open)`);
    return;
  }
  if (PAIRS[top.ch] !== ch) {
    console.log(`MISMATCH: "${top.ch}" opened at line ${top.line} col ${top.column} but closed by "${ch}" at line ${atLine} col ${column}`);
  }
}

let mode = 'code';
while (i < src.length) {
  const ch = src[i];
  const next = src[i + 1];

  if (ch === '\n') line++;

  if (mode === 'line-comment') {
    if (ch === '\n') mode = 'code';
    i++;
    continue;
  }
  if (mode === 'block-comment') {
    if (ch === '*' && next === '/') {
      mode = 'code';
      i += 2;
      continue;
    }
    i++;
    continue;
  }
  if (mode === 'string') {
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === modeQuote) mode = 'code';
    i++;
    continue;
  }
  if (mode === 'regex') {
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '[') mode = 'regex-class';
    else if (ch === '/') mode = 'code';
    i++;
    continue;
  }
  if (mode === 'regex-class') {
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === ']') mode = 'regex';
    i++;
    continue;
  }

  // code
  if (ch === '/' && next === '/') {
    mode = 'line-comment';
    i += 2;
    continue;
  }
  if (ch === '/' && next === '*') {
    mode = 'block-comment';
    i += 2;
    continue;
  }
  if (ch === "'" || ch === '"') {
    mode = 'string';
    modeQuote = ch;
    i++;
    continue;
  }
  if (ch === '/') {
    const isRegex = REGEX_PREV.has(lastSignificant) || KEYWORDS.includes(word);
    if (isRegex) {
      mode = 'regex';
      i++;
      continue;
    }
  }
  if (PAIRS[ch]) {
    push(ch, line, i - src.lastIndexOf('\n', i - 1));
    lastSignificant = ch;
    i++;
    continue;
  }
  if (CLOSERS[ch]) {
    pop(ch, line, i - src.lastIndexOf('\n', i - 1));
    lastSignificant = ch;
    i++;
    continue;
  }
  if (ch === '\n') {
    lastSignificant = '\n';
    i++;
    continue;
  }
  if (/\s/.test(ch)) {
    i++;
    continue;
  }

  if (/[A-Za-z_$]/.test(ch)) {
    let j = i;
    while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
    word = src.slice(i, j);
    lastSignificant = 'w';
    i = j;
    continue;
  }

  lastSignificant = ch;
  i++;
}

console.log(`\n${file}: unclosed constructs left on the stack: ${stack.length}`);
stack.forEach((s) => console.log(`  "${s.ch}" opened at line ${s.line} col ${s.column}`));
