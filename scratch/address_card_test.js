// Regression harness for the address card's chevron navigation.
// Run with:  node scratch/address_card_test.js
//
// A record normally holds more than one address (the primary one plus the history the sources
// returned). The card shows one at a time and the chevrons next to the copy button step
// through the rest, so nothing from the record is hidden behind "Primary address".

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'widget.js');
const src = fs.readFileSync(SRC, 'utf8');

function slice(start, end, label) {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  if (a === -1 || b === -1 || b <= a) throw new Error(`Could not slice ${label}`);
  return src.slice(a, b);
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

// ---- the shipped helpers -----------------------------------------------------
const helpers = slice(
  'function addressListForPerson(person) {',
  '  // Render individual card block in order',
  'address helpers'
);

const mod = new Function(
  helpers +
    '\nreturn { addressListForPerson, clampAddressIndex, stepAddressIndex,' +
    ' addressLabelForIndex, addressLinesForOption, addressNavHtml };'
)();

console.log('\n== the addresses of a record ==\n');

const PERSON = {
  name: 'Jane Doe',
  address: { street: '112 Comal Peak', city: 'Bulverde', state: 'Texas', zip: '78163' },
  allAddresses: [
    { street: '112 Comal Peak', city: 'Bulverde', state: 'Texas', zip: '78163' },
    { street: '9800 Folcik St', city: 'San Antonio', state: 'Texas', zip: '78250' },
    { street: '21 Rainbow Dr', unit: 'Apt 4', city: 'Boerne', state: 'TX', zip: '78006' },
    { street: 'PO Box 44', city: 'Bulverde', state: 'TX', zip: '78163' }
  ]
};

const list = mod.addressListForPerson(PERSON);
check('the primary address comes first', list[0].street, '112 Comal Peak');
check('the duplicate of the primary address is dropped', list.length, 4);
check(
  'the history follows in order',
  list.map((a) => a.street),
  ['112 Comal Peak', '9800 Folcik St', '21 Rainbow Dr', 'PO Box 44']
);
check('a unit is kept for the street line', [list[2].street, list[2].unit], ['21 Rainbow Dr', 'Apt 4']);
check('PO boxes are still viewable', list[3].street, 'PO Box 44');

check('a record without a history has one address', mod.addressListForPerson({ address: { street: '9 Solo St' } }).length, 1);
check(
  'an address given as a single line is used',
  mod.addressListForPerson({ address: { full: '18 Wexford Dr, Akron, OH' } })[0].street,
  '18 Wexford Dr, Akron, OH'
);
check(
  'a city/zip-only address is still an entry',
  mod.addressListForPerson({ address: { city: 'Boerne', zip: '78006' } })[0].city,
  'Boerne'
);
check('an empty record has no addresses', mod.addressListForPerson({}).length, 0);
check('a missing person has no addresses', mod.addressListForPerson(null).length, 0);
check(
  'addresses with no content are skipped',
  mod.addressListForPerson({ allAddresses: [{ street: '   ' }, null, { street: '5 Real Rd' }] }).length,
  1
);
check(
  'the same street in different casing is one entry',
  mod.addressListForPerson({
    address: { street: '5 Real Rd', zip: '44321' },
    allAddresses: [{ street: '5 real rd', zip: '44321' }]
  }).length,
  1
);
check(
  'punctuation does not create a duplicate',
  mod.addressListForPerson({
    address: { street: '5 Real Rd', city: 'Akron' },
    allAddresses: [{ street: '5 Real RD.', city: 'Akron' }]
  }).length,
  1
);

console.log('\n== stepping through them ==\n');

check('the first address is the default', mod.clampAddressIndex(undefined, 4), 0);
check('a negative index is clamped', mod.clampAddressIndex(-3, 4), 0);
check('an index past the end is clamped', mod.clampAddressIndex(99, 4), 3);
check('a fractional index is floored', mod.clampAddressIndex(1.8, 4), 1);
check('an empty list stays at zero', mod.clampAddressIndex(2, 0), 0);

check('down moves forward', mod.stepAddressIndex(0, 4, 1), 1);
check('down keeps moving forward', mod.stepAddressIndex(1, 4, 1), 2);
check('the last one wraps to the first', mod.stepAddressIndex(3, 4, 1), 0);
check('up moves back', mod.stepAddressIndex(2, 4, -1), 1);
check('the first one wraps to the last', mod.stepAddressIndex(0, 4, -1), 3);
check('stepping an unset index lands on the second', mod.stepAddressIndex(undefined, 4, 1), 1);
check('stepping a single address list does nothing', mod.stepAddressIndex(0, 1, 1), 0);
check('stepping an empty list does nothing', mod.stepAddressIndex(0, 0, 1), 0);

console.log('\n== labels and lines ==\n');

check('the first address is the primary one', mod.addressLabelForIndex(0, 1), 'Primary address');
check('the second address is labelled', mod.addressLabelForIndex(1, 4), 'Address 2');
check('the third address is labelled', mod.addressLabelForIndex(2, 4), 'Address 3');
check('an unset index is the primary one', mod.addressLabelForIndex(undefined, 3), 'Primary address');

check(
  'street + city/state/zip',
  mod.addressLinesForOption({ street: '112 Comal Peak', city: 'Bulverde', state: 'Texas', zip: '78163' }),
  { street: '112 Comal Peak', city: 'Bulverde, Texas 78163' }
);
check(
  'a unit is appended to the street',
  mod.addressLinesForOption({ street: '21 Rainbow Dr', unit: 'Apt 4', city: 'Boerne', state: 'TX', zip: '78006' }),
  { street: '21 Rainbow Dr Apt 4', city: 'Boerne, TX 78006' }
);
check(
  'a city-only address fills the street line',
  mod.addressLinesForOption({ street: '', city: 'Boerne', state: 'TX', zip: '78006' }),
  { street: 'Boerne, TX 78006', city: 'ZIP 78006' }
);
check('no option -> nothing to show', mod.addressLinesForOption(null), null);

console.log('\n== the chevrons ==\n');

check('a single address has no chevrons', mod.addressNavHtml(0, 1), '');
check('no addresses have no chevrons', mod.addressNavHtml(0, 0), '');
const nav = mod.addressNavHtml(1, 3);
check(
  'both chevrons are rendered',
  [nav.includes('addr-prev-address'), nav.includes('addr-next-address')],
  [true, true]
);
check('the counter shows the position', nav.includes('>2/3<'), true);
check('the up chevron comes first', nav.indexOf('addr-prev-address') < nav.indexOf('addr-next-address'), true);
check(
  'the chevrons carry an accessible label',
  [nav.includes('aria-label="Previous address"'), nav.includes('aria-label="Next address"')],
  [true, true]
);
check('the group has an aria label', nav.includes('aria-label="Address 2 of 3"'), true);
check('up is the short chevron shape', nav.includes('points="18 15 12 9 6 15"'), true);
check('down is the short chevron shape', nav.includes('points="6 9 12 15 18 9"'), true);

console.log('\n== wiring inside widget.js ==\n');

check(
  'the card renders the chevron html',
  /<div class="address-title-actions">[\s\S]{0,200}addressNavHtml\(addrIdx, addrTotal\)/.test(src),
  true
);
check(
  'the label follows the selected address',
  /<span class="sub-label">\$\{escapeHtml\(addressLabelForIndex\(addrIdx, addrTotal\)\)\}<\/span>/.test(src),
  true
);
check(
  'copy copies the address on screen, not always the primary one',
  /data-copy="\$\{escapeHtml\(fullAddr\)\}"/.test(src) &&
    /const fullAddr =\s*\n\s*\[streetDisplay, cityDisplay\]\.filter\(Boolean\)\.join\(", "\) \|\|/.test(src),
  true
);
check('the chevrons step the index', /stepAddressIndex\(p\.addressIndex, total, delta\)/.test(src), true);
check('the card is re-rendered after a step', /updatePersonCardView\(pIdx\);\s*\n\s*\};/.test(src), true);
check(
  'both chevrons are bound',
  /prevAddrBtn\.addEventListener\("click"[\s\S]{0,120}stepAddress\(-1\)/.test(src) &&
    /nextAddrBtn\.addEventListener\("click"[\s\S]{0,120}stepAddress\(1\)/.test(src),
  true
);
check(
  'the chevron clicks do not reach the card',
  /prevAddrBtn\.addEventListener\("click", \(e\) => \{\s*\n\s*e\.stopPropagation\(\);/.test(src),
  true
);
check(
  'the navigator is styled like the record nav',
  ['.addr-nav {', '.addr-nav-btn {', '.addr-nav-btn:hover {', '.addr-nav-counter {', '.address-title-actions {'].map(
    (rule) => src.includes(rule)
  ),
  [true, true, true, true, true]
);
check('the chevrons use the widget font stack', /\.addr-nav-counter \{[\s\S]{0,220}font-size: 10px/.test(src), true);

console.log(`\n=== TOTAL: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
