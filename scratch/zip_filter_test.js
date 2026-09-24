// Regression harness for the ZIP filter on the record cards.
// Run with:  node scratch/zip_filter_test.js
//
// Every record card (Record 1 - infolookup.site, Record 1 - vibegenx.com) carries a small 5 digit
// ZIP box on its navigation row, next to the record chevrons. Typing a ZIP shows only the people
// of those records whose addresses include it, and both cards filter together.

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
const ZIP_HEADER = '  // ---------------------------------------------------------------------------\n  // ZIP filter on the record cards';

const helpers =
  slice('function addressListForPerson(person) {', ZIP_HEADER, 'address helpers') +
  slice(ZIP_HEADER, '  // Render individual card block in order', 'zip filter helpers');

const mod = new Function(
  'escapeHtml',
  'shadow',
  helpers +
    '\nreturn { addressListForPerson, normalizeZipFilter, activeZipFilter, addressMatchesZip,' +
    ' personMatchesZipFilter, filterPersonsByZip, setZipFilter, recordNavRowHtml, syncZipFilterBox,' +
    ' zipFilterNoteHtml, zipFilterRepaints };'
)((value) => String(value == null ? '' : value), null);

console.log('\n== what the box accepts ==\n');

check('digits are kept', mod.normalizeZipFilter('78163'), '78163');
check('only five digits are kept', mod.normalizeZipFilter('781639999'), '78163');
check('a ZIP+4 is cut to the ZIP', mod.normalizeZipFilter('78163-4402'), '78163');
check('spaces are stripped', mod.normalizeZipFilter(' 78 163 '), '78163');
check('letters are dropped', mod.normalizeZipFilter('78a16b3'), '78163');
check('an empty box stays empty', mod.normalizeZipFilter(''), '');
check('nothing at all stays empty', mod.normalizeZipFilter(null), '');

check('a partial ZIP does not filter yet', mod.activeZipFilter('7816'), '');
check('an empty box does not filter', mod.activeZipFilter(''), '');
check('a full ZIP filters', mod.activeZipFilter('78163'), '78163');
check('a pasted ZIP+4 filters on its ZIP', mod.activeZipFilter('78163-4402'), '78163');

console.log('\n== matching addresses ==\n');

check('the ZIP field matches', mod.addressMatchesZip({ zip: '78163' }, '78163'), true);
check('another ZIP does not match', mod.addressMatchesZip({ zip: '78250' }, '78163'), false);
check('a ZIP+4 field matches its ZIP', mod.addressMatchesZip({ zip: '78163-4402' }, '78163'), true);
check(
  'a ZIP inside a one-line address matches',
  mod.addressMatchesZip({ street: '112 Comal Peak, Bulverde, TX 78163' }, '78163'),
  true
);
check('digits that are not there do not match', mod.addressMatchesZip({ zip: '78250' }, '99999'), false);
check('no filter matches nothing', mod.addressMatchesZip({ zip: '78163' }, ''), false);
check('no address matches nothing', mod.addressMatchesZip(null, '78163'), false);

const PERSON = {
  name: 'Jane Doe',
  address: { street: '112 Comal Peak', city: 'Bulverde', state: 'TX', zip: '78163' },
  allAddresses: [
    { street: '112 Comal Peak', city: 'Bulverde', state: 'TX', zip: '78163' },
    { street: '9800 Folcik St', city: 'San Antonio', state: 'TX', zip: '78250' }
  ]
};
const OTHER = {
  name: 'John Roe',
  address: { street: '5 Real Rd', city: 'Boerne', state: 'TX', zip: '78006' },
  allAddresses: [{ street: '5 Real Rd', city: 'Boerne', state: 'TX', zip: '78006' }]
};

check('a person matches on the primary address', mod.personMatchesZipFilter(PERSON, '78163'), true);
check('a person matches on a history address', mod.personMatchesZipFilter(PERSON, '78250'), true);
check('a person without that ZIP does not match', mod.personMatchesZipFilter(OTHER, '78163'), false);
check('without a filter everybody matches', mod.personMatchesZipFilter(OTHER, ''), true);

check(
  'only the matching people are kept',
  mod.filterPersonsByZip([PERSON, OTHER], '78163').map((p) => p.name),
  ['Jane Doe']
);
check('a ZIP nobody has filters everyone out', mod.filterPersonsByZip([PERSON, OTHER], '99999').length, 0);
check(
  'without a filter the list is handed back unchanged',
  mod.filterPersonsByZip([PERSON, OTHER], '').length,
  2
);
check('a missing list filters to nothing', mod.filterPersonsByZip(null, '78163').length, 0);
{
  const original = [PERSON, OTHER];
  const copy = mod.filterPersonsByZip(original, '');
  check('the unfiltered list is a copy, never the original', copy === original, false);
  check('but it holds the same people', copy.length, original.length);
}

console.log('\n== the shared filter repaints every card ==\n');

{
  const painted = [];
  const entry = (id, connected) => ({
    element: { isConnected: connected },
    repaint: () => painted.push(id)
  });
  mod.zipFilterRepaints.push(entry('first', true), entry('stale', false), entry('second', true));

  mod.setZipFilter('78163');
  check('both live cards are repainted', painted.slice().sort(), ['first', 'second']);
  check('a card that is gone is dropped', mod.zipFilterRepaints.length, 2);
  check('the filter value is normalised on the way in', mod.activeZipFilter(), '78163');

  painted.length = 0;
  mod.setZipFilter('');
  check('clearing repaints everything again', painted.slice().sort(), ['first', 'second']);
  check('and clears the filter', mod.activeZipFilter(), '');
  mod.zipFilterRepaints.length = 0;
}

console.log('\n== the navigation row ==\n');

{
  const row = mod.recordNavRowHtml(0, 3);
  check(
    'the record chevrons are on the left',
    [row.includes('prev-card-slide'), row.includes('next-card-slide')],
    [true, true]
  );
  check('the position is shown', row.includes('>1 / 3<'), true);
  check('the badge is visible with more than one person', row.includes('display:none'), false);
  check('the ZIP box is rendered', row.includes('class="zip-filter-input"'), true);
  check('the box asks for a ZIP', row.includes('placeholder="ZIP code"'), true);
  check('the box only takes five digits', row.includes('maxlength="5"'), true);
  check('the box is numeric on phones', row.includes('inputmode="numeric"'), true);
  check('the box has an accessible label', row.includes('aria-label="Filter this record by ZIP code"'), true);
  check('the clear button starts hidden', row.includes('zip-filter-clear hidden'), true);
  check(
    'the chevrons come before the ZIP box',
    row.indexOf('prev-card-slide') < row.indexOf('zip-filter-input'),
    true
  );

  const single = mod.recordNavRowHtml(0, 1);
  check('the chevrons are hidden for a single person', single.includes('display:none'), true);
  check('but the ZIP box stays', single.includes('zip-filter-input'), true);

  mod.setZipFilter('78163');
  const filtered = mod.recordNavRowHtml(0, 2);
  check('the typed ZIP is kept in the box', filtered.includes('value="78163"'), true);
  check('the clear button shows up', filtered.includes('zip-filter-clear"'), true);
  mod.setZipFilter('');
}

console.log('\n== the "nobody here" note ==\n');

{
  mod.setZipFilter('90210');
  const note = mod.zipFilterNoteHtml(2, 'vibegenx.com', 3);
  check('the record is named', note.includes('Record 2') && note.includes('vibegenx.com'), true);
  check('the ZIP box is still there to undo it', note.includes('zip-filter-input'), true);
  check('the ZIP is spelled out', note.includes('ZIP 90210'), true);
  check('the hidden people are counted', note.includes('3 people hidden'), true);

  const one = mod.zipFilterNoteHtml(1, 'infolookup.site', 1);
  check('a single hidden person reads right', one.includes('1 person hidden'), true);
  mod.setZipFilter('');
}

console.log('\n== wiring inside widget.js ==\n');

check(
  'the card filters its people through the shared ZIP',
  /let personsList = filterPersonsByZip\(allPersons, activeZipFilter\(\)\)/.test(src),
  true
);
check('the navigation row comes from the shared helper', /const slideNavHtml = recordNavRowHtml\(pIdx, personsList.length\)/.test(src), true);
check(
  'the box drives the filter',
  /input\.addEventListener\("input", \(e\) => \{[\s\S]{0,120}setZipFilter\(e\.target\.value\)/.test(src),
  true
);
check('the clear button empties it', /setZipFilter\(""\);\s*\n\s*focusZipInput\(\)/.test(src), true);
check(
  'typing in the box does not reach the card',
  /input\.addEventListener\("click", \(e\) => e\.stopPropagation\(\)\)/.test(src),
  true
);
check(
  'every card repaints when the filter changes',
  /zipFilterRepaints\.push\(\{[\s\S]{0,160}repaint: \(\) => \{/.test(src),
  true
);
check(
  'the card shows a note when the ZIP hid everybody',
  /zipFilterNoteHtml\(index, source, allPersons\.length\)/.test(src),
  true
);
check(
  'the caret stays in the box while the card is rebuilt',
  /function isZipInputFocused\(\)/.test(src) && /if \(wasTyping\) focusZipInput\(\);/.test(src),
  true
);
check(
  'the box is re-bound and re-synced on every render',
  /bindZipFilterBox\(\);\s*\n\s*syncZipFilterBox\(personCardContainer\);/.test(src),
  true
);
check(
  'a fresh search starts without a ZIP filter',
  /activeResults = \[\];\s*\n\s*recordsList\.innerHTML = "";\s*\n\s*\/\/[^\n]*\n\s*setZipFilter\(""\);/.test(src),
  true
);
check(
  'the ZIP controls are styled',
  ['.zip-filter-box {', '.zip-filter-input {', '.zip-filter-input:focus {', '.zip-filter-clear {', '.zip-filter-note {'].map(
    (rule) => src.includes(rule)
  ),
  [true, true, true, true, true]
);

console.log(`\n=== TOTAL: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
