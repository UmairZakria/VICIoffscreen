// Regression harness for per-record isolation of the DOB lookup.
// Run with:  node scratch/dob_record_isolation_test.js
//
// A DOB run belongs to the record card that started it (Record 1 - infolookup.site, Record 2 -
// infolookupp.com), and only one run exists at a time. Pressing DOB on Record 2 therefore replaces a
// run that Record 1 started - and everything Record 1's run still reports has to come back to
// Record 1's card. The record travels with the run: the widget sends it, the background keeps it
// on the session, the pages that drive the run stamp their own messages with it, and the widget
// routes each message to the card it names instead of to whichever card was pressed last.
//
// The routing helpers are sliced out of the shipped files and driven with hand written messages,
// so the real shipped code is what gets tested.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const widgetSrc = fs.readFileSync(path.join(root, 'widget.js'), 'utf8');
const bgSrc = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const unmaskSrc = fs.readFileSync(path.join(root, 'unmask_automation.js'), 'utf8');
const thatsthemSrc = fs.readFileSync(path.join(root, 'thatsthem_automation.js'), 'utf8');

function slice(src, start, end, label) {
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
function ok(label, condition) {
  check(label, !!condition, true);
}

const RECORD_1 = 'infolookup.site';
const RECORD_2 = 'infolookupp.com';

// ---- background.js: stamping every DOB message with its run's record --------
const stampSrc = slice(bgSrc, 'function withDobRecord(msg) {', 'function broadcastDobMessage(msg) {', 'withDobRecord');
const makeStamp = new Function('activeDobLookup', `${stampSrc}\nreturn withDobRecord;`);

console.log('\n== every DOB message names its record ==\n');

{
  const stamp = makeStamp({ session: { record: RECORD_2 } });
  check(
    'an untagged progress line is stamped with the run in flight',
    stamp({ action: 'DOB_LOOKUP_PROGRESS', step: 1, message: 'Searching...' }).record,
    RECORD_2
  );
  check(
    'the line itself is kept',
    stamp({ action: 'DOB_LOOKUP_PROGRESS', step: 1, message: 'Searching...' }).message,
    'Searching...'
  );
  check(
    'a page that names its own record keeps it - the run in flight cannot overwrite it',
    stamp({ action: 'DOB_LOOKUP_SUCCESS', dob: '03/04/1957', record: RECORD_1 }).record,
    RECORD_1
  );
  check('an empty report is stamped too', stamp({ action: 'DOB_LOOKUP_EMPTY', message: 'No DOB found' }).record, RECORD_2);
  check('an error is stamped too', stamp({ action: 'DOB_LOOKUP_ERROR', error: 'boom' }).record, RECORD_2);
}

{
  const stamp = makeStamp(null);
  check(
    'with no run in flight an untagged line is left alone',
    stamp({ action: 'DOB_LOOKUP_PROGRESS', step: 1 }).record,
    undefined
  );
  check(
    'a run without a record is left alone as well',
    makeStamp({ session: {} })({ action: 'DOB_LOOKUP_PROGRESS', step: 1 }).record,
    undefined
  );
}

{
  const stamp = makeStamp({ session: { record: RECORD_2 } });
  check(
    'a message that is not part of a DOB run is not stamped',
    stamp({ action: 'AUTH_QUOTA_UPDATED', lookupsRemaining: 4 }).record,
    undefined
  );
  check('a message without an action is returned untouched', stamp({ step: 1 }).step, 1);
  check('nothing at all stays nothing', stamp(null), null);
}

// ---- widget.js: which card a DOB message is drawn on ------------------------
const routeSrc = slice(widgetSrc, 'function dobMessageRecord(msg) {', 'function startDobAutomation(person, recordSource) {', 'dobMessageRecord');
const makeRoute = (inFlight) =>
  new Function('lookupRecord', `${routeSrc}\nreturn dobMessageRecord;`)((provider) => (provider === 'dob' ? inFlight : ''));

console.log('\n== which card a line is drawn on ==\n');

{
  const route = makeRoute(RECORD_2);
  check(
    "a line from Record 1's run goes to Record 1 even after Record 2 was pressed",
    route({ action: 'DOB_LOOKUP_SUCCESS', record: RECORD_1 }),
    RECORD_1
  );
  check('a line of the run in flight goes to its own record', route({ action: 'DOB_LOOKUP_PROGRESS' }), RECORD_2);
  check('a line with no record at all falls back to the run in flight', route({ action: 'DOB_LOOKUP_EMPTY', record: '' }), RECORD_2);
  check('the record is read as a string', route({ record: 42 }), '42');
}

{
  const route = makeRoute('');
  check('with no run pressed there is no card to draw on', route({ action: 'DOB_LOOKUP_PROGRESS' }), '');
  check('a tagged line still finds its card', route({ action: 'DOB_LOOKUP_PROGRESS', record: RECORD_1 }), RECORD_1);
}

// ---- widget.js: the person a returned DOB is stored on ---------------------
const sessionSrc = slice(widgetSrc, 'function dobSessionFor(recordSource) {', 'function dobMessageRecord(msg) {', 'dobSessionFor');
const makeSession = (byRecord, latest) =>
  new Function('dobSessionsByRecord', 'activeDobSession', `${sessionSrc}\nreturn dobSessionFor;`)(byRecord, latest);

console.log('\n== the person a returned DOB is stored on ==\n');

{
  const runOfRecord1 = { person: { name: 'Record One' }, record: RECORD_1 };
  const runOfRecord2 = { person: { name: 'Record Two' }, record: RECORD_2 };
  const forRecord = makeSession({ [RECORD_1]: runOfRecord1, [RECORD_2]: runOfRecord2 }, runOfRecord2);

  check("Record 1's late answer is stored on Record 1's person", forRecord(RECORD_1).person.name, 'Record One');
  check("Record 2's own answer is stored on Record 2's person", forRecord(RECORD_2).person.name, 'Record Two');
  check('a record with no run of its own falls back to the latest run', forRecord('other.example').person.name, 'Record Two');
  check('an unknown record with no run at all has no person', makeSession({}, null)(''), null);
}

console.log('\n== wiring inside the shipped files ==\n');

{
  ok(
    'the widget tells the worker which record the run is for',
    /action: "START_DOB_LOOKUP",[\s\S]{0,80}phone,[\s\S]{0,20}record\b/.test(widgetSrc)
  );
  ok(
    'a session is kept per record, next to the latest one',
    /const dobSessionsByRecord = Object\.create\(null\);/.test(widgetSrc) &&
      /let activeDobSession = null;/.test(widgetSrc)
  );
  ok(
    'every DOB line is routed by the record in the message',
    /DOB_LOOKUP_PROGRESS"\)[\s\S]{0,140}showVehicleProgress\("DOB", pct, msg\.message, false, dobMessageRecord\(msg\)\)/.test(widgetSrc) &&
      /DOB_LOOKUP_SUCCESS"\)[\s\S]{0,80}const record = dobMessageRecord\(msg\);/.test(widgetSrc) &&
      /DOB_LOOKUP_EMPTY"\)[\s\S]{0,80}const record = dobMessageRecord\(msg\);/.test(widgetSrc) &&
      /DOB_LOOKUP_ERROR"\)[\s\S]{0,80}const record = dobMessageRecord\(msg\);/.test(widgetSrc)
  );
  ok(
    'the DOB is drawn on and stored for that record only',
    /renderDiscoveredDob\(record, \{/.test(widgetSrc) &&
      /const session = dobSessionFor\(record\);/.test(widgetSrc) &&
      /const person = session && session\.person \? session\.person : null;/.test(widgetSrc) &&
      /const merged = mergeDobLookupResult\(person, msg\);/.test(widgetSrc) &&
      /renderDiscoveredEmails\(record, person\.emails, person\)/.test(widgetSrc) &&
      !/activeDobSession\.person\.dob/.test(widgetSrc)
  );
  ok(
    'the progress box of that record is the one closed again',
    (widgetSrc.match(/hideVehicleProgress\("DOB", record\)/g) || []).length === 3
  );
  ok(
    'the progress painter takes the record of the run it draws',
    /function showVehicleProgress\(provider, pct, message, isWarning = false, record\) \{/.test(widgetSrc) &&
      /const owner = record === undefined \? lookupRecord\(provider\) : record;/.test(widgetSrc) &&
      /function hideVehicleProgress\(provider, record\) \{/.test(widgetSrc)
  );
  ok(
    'a run the other card replaced has its progress closed',
    /const supersededRecord = lookupRecord\("dob"\);[\s\S]{0,160}hideVehicleProgress\("DOB", supersededRecord\)/.test(widgetSrc)
  );
  ok('the cancel button closes its own card and the card of the run in flight', /cancelDobAutomation\(source\)/.test(widgetSrc));
}

{
  ok(
    'the run remembers the record it was started for',
    /async function startDobLookup\(person, phone, sendResponse, sender, record, sources\)/.test(bgSrc) &&
      /const recordSource = record \? String\(record\) : '';/.test(bgSrc) &&
      /record: recordSource,/.test(bgSrc)
  );
  ok(
    'the lines the background produces itself carry the record too',
    // The parallel ThatSthem runner, the Unmask session, its four initial search messages, and the
    // initial progress message when Unmask is switched off in Settings.
    (bgSrc.match(/record: recordSource/g) || []).length === 7 &&
      /error: err\.message,\s*\n\s*record: err\.record \|\| recordSource/.test(bgSrc)
  );
  ok(
    'every broadcast DOB message is stamped before it goes out',
    /function broadcastDobMessage\(msg\) \{\s*\n\s*const \w+ = withDobRecord\(msg\);/.test(bgSrc) &&
      // The outgoing value is derived from the stamped one (the runner note is appended to it), and
      // it is the stamped message that is sent - so nothing goes out unstamped.
      /withDobRecord\(msg\)[\s\S]{0,700}chrome\.tabs\.sendMessage\(t\.id, tagged\)/.test(bgSrc) &&
      /withDobRecord\(msg\)[\s\S]{0,700}chrome\.runtime\.sendMessage\(tagged\)/.test(bgSrc)
  );
  ok(
    'an answer from a replaced run is shown but does not drive the new run',
    /const reportedRecord = msg\.record \? String\(msg\.record\) : '';[\s\S]{0,240}reportedRecord !== session\.record[\s\S]{0,240}return;/.test(bgSrc)
  );
  ok(
    'a replaced run cannot end the run that is in flight',
    /const runRecord = activeDobLookup && activeDobLookup\.session \? activeDobLookup\.session\.record : '';[\s\S]{0,200}String\(request\.record\) === runRecord/.test(bgSrc)
  );
  ok(
    "a page of a replaced run cannot walk the new run's steps",
    /async function advanceDobNextAddress\(senderTabId, sendResponse, record, force\)/.test(bgSrc) &&
      /pageRecord && session\.record && pageRecord !== session\.record[\s\S]{0,140}stale: true/.test(bgSrc)
  );
  // The retry the page sends after being told "the page is still being replaced" has to reach the step
  // walker, or a page whose own "No Results Found" panel rendered inside that window never moves on.
  ok(
    'the forced retry reaches the step walker',
    /async function advanceThatsThemNext\(senderTabId, session, sendResponse, force\)/.test(bgSrc) &&
      /if \(!force && session\.themLastAdvanceAt/.test(bgSrc)
  );
  ok(
    'the next-address request is still accepted without a record (older pages)',
    /const pageRecord = record \? String\(record\) : '';/.test(bgSrc)
  );
}

{
  ok(
    'the Unmask page stamps its messages with the record it is running',
    /var currentSession = null;/.test(unmaskSrc) &&
      /return \(currentSession && currentSession\.record\) \|\| "";/.test(unmaskSrc) &&
      /action: "DOB_LOOKUP_PROGRESS",[\s\S]{0,140}record: sessionRecord\(\),/.test(unmaskSrc) &&
      /action: "DOB_LOOKUP_SUCCESS",[\s\S]{0,220}record: sessionRecord\(\),/.test(unmaskSrc) &&
      /action: "DOB_LOOKUP_EMPTY",[\s\S]{0,160}record: sessionRecord\(\),/.test(unmaskSrc)
  );
  ok(
    'the Unmask page remembers the session it was started with',
    /function runUnmaskAutomation\(session\) \{\s*\n\s*currentSession = session;/.test(unmaskSrc)
  );
  ok(
    "the Unmask page asks for its own run's next step",
    /action: "DOB_LOOKUP_NEXT_ADDRESS", record: sessionRecord\(\)/.test(unmaskSrc)
  );
  ok(
    'the ThatSthem page stamps its messages with the record it is running',
    /var currentSession = null;/.test(thatsthemSrc) &&
      /return \(currentSession && currentSession\.record\) \|\| "";/.test(thatsthemSrc) &&
      /action: "DOB_LOOKUP_PROGRESS",[\s\S]{0,140}record: sessionRecord\(\)/.test(thatsthemSrc) &&
      /action: "DOB_LOOKUP_SUCCESS",[\s\S]{0,240}record: sessionRecord\(\),/.test(thatsthemSrc)
  );
  ok(
    'the ThatSthem page remembers the session it was started with',
    /function runThatsThem\(session\) \{\s*\n\s*currentSession = session;/.test(thatsthemSrc)
  );
  ok(
    "the ThatSthem page asks for its own run's next step",
    /action: "DOB_LOOKUP_NEXT_ADDRESS", record: sessionRecord\(\)/.test(thatsthemSrc)
  );
}

console.log(`\n=== TOTAL: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
