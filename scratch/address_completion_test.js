// Regression harness for the Nominatim address-completion block in background.js.
// Run with:  node scratch/address_completion_test.js
//
// background.js runs as a service worker, so the completion block is sliced out of
// it and executed here with a mocked chrome.storage.local + fetch.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'background.js');
const src = fs.readFileSync(SRC, 'utf8');

function slice(startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Could not slice ${startNeedle} .. ${endNeedle}`);
  }
  return src.slice(start, end);
}

const stateConst = slice('const STATE_NAME_TO_CODE = {', 'function titleCaseWord(word) {');
const block = slice('function isPoBox(addrStr) {', 'async function startVehicleLookup(');

// The real Nominatim response captured for the record that vibegenx.com returns as
// "3724 Kildare Dr" (infolookup.site shows the complete address).
const REAL_HIT = {
  display_name: '3724, Kildare Drive, Minnetex, Houston, Harris County, Texas, 77047, United States',
  address: {
    house_number: '3724',
    road: 'Kildare Drive',
    neighbourhood: 'Minnetex',
    city: 'Houston',
    county: 'Harris County',
    state: 'Texas',
    postcode: '77047',
    country: 'United States',
    country_code: 'us',
  },
};

// ---- mocks -----------------------------------------------------------------
let fetchCalls = [];
let fetchThrows = false;
let fetchResponse = null;

globalThis.fetch = async (url) => {
  fetchCalls.push(String(url));
  if (fetchThrows) throw new Error('network down');
  return fetchResponse;
};

const storage = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => (key in storage ? { [key]: storage[key] } : {}),
      set: async (obj) => Object.assign(storage, obj),
    },
  },
};

const mod = new Function(
  'let activeLookup = null;\n' +
    stateConst +
    '\n' +
    block +
    '\nreturn {' +
    ' completeAddress, completePersonAddresses, completeResultAddresses, needsAddressCompletion,' +
    ' streetCoreKey, buildNominatimQuery, stateToCode, normalizeZip, mergeCompletedAddress,' +
    ' isTrustworthyHit, findCrossSourceHints, collectAddressHints, houseNumber,' +
    ' geocodeAddressForQuote,' +
    ' resetCache: () => { addressCache = null; },' +
    ' setActiveLookup: (v) => { activeLookup = v; }' +
    ' };'
)();

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

async function runTests() {
  console.log('\n== Address completion (Nominatim) regression ==\n');

  // --- detection ------------------------------------------------------------
  check('street-only record needs completion', mod.needsAddressCompletion({ street: '3724 Kildare Dr' }), true);
  check('missing zip only', mod.needsAddressCompletion({ street: '3724 Kildare Dr', city: 'Houston', state: 'TX' }), true);
  check('full record is left alone', mod.needsAddressCompletion({ street: '3724 Kildare Dr', city: 'Houston', state: 'TX', zip: '77047' }), false);
  check('infolookup record with full string only', mod.needsAddressCompletion({ street: '3724 Kildare Dr', full: '3724 Kildare Dr', city: '', state: '', zip: '' }), true);
  check('PO box is never geocoded', mod.needsAddressCompletion({ street: 'PO Box 1234' }), false);
  check('empty address is ignored', mod.needsAddressCompletion(null), false);

  // --- street / state normalisation ----------------------------------------
  check('street key drops number and expands suffix', mod.streetCoreKey('3724 Kildare Dr'), 'kildare drive');
  check('street keys match across OSM spelling', mod.streetCoreKey('Kildare Drive'), 'kildare drive');
  check('street key with direction', mod.streetCoreKey('812 W Oak Ln'), 'w oak lane');
  check('house number', mod.houseNumber('3724 Kildare Dr'), '3724');
  check('no house number', mod.houseNumber('Kildare Dr'), '');
  check('state name -> code', mod.stateToCode('Texas'), 'TX');
  check('state code stays', mod.stateToCode('tx'), 'TX');
  check('zip cleanup', mod.normalizeZip('77047-1234'), '77047');

  // --- query building -------------------------------------------------------
  check('query = street only when nothing else is known', mod.buildNominatimQuery({ street: '3724 Kildare Dr' }, null), '3724 Kildare Dr');
  check('query uses state hint', mod.buildNominatimQuery({ street: '3724 Kildare Dr' }, { state: 'TX' }), '3724 Kildare Dr, TX');
  check(
    'query uses cross source hint',
    mod.buildNominatimQuery({ street: '3724 Kildare Dr' }, { city: 'Houston', state: 'TX', zip: '77047' }),
    '3724 Kildare Dr, Houston, TX, 77047'
  );

  // --- trust guardrails -----------------------------------------------------
  check('real hit is trusted', mod.isTrustworthyHit({ street: '3724 Kildare Dr' }, null, REAL_HIT).ok, true);
  check(
    'wrong road rejected',
    mod.isTrustworthyHit({ street: '3724 Kildare Dr' }, null, { address: { road: 'Oak Avenue', house_number: '3724', state: 'Texas' } }).ok,
    false
  );
  check(
    'wrong house number rejected',
    mod.isTrustworthyHit({ street: '3724 Kildare Dr' }, null, { address: { road: 'Kildare Drive', house_number: '9300', state: 'Texas' } }).ok,
    false
  );
  check(
    'state hint protects against another state',
    mod.isTrustworthyHit({ street: '3724 Kildare Dr' }, { state: 'TX' }, { address: { road: 'Kildare Drive', house_number: '3724', state: 'Ohio' } }).ok,
    false
  );
  check(
    'record state protects too',
    mod.isTrustworthyHit({ street: '3724 Kildare Dr', state: 'TX' }, null, { address: { road: 'Kildare Drive', house_number: '3724', state: 'Ohio' } }).ok,
    false
  );

  // --- end to end completion ------------------------------------------------
  reset();
  const completed = await mod.completeAddress({ street: '3724 Kildare Dr' }, null);
  check(
    'completed fields',
    completed && { street: completed.street, city: completed.city, state: completed.state, zip: completed.zip },
    { street: '3724 Kildare Drive', city: 'Houston', state: 'TX', zip: '77047' }
  );
  check(
    'request used the public API contract',
    fetchCalls[0],
    'https://nominatim.openstreetmap.org/search?q=3724+Kildare+Dr&format=jsonv2&addressdetails=1&limit=1&countrycodes=us'
  );

  const cachedCall = await mod.completeAddress({ street: '3724 Kildare Dr' }, null);
  check('second lookup served from cache (1 req/sec policy)', fetchCalls.length, 1);
  check('cache returns the same result', cachedCall.city, 'Houston');

  mod.resetCache();
  const fromStorage = await mod.completeAddress({ street: '3724 Kildare Dr' }, null);
  check('storage cache survives a service worker restart', [fromStorage.city, fetchCalls.length], ['Houston', 1]);

  // --- merge semantics ------------------------------------------------------
  const merged = mod.mergeCompletedAddress({ street: '3724 Kildare Dr', unit: 'Apt 3' }, completed);
  check('merge fills the blanks and keeps unit', { city: merged.city, state: merged.state, zip: merged.zip, unit: merged.unit }, {
    city: 'Houston',
    state: 'TX',
    zip: '77047',
    unit: 'Apt 3',
  });
  check('merge rebuilds the full address', merged.full, '3724 Kildare Dr, Houston, TX 77047');
  const kept = mod.mergeCompletedAddress(
    { street: '3724 Kildare Dr', city: 'Dallas', state: 'TX', zip: '77047', full: '3724 Kildare Dr, Dallas, TX 77047' },
    completed
  );
  check('merge never overwrites record data', kept.city, 'Dallas');

  // --- person level (what the widget receives) ------------------------------
  reset();
  const historyEntry = { street: '3724 Kildare Dr' };
  const person = { name: 'Benita Lopez Cantu', address: { street: '3724 Kildare Dr' }, allAddresses: [historyEntry] };
  await mod.completePersonAddresses(person);
  check('primary address completed', [person.address.city, person.address.state, person.address.zip], ['Houston', 'TX', '77047']);
  check('address history completed in place', [historyEntry.city, historyEntry.zip], ['Houston', '77047']);
  check('only one request for one unique street', fetchCalls.length, 1);

  // --- cross source hint (infolookup.site already had the full address) -----
  reset();
  mod.setActiveLookup({
    results: [
      {
        source: 'infolookup.site',
        data: {
          persons: [{ name: 'Benita Lopez Cantu', address: { street: '3724 Kildare Dr', city: 'Houston', state: 'TX', zip: '77047' } }],
        },
      },
    ],
  });
  const hints = mod.findCrossSourceHints({ street: '3724 Kildare Dr' });
  check('cross source hint found', hints, { city: 'Houston', state: 'TX', zip: '77047' });
  check('cross source hint not found for another street', mod.findCrossSourceHints({ street: '99 Elm St' }), null);
  const hinted = await mod.completeAddress({ street: '3724 Kildare Dr' }, hints);
  check('hinted query keeps street + city + state + zip', fetchCalls[0].includes('q=3724+Kildare+Dr%2C+Houston%2C+TX%2C+77047'), true);
  check('hinted completion works', [hinted.city, hinted.zip], ['Houston', '77047']);

  // --- failure paths keep the original record untouched ---------------------
  reset();
  fetchResponse = { ok: false, status: 403, json: async () => ({}) };
  check('HTTP error -> no completion', await mod.completeAddress({ street: '3724 Kildare Dr' }, null), null);

  reset();
  fetchThrows = true;
  check('network error -> no completion', await mod.completeAddress({ street: '3724 Kildare Dr' }, null), null);

  reset();
  fetchResponse = { ok: true, status: 200, json: async () => [] };
  check('no results -> no completion', await mod.completeAddress({ street: '3724 Kildare Dr' }, null), null);

  reset();
  fetchResponse = { ok: true, status: 200, json: async () => [{ address: { road: 'Somewhere Else Rd', state: 'Ohio' } }] };
  check('untrustworthy result -> no completion', await mod.completeAddress({ street: '3724 Kildare Dr' }, null), null);

  const untouched = { name: 'X', address: { street: '3724 Kildare Dr' }, allAddresses: [] };
  fetchThrows = true;
  await mod.completePersonAddresses(untouched);
  check('failed completion leaves the record exactly as it was', untouched.address, { street: '3724 Kildare Dr' });

  // ---- geocodeAddressForQuote (the Amica address validation request) --------
  console.log('\n== Amica address validation (geocodeAddressForQuote) ==\n');

  reset();
  fetchResponse = { ok: true, status: 200, json: async () => [REAL_HIT] };
  const validated = await mod.geocodeAddressForQuote({
    street: '3724 Kildare Dr',
    city: 'Houston',
    state: 'TX',
    zip: '77047',
  });
  check(
    'a good address comes back in canonical form',
    validated && [validated.street, validated.city, validated.state, validated.zip],
    ['3724 Kildare Drive', 'Houston', 'TX', '77047']
  );

  reset();
  fetchResponse = { ok: true, status: 200, json: async () => [REAL_HIT] };
  const corrected = await mod.geocodeAddressForQuote({
    street: '3724 Kiblr Rd', // misspelt street, right house number / zip / state
    city: 'Houston',
    state: 'TX',
    zip: '77047',
  });
  check('a misspelt street is corrected', corrected && corrected.street, '3724 Kildare Drive');

  reset();
  fetchResponse = {
    ok: true,
    status: 200,
    json: async () => [
      { address: { house_number: '3724', road: 'Kildare Drive', city: 'Dayton', state: 'Ohio', postcode: '45402' } },
    ],
  };
  check(
    'a hit in another zip is refused',
    await mod.geocodeAddressForQuote({ street: '3724 Kildare Dr', city: 'Houston', state: 'TX', zip: '77047' }),
    null
  );

  reset();
  fetchResponse = {
    ok: true,
    status: 200,
    json: async () => [
      { address: { house_number: '9999', road: 'Kildare Drive', city: 'Houston', state: 'Texas', postcode: '77047' } },
    ],
  };
  check(
    'a hit with another house number is refused',
    await mod.geocodeAddressForQuote({ street: '3724 Kildare Dr', city: 'Houston', state: 'TX', zip: '77047' }),
    null
  );

  reset();
  check(
    'a PO box is never geocoded',
    await mod.geocodeAddressForQuote({ street: 'PO Box 55', city: 'Akron', state: 'OH', zip: '44321' }),
    null
  );
  check('no request was made for the PO box', fetchCalls.length, 0);

  reset();
  fetchResponse = { ok: true, status: 200, json: async () => [REAL_HIT] };
  const historyEntry2 = { street: '3724 Kildare Dr' };
  const person2 = { address: { street: '3724 Kildare Dr' }, allAddresses: [historyEntry2] };
  await mod.completeResultAddresses({ persons: [person2] }, { maxAddresses: 1, budgetMs: 1200 });
  check('streamed record: primary address completed', person2.address.city, 'Houston');
  check('streamed record: history left for the automations', historyEntry2.city || '', '');
  check('streamed record: one request only', fetchCalls.length, 1);

  console.log(`\n=== TOTAL: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed === 0 ? 0 : 1);
}

function reset() {
  fetchCalls = [];
  fetchThrows = false;
  fetchResponse = { ok: true, status: 200, json: async () => [REAL_HIT] };
  mod.resetCache();
  Object.keys(storage).forEach((k) => delete storage[k]);
  mod.setActiveLookup(null);
}

runTests();
