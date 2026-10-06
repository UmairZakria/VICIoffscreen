// Regression harness for the Email button's question builder in background.js, and for the manual
// card's address parsing in widget.js - the pair that produced "This record has no address with a city
// and ZIP to ask Google about" on a card whose address was sitting right there on it.
//
// Usage: node scratch/google_email_queries_test.js
//
// background.js runs as a service worker and widget.js needs a DOM, so the functions under test are
// lifted out of the two files by name and run here on their own: what is tested is the shipping code,
// not a copy of it.

const fs = require('fs');
const path = require('path');

const bgSrc = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const widgetSrc = fs.readFileSync(path.join(__dirname, '..', 'widget.js'), 'utf8');

// A function, from its `function` line down to the brace that closes it.
function liftFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`could not find ${name} in the source`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

// A constant whose value is a braced object - the state-code table.
function liftBracedConstant(src, name) {
  const start = src.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error(`could not find const ${name} in the source`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1) + ';';
    }
  }
  throw new Error(`unbalanced braces in const ${name}`);
}

// A constant written on one line: the month names, the address cap.
function liftConstant(src, name) {
  const start = src.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`could not find const ${name} in the source`);
  const end = src.indexOf(';', start);
  if (end < 0) throw new Error(`could not find the end of const ${name}`);
  return src.slice(start, end + 1);
}

const background = new Function(
  [
    liftBracedConstant(bgSrc, 'STATE_NAME_TO_CODE'),
    liftConstant(bgSrc, 'GOOGLE_MAX_ADDRESSES'),
    liftConstant(bgSrc, 'MONTH_NAMES'),
    liftFunction(bgSrc, 'parseTargetAgeAndYear'),
    liftFunction(bgSrc, 'birthMonthName'),
    liftFunction(bgSrc, 'birthYearForQuery'),
    liftFunction(bgSrc, 'normalizeAddressList'),
    liftFunction(bgSrc, 'buildGoogleEmailQueries'),
    'return { buildGoogleEmailQueries: buildGoogleEmailQueries, birthYearForQuery: birthYearForQuery };'
  ].join('\n\n')
)();

const widget = new Function(
  [
    liftFunction(widgetSrc, 'manualPerson'),
    liftFunction(widgetSrc, 'applyManualAddressInput'),
    'return { manualPerson: manualPerson, applyManualAddressInput: applyManualAddressInput };'
  ].join('\n\n')
)();

let failures = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  console.log(`        got  ${JSON.stringify(got)}`);
  if (!ok) console.log(`        want ${JSON.stringify(want)}`);
}


// The running example is the record from the bug report: a manual card typed in by hand, on a record
// that names no age at all - which is exactly what a manual card is.
const ADDRESS_TEXT = '1215 W Pleasant Run Rd, # TX75, DeSoto, TX 75115';
const FOUND_PERSON = {
  name: 'Kevin Scott McQue',
  age: '71 yrs (1955)',
  address: { street: '1215 W Pleasant Run Rd', city: 'DeSoto', state: 'TX', zip: '75115', full: ADDRESS_TEXT },
  allAddresses: [{ street: '1215 W Pleasant Run Rd', city: 'DeSoto', state: 'TX', zip: '75115', full: ADDRESS_TEXT }]
};

// 1. A record the lookup answered for: the year is the record's own age.
const foundPlan = background.buildGoogleEmailQueries(FOUND_PERSON, '');
check('a found record gets three regular searches then AI Mode', foundPlan.map((q) => q.mode), [
  'web', 'web', 'web', 'ai'
]);
check('the first regular search anchors the exact name, street, and full place', foundPlan[0].query,
  '"Kevin Scott McQue" "1215 W Pleasant Run Rd" "DeSoto TX 75115" email');
check('the second regular search includes the record birth year', foundPlan[1].query,
  '"Kevin Scott McQue" "DeSoto TX 75115" "1955" email');
check('the AI fallback remains the final query for that address', foundPlan[3].query,
  'Kevin Scott McQue lives at 1215 W Pleasant Run Rd, DeSoto, TX 75115 born in 1955 any public available primary email . gmail hotmail yahoo icloud are prefered');
check('query evidence carries address and birth year', [foundPlan[0].street, foundPlan[0].zip, foundPlan[0].year],
  ['1215 W Pleasant Run Rd', '75115', '1955']);
const secondAddressPerson = {
  ...FOUND_PERSON,
  allAddresses: [
    FOUND_PERSON.address,
    { street: '4821 Maple Grove Ln', city: 'Canton', state: 'OH', zip: '44718' }
  ]
};
const twoAddressPlan = background.buildGoogleEmailQueries(secondAddressPerson, '');
check('each known address gets its own three-web-plus-AI sequence',
  twoAddressPlan.map((q) => q.mode),
  ['web', 'web', 'web', 'ai', 'web', 'web', 'web', 'ai']);
check('the next address starts with its exact street query', twoAddressPlan[4].query,
  '"Kevin Scott McQue" "4821 Maple Grove Ln" "Canton OH 44718" email');


// 2. The card from the bug report: typed in, no age on the record, and the DOB the DOB run has already
//    put on the card. The unit number between the street and the city must not cost the city.
const manual = widget.manualPerson();
widget.applyManualAddressInput(manual, ADDRESS_TEXT);
manual.name = 'Kevin Scott McQue';

check('the typed address keeps its city', manual.address, {
  street: '1215 W Pleasant Run Rd',
  city: 'DeSoto',
  state: 'TX',
  zip: '75115',
  full: ADDRESS_TEXT
});
check("...and is on the card's address list for the other runs", manual.allAddresses.length, 1);

const manualPlan = background.buildGoogleEmailQueries(manual, 'September 16, 1963');
check('a manual card with DOB gets all three query modes', manualPlan.map((q) => q.mode), ['web', 'web', 'web', 'ai']);
check('a manual card query uses its DOB month and year', manualPlan[1].query,
  '"Kevin Scott McQue" "DeSoto TX 75115" "September 1963" email');
check('manual card AI query uses its DOB month and year', manualPlan[3].query,
  'Kevin Scott McQue lives at 1215 W Pleasant Run Rd, DeSoto, TX 75115 born in September 1963 any public available primary email . gmail hotmail yahoo icloud are prefered');

// 3. The same card before any DOB run has answered: there is no year anywhere, and the question is
//    still asked. This is the case that reported "no address with a city and ZIP" about a card that had
//    one, and returned no query at all.
const noYearPlan = background.buildGoogleEmailQueries(manual, '');
check('no birth year still gets three regular queries and an AI query', noYearPlan.map((q) => q.mode), [
  'web', 'web', 'web', 'ai'
]);
check('a query without known DOB omits the birth-year constraint', noYearPlan[1].query,
  '"Kevin Scott McQue" "DeSoto TX 75115" email');
check('the AI query remains useful without a DOB', noYearPlan[3].query,
  'Kevin Scott McQue lives at 1215 W Pleasant Run Rd, DeSoto, TX 75115 any public available primary email . gmail hotmail yahoo icloud are prefered');

// 4. The year, and where it comes from: the record's own birth year first, then the card's DOB, then
//    nothing at all - which is a question without a year, not an error.
check("the record's own birth year wins", background.birthYearForQuery({ age: '71 yrs (1955)' }, 'September 16, 1963'), '1955');
check("an age with no year falls back to the card's DOB", background.birthYearForQuery({ age: '71 yrs' }, 'September 16, 1963'), '1963');
check('a bare DOB year is read', background.birthYearForQuery({ age: '' }, '02/14/1950'), '1950');
check('no year is an empty string, not a failure', background.birthYearForQuery({ age: '' }, ''), '');

// 5. The reasons a card really can have nothing to ask, which must still ask nothing: no usable
//    address, and no name at all.
check('a name with no address asks nothing', background.buildGoogleEmailQueries({ name: 'Kevin Scott McQue' }, ''), []);
const zipOnly = widget.manualPerson();
widget.applyManualAddressInput(zipOnly, '75115');
zipOnly.name = 'Kevin Scott McQue';
check('a ZIP on its own asks nothing (no street to place)', background.buildGoogleEmailQueries(zipOnly, ''), []);
check('a card with no name asks nothing', background.buildGoogleEmailQueries(Object.assign({}, manual, { name: '' }), 'September 16, 1963'), []);

// 6. The parse guard: a state written on its own in front of the ZIP is the state, never a city.
const stateFirst = widget.manualPerson();
widget.applyManualAddressInput(stateFirst, '1215 W Pleasant Run Rd, DeSoto, TX, 75115');
check('a state on its own is not read as the city', stateFirst.address.city, '');

const named = widget.manualPerson();
widget.applyManualAddressInput(named, '4821 Maple Grove Ln, Canton, OH 44718');
check('the city that is named is still read', named.address, {
  street: '4821 Maple Grove Ln',
  city: 'Canton',
  state: 'OH',
  zip: '44718',
  full: '4821 Maple Grove Ln, Canton, OH 44718'
});

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
