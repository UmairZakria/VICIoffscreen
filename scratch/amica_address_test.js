// Regression harness for the Amica address step (STEP 2).
// Run with:  node scratch/amica_address_test.js
//
// Covers: Amica rejecting an address (the street field carries class "invalid"), walking
// the person's other addresses, then asking Nominatim for a validated address, then
// giving up with a message.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'amica_automation.js');
const src = fs.readFileSync(SRC, 'utf8');

function slice(start, end) {
  const a = src.indexOf(start);
  const b = src.indexOf(end);
  if (a === -1 || b === -1 || b <= a) throw new Error(`Could not slice ${start} .. ${end}`);
  return src.slice(a, b);
}

const block =
  slice('  function isPoBox(addrStr) {', '  function setSelectValue(select, value) {') +
  slice('  function clickElement(el) {', '  function copyToClipboard(text) {') +
  slice('  var ADDRESS_SETTLE_MS = 400;', '  // Automation Engine');

let log = [];
let geocodeResult = null;
let nextAddressReply = { ok: true };

const chromeMock = {
  runtime: {
    sendMessage: (msg, cb) => {
      if (msg.action === 'GEOCODE_ADDRESS') {
        log.push('geocode:' + ((msg.address && msg.address.street) || ''));
        if (cb) cb(geocodeResult ? { success: true, address: geocodeResult } : { success: false });
      }
      if (msg.action === 'AMICA_NEXT_ADDRESS') {
        log.push('next:' + msg.usedUpTo + ':' + ((msg.candidates || []).length));
        if (cb) cb(nextAddressReply);
      }
    },
  },
  // The real clearPendingQuote() lives inside the slice, so it is observed through the API it calls
  // rather than by standing in for it.
  storage: {
    local: {
      remove: () => {
        log.push('clearQuote');
        return Promise.resolve();
      },
    },
  },
};

const mod = new Function(
  'sendProgress',
  'sendEmpty',
  'chrome',
  block +
    '\nreturn { buildAddressCandidates, applyAddressTo, handleAddressStep, describeAddress, retryWithNextAddress };'
)(
  (step, total, message) => log.push('progress:' + message),
  (message) => log.push('empty:' + message),
  chromeMock
);

let passed = 0;
let failed = 0;
let clicks = 0;

// fillAndTypeInput() looks up the native value setter through window
globalThis.window = { HTMLInputElement: { prototype: {} } };

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

function fakeInput(id) {
  const classes = new Set();
  return {
    id,
    value: '',
    classList: {
      contains: (c) => classes.has(c),
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
    },
    focus: () => {},
    dispatchEvent: () => {},
    setAttribute: () => {},
    closest: () => null,
    markInvalid: () => classes.add('invalid'),
    isInvalid: () => classes.has('invalid'),
  };
}

function fakeButton() {
  return {
    id: 'quoteActionButton',
    disabled: false,
    closest: () => null,
    scrollIntoView: () => {},
    focus: () => {},
    getAttribute: () => null,
    // clickElement() sends the pointer/mouse sequence and exactly one click: only the click
    // counts as a submission.
    dispatchEvent: (ev) => {
      if (ev.type === 'click') clicks++;
    },
  };
}

function makeForm() {
  return {
    streetInput: fakeInput('street'),
    streetTwoInput: fakeInput('street2'),
    cityInput: fakeInput('city'),
    stateInput: fakeInput('state'),
    zipAddrInput: fakeInput('zip'),
    startQuoteBtn: fakeButton(),
  };
}

function makeState() {
  return {
    stopped: false,
    lastActionTime: 0,
    addressCandidates: null,
    addressAttempt: 0,
    addressFilledAt: 0,
    addressClickedAt: 0,
    geocodeAsked: false,
    geocodePending: false,
  };
}

const PROFILE = {
  address: { street: '11 Bad Rd', city: 'Akron', state: 'OH', zip: '44321' },
  allAddresses: [
    { street: '11 Bad Rd', city: 'Akron', state: 'OH', zip: '44321' },
    { street: '22 Alsobad Ave', city: 'Akron', state: 'OH', zip: '44313' },
    { street: '33 Third St', city: 'Akron', state: 'OH', zip: '44305' },
    { street: 'PO Box 55', city: 'Akron', state: 'OH', zip: '44309' },
  ],
};

console.log('\n== Amica address step ==\n');

// ---- candidate list ---------------------------------------------------------
check('primary address first, duplicates dropped', mod.buildAddressCandidates(PROFILE).length, 3);
check(
  'candidate order',
  mod.buildAddressCandidates(PROFILE).map((a) => a.street),
  ['11 Bad Rd', '22 Alsobad Ave', '33 Third St']
);
check('PO box never used', mod.buildAddressCandidates(PROFILE).some((a) => /po box/i.test(a.street)), false);
check('plain string addresses are accepted', mod.buildAddressCandidates({ address: '9 Raw St' }).length, 1);
check('empty profile -> no candidates', mod.buildAddressCandidates({}).length, 0);

// ---------------------------------------------------------------------------
// Scenario 1: every address is flagged invalid -> Nominatim saves the quote
// ---------------------------------------------------------------------------
log = [];
clicks = 0;
geocodeResult = { street: '2740 Kibler Rd', city: 'Copley', state: 'OH', zip: '44321' };

const state = makeState();
const form = makeForm();
let t = 1000;

// one "tick" is one run of the automation interval (address form still on screen)
function tick(ms, st, fm, profile) {
  t += ms;
  mod.handleAddressStep(st || state, profile || PROFILE, fm || form, t);
}

tick(0); // first address typed
check('address 1 typed', form.streetInput.value, '11 Bad Rd');
check('city/state/zip typed', [form.cityInput.value, form.stateInput.value, form.zipAddrInput.value], ['Akron', 'OH', '44321']);
check('nothing clicked before the fields settle', clicks, 0);

tick(1000); // submit
check('address 1 submitted', clicks, 1);

form.streetInput.markInvalid();
tick(2000); // Amica flagged it -> move on
check('rejection of address 1 noticed', log.some((l) => l.includes('Amica rejected 11 Bad Rd')), true);

tick(1000); // next attempt is typed
check('address 2 typed', form.streetInput.value, '22 Alsobad Ave');
check('the refill cleared the invalid mark', form.streetInput.isInvalid(), false);

tick(1000);
check('address 2 submitted', clicks, 2);

form.streetInput.markInvalid();
tick(2000);
tick(1000);
check('address 3 typed', form.streetInput.value, '33 Third St');

tick(1000);
check('address 3 submitted', clicks, 3);

form.streetInput.markInvalid();
tick(2000); // no more candidates -> hand over to Nominatim
tick(1000); // Nominatim is asked
check('Nominatim asked after every address failed', log.some((l) => l === 'geocode:11 Bad Rd'), true);

tick(1000); // the validated address is typed
check('validated street typed', form.streetInput.value, '2740 Kibler Rd');
check('validated city/state/zip typed', [form.cityInput.value, form.stateInput.value, form.zipAddrInput.value], ['Copley', 'OH', '44321']);

tick(1000);
check('validated address submitted', clicks, 4);
check('the run is not stopped yet', state.stopped, false);

form.streetInput.markInvalid();
tick(2000); // validated address rejected too -> past the end of the list
tick(1000); // give up
check('no second Nominatim call', log.filter((l) => l.startsWith('geocode:')).length, 1);
check('the user is told', log.some((l) => l.startsWith('empty:Amica rejected every known address')), true);
check('the run is stopped', state.stopped, true);
check('no further clicks', clicks, 4);

// ---------------------------------------------------------------------------
// Scenario 2: Nominatim has nothing either -> same "no valid address" result
// ---------------------------------------------------------------------------
log = [];
clicks = 0;
geocodeResult = null;
const state2 = makeState();
const form2 = makeForm();
const singleProfile = { address: { street: '9 Nowhere Rd', city: 'Akron', state: 'OH', zip: '44321' } };

tick(0, state2, form2, singleProfile);
tick(1000, state2, form2, singleProfile);
check('single address submitted', clicks, 1);

form2.streetInput.markInvalid();
tick(2000, state2, form2, singleProfile);
tick(1000, state2, form2, singleProfile); // Nominatim is asked
check('geocode requested', log.filter((l) => l.startsWith('geocode:')).length, 1);
tick(1000, state2, form2, singleProfile); // ... and has nothing -> give up
check('geocode failure is reported', log.some((l) => l.startsWith('empty:Amica rejected every known address')), true);
check('the run is stopped', state2.stopped, true);

// ---------------------------------------------------------------------------
// Scenario 3: no "invalid" marker but Amica never moves on -> next address
// ---------------------------------------------------------------------------
log = [];
clicks = 0;
const state3 = makeState();
const form3 = makeForm();

tick(0, state3, form3);
tick(1000, state3, form3);
check('address 1 submitted without any marker', clicks, 1);

tick(3000, state3, form3);
check('still waiting inside the give-up window', form3.streetInput.value, '11 Bad Rd');

tick(5000, state3, form3); // total 8s after the click
check('stuck address abandoned', log.some((l) => l.includes('No response for 11 Bad Rd')), true);

tick(1000, state3, form3);
check('address 2 typed', form3.streetInput.value, '22 Alsobad Ave');
tick(1000, state3, form3);
check('address 2 submitted', clicks, 2);

// ---------------------------------------------------------------------------
console.log('\n== no vehicles found: trying the other addresses ==\n');
// ---------------------------------------------------------------------------

{
  // The quote finished and Amica listed no vehicles for the address it used: the next address is
  // asked for instead of the lookup being reported empty.
  log = [];
  nextAddressReply = { ok: true };
  const state = makeState();
  state.addressAttempt = 0;
  mod.retryWithNextAddress(state, PROFILE, 'No vehicles found');

  check('the next address is asked for', log.filter((l) => l.startsWith('next:')), ['next:0:3']);
  check(
    'the line says which address had nothing',
    log.filter((l) => /^progress:No vehicles found for 11 Bad Rd, Akron, OH/.test(l)).length,
    1
  );
  check('the run stops so the page is not driven while it reloads', state.stopped, true);
  check('nothing is reported empty while a retry is still possible', log.filter((l) => l.startsWith('empty:')), []);
}

{
  // Every address has been tried: only then is the lookup reported empty.
  log = [];
  nextAddressReply = { ok: false, exhausted: true };
  const state = makeState();
  mod.retryWithNextAddress(state, PROFILE, 'No vehicles found');

  check('an exhausted run reports empty', log.filter((l) => l.startsWith('empty:')), [
    'empty:No vehicle found on Amica for any known address'
  ]);
  check('and the pending quote is cleared', log.filter((l) => l === 'clearQuote').length, 1);
}

{
  // No background to answer - a page whose extension is being reloaded, say: report empty rather
  // than leaving the widget spinning for ever.
  log = [];
  clearedQuotes = 0;
  const state = makeState();
  const save = chromeMock.runtime.sendMessage;
  chromeMock.runtime.sendMessage = () => {
    throw new Error('Could not establish connection.');
  };
  mod.retryWithNextAddress(state, PROFILE, 'No vehicles found');
  chromeMock.runtime.sendMessage = save;

  check('a failed ask falls back to an empty result', log.filter((l) => l.startsWith('empty:')), [
    'empty:No vehicle found on Amica'
  ]);
}

{
  // A page that never reached the address step still has a usable list: the primary address is the
  // one Amica used, so it is the first marked as tried.
  log = [];
  nextAddressReply = { ok: true };
  mod.retryWithNextAddress({ stopped: false }, PROFILE, 'No vehicles found');
  check('with no address step seen, the primary is the one tried', log.filter((l) => l.startsWith('next:')), [
    'next:0:3'
  ]);
}

console.log(`\n=== TOTAL: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);

