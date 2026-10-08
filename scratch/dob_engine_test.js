// Standalone regression harness for the Unmask DOB engine inside unmask_automation.js.
// Run with:  node scratch/dob_engine_test.js
//
// It slices the DOB helper block out of the content script (the script itself is an
// IIFE tied to window/chrome, so it cannot be required directly) and exercises it
// with the real-world cases the extension has to get right.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'unmask_automation.js');
const src = fs.readFileSync(SRC, 'utf8');

const start = src.indexOf('var DOB_YEAR_TOLERANCE');
const end = src.indexOf('function isUnmaskAddressNotFound');
if (start === -1 || end === -1 || end <= start) {
  throw new Error('Could not locate the DOB engine block in unmask_automation.js');
}

const block = src.slice(start, end);
const nameHelpers = src.slice(
  src.indexOf('function normalizeName(str) {'),
  src.indexOf('function isElementVisible(el) {')
);
const identityEvidenceHelper = src.slice(
  src.indexOf('function hasStrongUnmaskIdentityEvidence('),
  src.indexOf('function canInspectNameSearchCandidate(')
);
const engine = new Function(
  nameHelpers + identityEvidenceHelper + block +
    '\nreturn { extractDobFromText, collectDobCandidates, pickBestDobCandidate, getExpectedBirthYear,' +
    ' getProfileDobYearTolerance, describeClosestRejectedDob, isProfileSummarySettled, cleanSummaryText,' +
    ' DOB_YEAR_TOLERANCE, PROFILE_NO_DOB_SETTLE_MS, CARDS_SETTLE_MS };'
)();

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
}

const NOW = new Date().getFullYear();
const AGE_72 = 72;               // record: "72 yrs (1954)"
const YEAR_1954 = NOW - AGE_72;  // 1954
const AGE_74_WITH_YEAR = '74 yrs (1952)';

console.log(`\n== DOB engine regression (current year ${NOW}, expected birth year ${YEAR_1954}) ==\n`);

// 1. Age string is parsed into the expected birth year, explicit year wins.
check('getExpectedBirthYear(72, null)', engine.getExpectedBirthYear(AGE_72, null), YEAR_1954);
check('getExpectedBirthYear(72, 1954)', engine.getExpectedBirthYear(AGE_72, 1954), YEAR_1954);
check('getExpectedBirthYear("72 yrs (1954)", null)', engine.getExpectedBirthYear('72 yrs (1954)', null), YEAR_1954);
check('getExpectedBirthYear(null, null)', engine.getExpectedBirthYear(null, null), null);

// 2. The plain profile sentence.
check(
  'born sentence',
  engine.extractDobFromText(
    'Benita Lopez Cantu is 72 years old and was born on August 15, 1954. She lives in Blossom, TX.',
    AGE_72,
    null
  ),
  'August 15, 1954'
);

// 3. "born in <Month> <Year>" wording.
check(
  'born in month year',
  engine.extractDobFromText('Benita Lopez Cantu was born in August 1954 in Texas.', AGE_72, null),
  'August 1954'
);

// 4. Numeric DOB.
check(
  'numeric DOB',
  engine.extractDobFromText('DOB: 08/15/1954 (age 72)', AGE_72, null),
  '08/15/1954'
);

// 5. THE reported bug: 1958 belongs to a relative and must never be returned.
check(
  'relative 1958 rejected, target 1954 returned',
  engine.extractDobFromText(
    'Benita Lopez Cantu, 72. Relatives: Maria Cantu, born on June 2, 1958; Manuel Cantu.',
    AGE_72,
    null
  ),
  null
);

// 6. Only out-of-range dates on the page -> report nothing instead of a wrong DOB.
check(
  'only 1958 on page -> null',
  engine.extractDobFromText('Maria Cantu was born on June 2, 1958.', AGE_72, null),
  null
);
check(
  'only 1959/1948 on page -> null',
  engine.extractDobFromText('Updated March 2019. Born March 3, 1959.', AGE_72, null),
  null
);

// 7. Closest year wins between two in-range dates.
check(
  'closest year wins (1954 over 1957)',
  engine.extractDobFromText(
    'Relative: Maria Cantu born August 15, 1957. Benita Lopez Cantu born August 15, 1954.',
    AGE_72,
    null
  ),
  'August 15, 1954'
);

// 8. Only a one-year difference is acceptable.
check('1953 accepted', engine.extractDobFromText('born on August 15, 1953', AGE_72, null), 'August 15, 1953');
check('1955 accepted', engine.extractDobFromText('born on August 15, 1955', AGE_72, null), 'August 15, 1955');
check('1956 rejected', engine.extractDobFromText('born on August 15, 1956', AGE_72, null), null);
check('1958 rejected', engine.extractDobFromText('born on August 15, 1958', AGE_72, null), null);

// 9. Explicit "born ..." wording beats an unrelated bare date that is closer.
check(
  'explicit wording beats bare closer date',
  engine.extractDobFromText(
    'Updated March 1954. Benita Lopez Cantu was born in August 1955.',
    AGE_72,
    null
  ),
  'August 1955'
);

check(
  'Regina: reject October 6, 1954 for 74 yrs (1952)',
  engine.extractDobFromText('Regina D Morris, 74 yrs (1952). Unmask October 6, 1954.', AGE_74_WITH_YEAR, null),
  null
);
check(
  'Regina: accept a one-year-neighbor DOB instead of the two-year mismatch',
  engine.extractDobFromText(
    'Regina D Morris, 74 yrs (1952). Unmask October 6, 1954. Born August 1951.',
    AGE_74_WITH_YEAR,
    null
  ),
  'August 1951'
);
check('DOB candidate tolerance is one year', engine.DOB_YEAR_TOLERANCE, 1);

// 10. Explict year from the record drives the window even without an age.
check(
  'explicit record year used',
  engine.extractDobFromText('Benita Cantu, born on April 4, 1954.', null, YEAR_1954),
  'April 4, 1954'
);
check(
  'explicit record year rejects 1958',
  engine.extractDobFromText('Benita Cantu, born on April 4, 1958.', null, YEAR_1954),
  null
);
check(
  'explicit record year rejects a one-year mismatch',
  engine.extractDobFromText(
    'Gerald Busch was born in January 15th, 1940 and is 86 years old. Gerald currently lives in Homosassa, FL.',
    85,
    1941
  ),
  null
);
check(
  'strongly corroborated exact-name profile allows a one-year DOB difference',
  engine.extractDobFromText(
    'Jerry Busch was born in July 31st, 1940 and is 86 years old.',
    85,
    1941,
    engine.getProfileDobYearTolerance(1941, 'Jerry Busch', 'Jerry Busch', { address: 0, phone: true })
  ),
  'July 31, 1940'
);
check(
  'exact-name profile without exact phone or address keeps strict year matching',
  engine.getProfileDobYearTolerance(1941, 'Jerry Busch', 'Jerry Busch', { address: 35, phone: false }, 85, 86),
  0
);
check(
  'exact first/last name, matching age, and ZIP/city/state allow a one-year DOB difference',
  engine.getProfileDobYearTolerance(
    1961,
    'Sharon M Ross',
    'Sharon Ross',
    { address: 35, phone: false },
    65,
    65
  ),
  1
);
check(
  'Sharon Ross December 31, 1960 is accepted for the corroborated 65-year-old profile',
  engine.extractDobFromText(
    'Sharon Ross was born in December 31st, 1960 and is 65 years old.',
    65,
    1961,
    engine.getProfileDobYearTolerance(
      1961,
      'Sharon M Ross',
      'Sharon Ross',
      { address: 35, phone: false },
      65,
      65
    )
  ),
  'December 31, 1960'
);
check(
  'exact target first/last name in a corroborating profile alias allows one-year tolerance',
  engine.getProfileDobYearTolerance(
    1967,
    'Carole Montemayor',
    'Carole Andrews',
    { address: 80, phone: false },
    59,
    59,
    ['Carole S Amontemayor', 'Carole A Montemayor']
  ),
  1
);
check(
  'Carole Andrews profile returns its alias-verified November 1966 DOB',
  engine.extractDobFromText(
    'Carole Andrews was born in November 7th, 1966 and is 59 years old.',
    59,
    1967,
    engine.getProfileDobYearTolerance(
      1967,
      'Carole Montemayor',
      'Carole Andrews',
      { address: 80, phone: false },
      59,
      59,
      ['Carole S Amontemayor', 'Carole A Montemayor']
    )
  ),
  'November 7, 1966'
);
check(
  'alias name without strong address or phone evidence keeps explicit year strict',
  engine.getProfileDobYearTolerance(
    1967,
    'Carole Montemayor',
    'Carole Andrews',
    { address: 0, phone: false },
    59,
    59,
    ['Carole A Montemayor']
  ),
  0
);
check(
  'exact first/last name and ZIP/city/state are not enough when age differs',
  engine.getProfileDobYearTolerance(
    1961,
    'Sharon M Ross',
    'Sharon Ross',
    { address: 35, phone: false },
    65,
    56
  ),
  0
);
check(
  'exact first/last name and matching age are not enough with city/state only',
  engine.getProfileDobYearTolerance(
    1961,
    'Sharon M Ross',
    'Sharon Ross',
    { address: 20, phone: false },
    65,
    65
  ),
  0
);
check(
  'alias-only profile keeps strict year matching',
  engine.getProfileDobYearTolerance(1941, 'Jerry Busch', 'Gerald Busch', { address: 80, phone: true }),
  0
);
check(
  'explicit record year accepts only its matching year',
  engine.extractDobFromText('Jerry Busch was born on January 15, 1941.', 85, 1941),
  'January 15, 1941'
);

// 11. No age on the record at all -> explicit phrase still works.
check(
  'no age on record falls back to explicit phrase',
  engine.extractDobFromText('This profile was born on April 4, 1954. Updated May 2024.', null, null),
  'April 4, 1954'
);

// 12. Non birth-date content yields nothing.
check(
  'no dates -> null',
  engine.extractDobFromText('Unmask LLC, Austin Texas. All rights reserved.', AGE_72, null),
  null
);
check(
  'empty text -> null',
  engine.extractDobFromText('', AGE_72, null),
  null
);

// 13. Candidate collection sanity: every date-ish item is captured with a priority,
//     years beyond the current year are dropped, duplicates from overlapping
//     patterns are harmless because the highest-priority one wins.
const cands = engine.collectDobCandidates('born on August 15, 1954. Also see June 1958, March 2019 and July 2099.');
check(
  'collect: year + priority of each candidate',
  cands.map((c) => c.year + ':' + c.priority).join(', '),
  '1954:4, 1954:1, 1958:0, 2019:0'
);
check(
  'collect: picks the explicit 1954 even with other years present',
  engine.pickBestDobCandidate(cands, AGE_72, null).text,
  'August 15, 1954'
);

// ---------------------------------------------------------------------------
// Part 1b: a matched profile with no DOB must be skipped straight away
// (text taken verbatim from the real "Cristian Telles" summary section)
// ---------------------------------------------------------------------------
console.log('== Matched profile without a DOB (real profile markup) ==\n');

const CRISTIAN_TEXT = 'Cristian currently lives in Houston, TX. View Full Background Report';
const CRISTIAN_SECTION =
  "Cristian Telles Houston, TX 3923 Dalmatian Drive, Houston, TX 77045 Cristian's Summary " +
  'Cristian currently lives in Houston, TX. View Full Background Report Unmask Report';

check('profile text has no DOB', engine.extractDobFromText(CRISTIAN_TEXT, 67, 1958), null);
check('whole summary section has no DOB', engine.extractDobFromText(CRISTIAN_SECTION, 67, 1958), null);
check('nothing to report as ignored', engine.describeClosestRejectedDob(CRISTIAN_SECTION, 67, 1958), null);

// the very same profile, but with the DOB sentence -> still extracted (regression)
check(
  'same page with a born sentence still yields the DOB',
  engine.extractDobFromText(
    CRISTIAN_SECTION.replace(
      'currently lives in',
      'is 67 years old and was born on October 4, 1958. He currently lives in'
    ),
    67,
    1958
  ),
  'October 4, 1958'
);

// the run loop only skips once the summary has stopped growing on a loaded page
const cristianSnapshot = engine.cleanSummaryText(CRISTIAN_TEXT) + '|' + 1200;
globalThis.document = { readyState: 'loading' };
check('page still loading -> wait', engine.isProfileSummarySettled(cristianSnapshot), false);
globalThis.document = { readyState: 'complete' };
check('loaded + rendered summary -> skippable', engine.isProfileSummarySettled(cristianSnapshot), true);
check('empty summary -> wait', engine.isProfileSummarySettled(''), false);
check('barely rendered summary -> wait', engine.isProfileSummarySettled('Loading|12'), false);
check(
  'a growing page resets the grace period',
  (engine.cleanSummaryText(CRISTIAN_TEXT) + '|' + 1200) !== (engine.cleanSummaryText(CRISTIAN_TEXT) + '|' + 1600),
  true
);
check('skip happens well before the 12s timeout', engine.PROFILE_NO_DOB_SETTLE_MS <= 2000, true);
check('missing-DOB profiles settle quickly', engine.PROFILE_NO_DOB_SETTLE_MS <= 500, true);
check('non-matching card lists settle quickly', engine.CARDS_SETTLE_MS <= 400, true);
check('summary text is whitespace collapsed', engine.cleanSummaryText('  Cristian   lives\n in Houston.  '), 'Cristian lives in Houston.');

// ---------------------------------------------------------------------------
// Part 2: search-result card scoring (the "which profile do we open" decision)
// Slices the pure name/age helpers out of the content script - no DOM needed.
// ---------------------------------------------------------------------------
const namesStart = src.indexOf('function normalizeName(str) {');
const namesEnd = src.indexOf('function isElementVisible(el) {');
const ageStart = src.indexOf('function matchAliasScore(target, aliasStr) {');
const ageEnd = src.indexOf('var DOB_YEAR_TOLERANCE');
if (namesStart === -1 || namesEnd === -1 || ageStart === -1 || ageEnd === -1) {
  throw new Error('Could not locate the name/age scoring helpers in unmask_automation.js');
}

const scoring = new Function(
  src.slice(namesStart, namesEnd) +
    '\n' +
    src.slice(ageStart, ageEnd) +
    '\nreturn { parseNameDetails, matchNameScore, matchAliasScore, evaluateAliasMatch, matchAgeScore, isAgeWithinTolerance };'
)();

const TARGET = scoring.parseNameDetails('Benita Lopez Cantu');
const TARGET_AGE = 72; // record: "72 yrs (1954)"
const ACCEPT_THRESHOLD = 80; // same threshold the card loop uses

// Score a direct card exactly like the card loop does, plus its age gate.
function evaluateDirectCard(cardName, cardAge) {
  const nameScore = scoring.matchNameScore(TARGET, scoring.parseNameDetails(cardName));
  const gated = nameScore > 0 && !scoring.isAgeWithinTolerance(TARGET_AGE, cardAge);
  const score = nameScore + 60 + scoring.matchAgeScore(TARGET_AGE, cardAge);
  return { nameScore, gated, score };
}

console.log('== Card age gate (record: 72 yrs -> 1954) ==\n');

check('age tolerance: 68 is out (1958)', scoring.isAgeWithinTolerance(72, 68), false);
check('age tolerance: 76 is out', scoring.isAgeWithinTolerance(72, 76), false);
check('age tolerance: 69 is in (1957)', scoring.isAgeWithinTolerance(72, 69), true);
check('age tolerance: 75 is in', scoring.isAgeWithinTolerance(72, 75), true);
check('age tolerance: unknown age is not blocked', scoring.isAgeWithinTolerance(72, null), true);
check('matchAgeScore gaps >3 is negative', scoring.matchAgeScore(72, 68), -50);

const card1954 = evaluateDirectCard('Benita Lopez Cantu', 72);
const card1957 = evaluateDirectCard('Benita Lopez Cantu', 69);
const card1958 = evaluateDirectCard('Benita Lopez Cantu', 68);

check('1954 card passes the gate', card1954.gated, false);
check('1957 card passes the gate', card1957.gated, false);
check('1958 card is gated out', card1958.gated, true);

// The gate is load bearing: without it the 1958 card still clears the 80 threshold.
check('1958 card raw score still clears threshold (why the gate exists)', card1958.score >= ACCEPT_THRESHOLD, true);
check('1954 card outranks 1957 card', card1954.score > card1957.score, true);

// The exact bug: perfect name + wrong age must never become the selected candidate.
const cards = [card1958, card1954, card1957].filter((c) => !c.gated && c.score >= ACCEPT_THRESHOLD);
check('selected candidate is the 1954 card', cards.sort((a, b) => b.score - a.score)[0] === card1954, true);

// Alias path: alias named like the target but a contradicting age is rejected.
check('alias "Benita Cantu" @68 rejected', scoring.evaluateAliasMatch(TARGET, 'Benita Cantu', 72, 68), 0);
check('alias "Benita Cantu" @72 accepted', scoring.evaluateAliasMatch(TARGET, 'Benita Cantu', 72, 72) >= ACCEPT_THRESHOLD, true);

console.log(`\n=== TOTAL: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
