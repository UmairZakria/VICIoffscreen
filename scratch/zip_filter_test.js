// Regression harness for the ZIP filter on the record cards.
// Run with:  node scratch/zip_filter_test.js
//
// Every record card (Record 1, Record 2) carries a small 5 digit ZIP box on its navigation row, next
// to the record chevrons. Typing a ZIP shows only the people of those records whose addresses include
// it, and both cards filter together.

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
// The note above each card names the record through the settings labels (Record 1 / Record 2), which
// live in the settings block at the end of the file. Only the label helpers are needed here.
const LABEL_HEADER = "  // The two sites are the user's Record 1 and Record 2; their names never reach the UI.";
const LABEL_END = '  // Every group and every switch is filled in from the defaults';

const helpers =
  slice('function addressListForPerson(person) {', ZIP_HEADER, 'address helpers') +
  slice(ZIP_HEADER, '  // ---------------------------------------------------------------------------\n  // Which record card owns a lookup', 'zip filter helpers') +
  slice(LABEL_HEADER, LABEL_END, 'record label helpers');

const mod = new Function(
  'escapeHtml',
  'shadow',
  helpers +
    '\nreturn { addressListForPerson, normalizeZipFilter, activeZipFilter, zipFilterFor, addressMatchesZip,' +
    ' personMatchesZipFilter, filterPersonsByZip, setZipFilter, recordNavRowHtml, syncZipFilterBox,' +
    ' zipFilterNoteHtml, zipFilterRepaints, zipFiltersByRecord };'
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

console.log('\n== per-record filter isolation ==\n');

{
  const painted = [];
  const entry = (source, id, connected) => ({
    source,
    element: { isConnected: connected },
    repaint: () => painted.push(id)
  });
  mod.zipFilterRepaints.push(
    entry('infolookup.site', 'first', true),
    entry('infolookup.site', 'stale', false),
    entry('infolookupp.com', 'second', true)
  );

  mod.setZipFilter('infolookup.site', '78163');
  check('only the targeted record card is repainted', painted.slice(), ['first']);
  check('a card that is gone is dropped', mod.zipFilterRepaints.length, 2);
  check('the filter value is stored per record', mod.zipFilterFor('infolookup.site'), '78163');
  check('the other record stays unfiltered', mod.zipFilterFor('infolookupp.com'), '');

  painted.length = 0;
  mod.setZipFilter('infolookupp.com', '90210');
  check('filtering the second record repaints only that card', painted.slice(), ['second']);
  check('both records hold their own independent ZIP', [
    mod.zipFilterFor('infolookup.site'),
    mod.zipFilterFor('infolookupp.com')
  ], ['78163', '90210']);

  painted.length = 0;
  mod.setZipFilter('infolookup.site', '');
  check('clearing one record only repaints that record', painted.slice(), ['first']);
  check('cleared record has no filter', mod.zipFilterFor('infolookup.site'), '');
  check('other record keeps its filter', mod.zipFilterFor('infolookupp.com'), '90210');

  mod.setZipFilter('infolookupp.com', '');
  mod.zipFilterRepaints.length = 0;
}

console.log('\n== the navigation row ==\n');

{
  const row = mod.recordNavRowHtml(0, 3, 'infolookup.site');
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

  const single = mod.recordNavRowHtml(0, 1, 'infolookup.site');
  check('the chevrons are hidden for a single person', single.includes('display:none'), true);
  check('but the ZIP box stays', single.includes('zip-filter-input'), true);

  mod.setZipFilter('infolookup.site', '78163');
  const filtered = mod.recordNavRowHtml(0, 2, 'infolookup.site');
  check('the typed ZIP is kept in the box', filtered.includes('value="78163"'), true);
  check('the clear button shows up', filtered.includes('zip-filter-clear"'), true);
  mod.setZipFilter('infolookup.site', '');
}

console.log('\n== the "nobody here" note ==\n');

{
  mod.setZipFilter('infolookupp.com', '90210');
  const note = mod.zipFilterNoteHtml(2, 'infolookupp.com', 3);
  check(
    'the record is named by its label, never by its domain',
    note.includes('Record 2') && !note.includes('infolookupp.com'),
    true
  );
  check('the ZIP box is still there to undo it', note.includes('zip-filter-input'), true);
  check('the ZIP is spelled out', note.includes('ZIP 90210'), true);
  check('the hidden people are counted', note.includes('3 people hidden'), true);

  mod.setZipFilter('infolookup.site', '10001');
  const one = mod.zipFilterNoteHtml(1, 'infolookup.site', 1);
  check('a single hidden person reads right', one.includes('1 person hidden'), true);
  mod.setZipFilter('infolookupp.com', '');
  mod.setZipFilter('infolookup.site', '');
}

console.log('\n== wiring inside widget.js ==\n');

check(
  'the card filters its people through the per-record ZIP',
  /let personsList = filterPersonsByZip\(allPersons, activeZipFilter\(zipFilterFor\(source\)\)\)/.test(src),
  true
);
check('the navigation row receives the record source', /const slideNavHtml = recordNavRowHtml\(pIdx, personsList.length, source\)/.test(src), true);
check(
  'the box drives the record-specific filter',
  /input\.addEventListener\("input", \(e\) => \{[\s\S]{0,120}setZipFilter\(source, e\.target\.value\)/.test(src),
  true
);
check('the clear button empties it', /setZipFilter\(source, ""\);\s*\n\s*focusZipInput\(\)/.test(src), true);
check(
  'typing in the box does not reach the card',
  /input\.addEventListener\("click", \(e\) => e\.stopPropagation\(\)\)/.test(src),
  true
);
check(
  'target card repaints when its filter changes',
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
  'the box is re-bound and re-synced on every render with source',
  /bindZipFilterBox\(\);\s*\n\s*syncZipFilterBox\(personCardContainer, source\);/.test(src),
  true
);
check(
  'a fresh search clears ZIP filters for all records',
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
