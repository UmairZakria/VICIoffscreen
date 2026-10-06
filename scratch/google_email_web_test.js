// Regression tests for ordinary Google result/snippet email extraction.
// Run with: node scratch/google_email_web_test.js

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'google_email_automation.js'), 'utf8');

function slice(start, end, label) {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  if (a < 0 || b < 0 || b <= a) throw new Error(`Could not slice ${label}`);
  return src.slice(a, b);
}

function liftFunction(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Could not find ${name}`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`Unbalanced function ${name}`);
}

const block = [
  slice('var EMAIL_RE', 'function isVisible', 'email constants'),
  liftFunction('isVisible'),
  slice('var NON_ANSWER_EMAIL_RE', '// ------------------------------------------------------------- removing the search-history entry', 'email extraction'),
  liftFunction('resultMiddleNameMatches'),
  'function setResults(blocks) { document.querySelectorAll = () => blocks; }',
  'return { extractEmailFromSearchResults, isLowConfidenceEmail, setResults };'
].join('\n');

const api = new Function('document', 'window', block)({
  querySelectorAll: () => []
}, {
  getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
});

function result(text, options = {}) {
  const mailtos = options.mailtos || [];
  const metas = options.metas || [];
  return {
    innerText: text,
    getBoundingClientRect: () => ({ width: 300, height: 50 }),
    querySelectorAll(selector) {
      if (selector === 'a[href^="mailto:"]') return mailtos.map((email) => ({
        getAttribute: () => `mailto:${email}`
      }));
      return metas.map((value) => ({ getAttribute: () => value }));
    }
  };
}

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) console.log(`  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
}

const target = 'Kevin Scott McQue';
const evidence = {
  street: '1215 W Pleasant Run Rd',
  city: 'DeSoto',
  state: 'TX',
  zip: '75115',
  year: '1955'
};

api.setResults([
  result('Kevin Scott McQue | DeSoto, TX 75115 | Public email: kevin.mcque@example.org'),
  result('Kevin Scott McQue | DeSoto, TX 75115 | Email: ksmcque@yahoo.com')
]);
check('Google results return the first corroborated public email',
  api.extractEmailFromSearchResults(target, evidence),
  { emails: ['ksmcque@yahoo.com'], primary: 'ksmcque@yahoo.com', note: 'Google Search result' });

api.setResults([
  result('Kevin Scott McQue | DeSoto, TX 75115 | Email: ksmcque@yahoo.com')
]);
check('middle-name detail can be omitted when first, last, and location match',
  api.extractEmailFromSearchResults('Kevin S McQue', evidence)?.primary,
  'ksmcque@yahoo.com');

api.setResults([
  result('Kevin Scott McQue | Email: ksmcque@yahoo.com')
]);
check('a name-only result is rejected without location or birth-year evidence',
  api.extractEmailFromSearchResults(target, evidence), null);

api.setResults([
  result('Kevin McQue | Canton, OH 44718 | Email: other@yahoo.com')
]);
check('a same-name result at a different location is rejected',
  api.extractEmailFromSearchResults(target, evidence), null);

api.setResults([
  result('Other Person | DeSoto, TX 75115 | Email: other@yahoo.com')
]);
check('a location match without the target name is rejected',
  api.extractEmailFromSearchResults(target, evidence), null);

api.setResults([
  result('Kevin Scott McQue | DeSoto, TX 75115 | Household email for relatives: relative@yahoo.com')
]);
check('a household-only email is not assigned to the target',
  api.extractEmailFromSearchResults(target, evidence), null);

api.setResults([
  result('Kevin Scott McQue | Born 1955 | DeSoto, TX | Email listed publicly', {
    mailtos: ['kevin.mcque@sample.net']
  })
]);
check('a public mailto address in a corroborated search result is extracted',
  api.extractEmailFromSearchResults(target, evidence)?.primary,
  'kevin.mcque@sample.net');

api.setResults([
  result('Kevin Scott McQue | born in 1955 | DeSoto TX | Email: ksmcque@yahoo.com', {
    metas: ['Search snippet metadata: ksmcque@yahoo.com']
  })
]);
check('a corroborated Google result can include metadata text',
  api.extractEmailFromSearchResults(target, evidence)?.primary,
  'ksmcque@yahoo.com');

const quality = api.isLowConfidenceEmail;
check('placeholder x address is low confidence', quality('xxxxxxxxxx@gmail.com'), true);
check('very short local part is low confidence', quality('yr@aol.com'), true);
check('ordinary named address is not low confidence', quality('kevin.mcque@yahoo.com'), false);

const flow = new Function(
  'const CLEANUP_GIVE_UP_AFTER_MS = 90000;' +
  'const calls = [];' +
  'function reportPossibleEmail(found, query, mode) { calls.push(["possible", found.primary, query, mode]); }' +
  'function requestNextAddress(state, message) { calls.push(["next", message]); }' +
  'function succeed() { calls.push(["success"]); }' +
  'function startHistoryCleanupTrip(found, query) { calls.push(["cleanup", found.primary, query]); }' +
  liftFunction('isLowConfidenceEmail') +
  liftFunction('acceptOrContinue') +
  'return { calls, run: acceptOrContinue };'
)();
flow.run({ primary: 'yr@aol.com' }, { startedAt: Date.now(), interval: null }, 'search query', 'web');
check('a low-confidence email is retained and triggers another query',
  flow.calls.map((call) => call[0]),
  ['possible', 'next']);

const trustedFlow = new Function(
  'const CLEANUP_GIVE_UP_AFTER_MS = 90000;' +
  'const calls = [];' +
  'function reportPossibleEmail() { calls.push(["possible"]); }' +
  'function requestNextAddress() { calls.push(["next"]); }' +
  'function succeed() { calls.push(["success"]); }' +
  'function startHistoryCleanupTrip(found, query) { calls.push(["cleanup", found.primary, query]); }' +
  liftFunction('isLowConfidenceEmail') +
  liftFunction('acceptOrContinue') +
  'return { calls, run: acceptOrContinue };'
)();
trustedFlow.run({ primary: 'kevin.mcque@yahoo.com' }, { startedAt: Date.now(), interval: null }, 'search query', 'web');
check('a normal email ends the search via result cleanup',
  trustedFlow.calls.map((call) => call[0]),
  ['cleanup']);

console.log(`\n${failures ? `${failures} test(s) failed` : 'all tests passed'}`);
process.exit(failures ? 1 : 0);
