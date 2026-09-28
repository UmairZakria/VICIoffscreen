// Regression harness for the infolookup.site "This number was just searched" guard.
// Run with:  node scratch/infolookup_repeat_search_test.js
//
// infolookup.site declares `let lastSearchedNumber = ''` at the top level of a classic <script>,
// and refuses a lookup when `phoneRaw === lastSearchedNumber`. That binding lives in the page's
// global *lexical* environment, so `window.lastSearchedNumber = ''` creates a stray window property
// and never touches the real variable - which is why repeat lookups kept failing. This harness
// runs the shipped reset helper inside a real VM context that models both scopes.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

let passed = 0;
const failures = [];
function ok(name, condition) {
  if (condition) {
    passed++;
  } else {
    failures.push(name);
    console.log('FAIL  ' + name);
  }
}

// Pull the shipped helper out of content.js so we test the real code, not a copy of it.
function sliceFn(src, signature) {
  const a = src.indexOf(signature);
  if (a === -1) throw new Error('Could not find ' + signature);
  const b = src.indexOf('\n  }\n', a);
  if (b === -1) throw new Error('Could not find end of ' + signature);
  return src.slice(a, b + '\n  }\n'.length);
}

const resetFnSrc = sliceFn(src, 'function resetInfolookupDuplicateGuard()');

// Builds a context that models the page: a main-world global with a top-level `let` binding, plus
// a `document` whose appendChild executes injected scripts in that same main world (blockedScript
// simulates a CSP that refuses to run them).
function makePage({ blockedScript = false } = {}) {
  const attrs = {};
  const win = {};
  const ctx = vm.createContext({ window: win, console, setTimeout });
  ctx.window = ctx;

  // The site's real declaration, in the global lexical environment.
  vm.runInContext('let lastSearchedNumber = "";', ctx);

  ctx.document = {
    createElement: () => ({ textContent: '', remove() {} }),
    documentElement: {
      setAttribute: (k, v) => { attrs[k] = String(v); },
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      removeAttribute: (k) => { delete attrs[k]; },
      appendChild(el) {
        if (blockedScript) return; // CSP refused to execute the injected script
        vm.runInContext(el.textContent, ctx);
      }
    }
  };

  ctx.__readLastSearched = () => vm.runInContext('lastSearchedNumber', ctx);
  ctx.__reset = vm.runInContext('(' + resetFnSrc + ')', ctx);
  return ctx;
}

// ---------------------------------------------------------------------------
// 1. The old approach really did nothing (documents the original bug)
// ---------------------------------------------------------------------------
{
  const ctx = makePage();
  vm.runInContext('lastSearchedNumber = "5551234567";', ctx);
  vm.runInContext('window.lastSearchedNumber = "";', ctx);
  ok(
    'window.lastSearchedNumber = "" leaves the site guard untouched',
    ctx.__readLastSearched() === '5551234567'
  );
  ok('window.lastSearchedNumber = "" does create a stray window property', vm.runInContext('window.lastSearchedNumber', ctx) === '');
}

// ---------------------------------------------------------------------------
// 2. The shipped reset actually clears the site's guard
// ---------------------------------------------------------------------------
{
  const ctx = makePage();
  vm.runInContext('lastSearchedNumber = "5551234567";', ctx);
  const returned = ctx.__reset();
  ok('reset reports success on a normal page', returned === true);
  ok("reset empties the site's lastSearchedNumber binding", ctx.__readLastSearched() === '');
}

// ---------------------------------------------------------------------------
// 3. Repeat lookups are unblocked: after a reset the site's own check passes
// ---------------------------------------------------------------------------
{
  const ctx = makePage();
  const phone = '5551234567';
  // Mirrors test2.js: showError + abort when the number equals the last searched one.
  const siteGuard = (raw) => vm.runInContext(
    '(function(raw){' +
    '  if (raw === lastSearchedNumber) { return "This number was just searched. Please try a different number."; }' +
    '  lastSearchedNumber = raw; return null;' +
    '})', ctx)(phone);

  vm.runInContext(`lastSearchedNumber = ${JSON.stringify(phone)};`, ctx);
  ok('searching the same number twice is blocked before the reset', siteGuard(phone) !== null);

  ctx.__reset();
  ok('searching the same number twice is allowed after the reset', siteGuard(phone) === null);
}

// ---------------------------------------------------------------------------
// 4. When the injected script cannot run, we must report failure so the
//    caller keeps the DOM and falls back to reading the site's own data
// ---------------------------------------------------------------------------
{
  const ctx = makePage({ blockedScript: true });
  vm.runInContext('lastSearchedNumber = "5551234567";', ctx);
  ok('reset reports failure when script injection is blocked', ctx.__reset() === false);
  ok('a blocked reset does not throw', true);
}

// ---------------------------------------------------------------------------
// 5. Static checks on the shipped file
// ---------------------------------------------------------------------------
// The identifier is allowed to appear in comments explaining the bug, just not in live code.
const codeLines = src.split('\n').filter((line) => {
  const t = line.trim();
  return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
});
const liveCode = codeLines.join('\n');

ok('the broken window.lastSearchedNumber reset is gone from live code', !liveCode.includes('window.lastSearchedNumber'));
ok('content.js still references the site guard by name', src.includes('lastSearchedNumber'));
ok(
  'the duplicate message is handled instead of being an instant failure',
  src.includes("includes('just searched')")
);
ok('a bounded retry exists for the duplicate guard', src.includes('duplicateRetries'));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('Failed: ' + failures.join(', '));
  process.exit(1);
}
