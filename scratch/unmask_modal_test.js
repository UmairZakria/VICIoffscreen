// Regression harness for the Unmask "What age range best fits ...?" prompt detection.
// Run with:  node scratch/unmask_modal_test.js
//
// The detector is sliced out of unmask_automation.js and driven with a hand crafted
// DOM that mirrors the real markup the extension sees on unmask.com name searches.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'unmask_automation.js');
const src = fs.readFileSync(SRC, 'utf8');

function slice(start, end) {
  const a = src.indexOf(start);
  const b = src.indexOf(end);
  if (a === -1 || b === -1 || b <= a) throw new Error(`Could not slice ${start} .. ${end}`);
  return src.slice(a, b);
}

// isElementVisible + isUnmaskAddressNotFound + the two prompt helpers
const block =
  slice('  function isElementVisible(el) {', '  function matchAliasScore(target, aliasStr) {') +
  slice('  function isUnmaskAddressNotFound() {', '  var TOP_EMAIL_DOMAINS = [');

const mod = new Function(
  block + '\nreturn { isElementVisible, isUnmaskAddressNotFound, looksLikeAgeRangePrompt, isUnmaskAgeRangePrompt };'
)();

// ---- fake DOM --------------------------------------------------------------
function titleNode(text) {
  return { textContent: text, value: '', getBoundingClientRect: () => ({ width: 240, height: 24 }) };
}

function buttonNode(value) {
  return { value, textContent: '', getBoundingClientRect: () => ({ width: 90, height: 32 }) };
}

// Mirrors: <div role="dialog" aria-modal="true" class="tzModal ...">
//            <div class="wl-modal-form">
//              <p class="wl-modal-form__title">What age range best fits Charles?</p>
//              <input type="button" value="18-29" class="wl-modal-form__input-field--button">
function modalNode(opts) {
  const titleText = opts.titleText === undefined ? null : opts.titleText;
  const titleEl = titleText === null ? null : titleNode(titleText);
  const buttons = (opts.buttonValues || []).map(buttonNode);
  const node = {
    textContent: titleText || '',
    getBoundingClientRect: () => (opts.hidden ? { width: 0, height: 0 } : { width: 620, height: 380 }),
    querySelector: (sel) => (sel === '.wl-modal-form__title' ? titleEl : null),
    querySelectorAll: (sel) => (sel.indexOf("input[type='button']") !== -1 ? buttons : []),
  };
  if (opts.displayNone) node.style = { display: 'none' };
  return node;
}

function setupDom(opts) {
  const o = opts || {};
  const modals = o.modals || [];
  globalThis.document = {
    querySelectorAll: (sel) => {
      if (sel.indexOf('clickable.person') !== -1) return o.cards || [];
      if (sel.indexOf('.um-dialog__title') !== -1) return o.dialogHeaders || [];
      if (sel.indexOf('.um-results__none') !== -1) return o.noneBoxes || [];
      if (sel.indexOf('.tzModal') !== -1) return modals;
      return [];
    },
  };
  globalThis.window = {
    getComputedStyle: (el) => (el && el.style ? el.style : { display: 'block', visibility: 'visible', opacity: '1' }),
  };
}

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

// The exact prompt markup the extension receives on a name search page.
const AGE_PROMPT_MODAL = modalNode({
  titleText: 'What age range best fits Charles?',
  buttonValues: ['18-29', '30-49', '50-99'],
});

// ==== TESTS ====
console.log('\n== Unmask age-range prompt detection ==\n');

// 1. Pure classifier
check('classifier: real prompt title', mod.looksLikeAgeRangePrompt('What age range best fits Charles?', []), true);
check('classifier: real prompt buttons', mod.looksLikeAgeRangePrompt('', ['18-29', '30-49', '50-99']), true);
check('classifier: any first name in the title', mod.looksLikeAgeRangePrompt('What age range best fits Benita?', []), true);
check('classifier: unrelated dialog', mod.looksLikeAgeRangePrompt('Try Searching Another Address', []), false);
check('classifier: single submit button', mod.looksLikeAgeRangePrompt('Confirm', ['Submit']), false);
check('classifier: one range button only', mod.looksLikeAgeRangePrompt('', ['18-29']), false);
check('classifier: empty everything', mod.looksLikeAgeRangePrompt('', []), false);

// 2. DOM traversal - the pasted prompt must be detected
setupDom({ modals: [AGE_PROMPT_MODAL] });
check('detects the pasted prompt', mod.isUnmaskAgeRangePrompt(), true);
check('prompt is not mistaken for a "no records" dialog', mod.isUnmaskAddressNotFound(), false);

// 3. No prompt on a normal name search page
setupDom({ modals: [] });
check('no modal -> no prompt', mod.isUnmaskAgeRangePrompt(), false);

// 4. A prompt that is not rendered must be ignored
setupDom({ modals: [modalNode({ titleText: 'What age range best fits Charles?', hidden: true })] });
check('zero sized prompt ignored', mod.isUnmaskAgeRangePrompt(), false);

setupDom({ modals: [modalNode({ titleText: 'What age range best fits Charles?', displayNone: true })] });
check('display:none prompt ignored', mod.isUnmaskAgeRangePrompt(), false);

// 5. A different modal must not be mistaken for the age prompt
setupDom({ modals: [modalNode({ titleText: 'We value your privacy', buttonValues: ['Accept', 'Reject'] })] });
check('unrelated modal ignored', mod.isUnmaskAgeRangePrompt(), false);

// 6. The range buttons alone are enough to identify the prompt
setupDom({ modals: [modalNode({ titleText: '', buttonValues: ['18-29', '30-49', '50-99'] })] });
check('range buttons alone are enough', mod.isUnmaskAgeRangePrompt(), true);

// 7. Existing not-found detection still works (regression)
setupDom({
  modals: [],
  dialogHeaders: [{ textContent: 'Try Searching Another Address', getBoundingClientRect: () => ({ width: 300, height: 40 }) }],
});
check('existing "try another address" dialog still detected', mod.isUnmaskAddressNotFound(), true);

setupDom({
  modals: [],
  noneBoxes: [{ textContent: 'No records found for this name', getBoundingClientRect: () => ({ width: 300, height: 40 }) }],
});
check('existing "no records found" banner still detected', mod.isUnmaskAddressNotFound(), true);

setupDom({ modals: [], cards: [{}] });
check('cards on the page -> never "not found"', mod.isUnmaskAddressNotFound(), false);

console.log(`\n=== TOTAL: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
