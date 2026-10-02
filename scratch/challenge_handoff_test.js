// Regression harness for the security-check hand-off.
// Run with:  node scratch/challenge_handoff_test.js
//
// A security check (Cloudflare on Unmask, the browser check on ThatSthem) is the user's to
// solve. The extension must NOT click it in any form - not measured, not replayed from a
// recording, not pressed with Space. It brings the tab to the front exactly once, says so,
// and then only watches. When the run ends the tab is handed back to where the user started.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const bg = read('background.js');
const unmask = read('unmask_automation.js');
const thatsthem = read('thatsthem_automation.js');
const manifest = read('manifest.json');

let passed = 0;
const failures = [];
function ok(name, condition) {
  if (condition) passed++;
  else {
    failures.push(name);
    console.log('FAIL  ' + name);
  }
}

// The interval body is what actually runs on a challenge page, so assert on that, not on
// helpers that are no longer called from anywhere.
function branchBody(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  if (a === -1 || b === -1 || b <= a) throw new Error('Could not slice ' + startMarker);
  return src.slice(a, b);
}

const unmaskBranch = branchBody(
  unmask,
  '// SCENARIO 0: Cloudflare Turnstile Challenge Intercept',
  '// SCENARIO 1: On Profile Page'
);
const thatsthemBranch = branchBody(
  thatsthem,
  // The call site inside the interval, not the function definition further up the file.
  '      if (isBrowserCheckPage()) {',
  '// Check cleared (or was never shown)'
);

// ---------------------------------------------------------------------------
// 1. Nothing in the shipped code clicks a security check any more
// ---------------------------------------------------------------------------
const solverApi = [
  'REPLAY_MACRO_CLICK',
  'handleReplayMacroClick',
  'solveTurnstile',
  'dispatchTrustedClick',
  'replayRecordedApproach',
  'dispatchTrustedSpace',
  'warmUpPointer',
  'turnstileFrameCache',
  'ensureDebuggerAttached',
  'releaseDebugger',
  'chrome.debugger',
  'Input.dispatchMouseEvent',
  'TURNSTILE_PROBE_SOURCE',
  'approachFromRecording',
  'resolveTrustedClickPoint',
  'replayMacroEngine2',
  'turnstileTokenPresent',
  'clickBrowserCheckRetry',
  'isBrowserCheckFailed'
];

for (const token of solverApi) {
  ok('background.js has no ' + token, !bg.includes(token));
  ok('unmask_automation.js has no ' + token, !unmask.includes(token));
  ok('thatsthem_automation.js has no ' + token, !thatsthem.includes(token));
}

// The CDP input path is the thing Cloudflare can see, so the permission goes too.
ok('manifest no longer asks for the debugger permission', !/"debugger"/.test(manifest));
ok('manifest is still valid JSON', (() => { try { JSON.parse(manifest); return true; } catch (e) { return false; } })());

// No recorded macro is ever replayed for a check.
ok('unmask never reads a recorded click point', !/recorded_macro|recordedClick/.test(unmask));
ok('thatsthem never reads a recorded click point', !/recorded_macro|recordedClick/.test(thatsthem));

// ---------------------------------------------------------------------------
// 2. The branch hands the page to the user and then only watches
// ---------------------------------------------------------------------------
for (const pair of [['unmask', unmaskBranch], ['thatsthem', thatsthemBranch]]) {
  const label = pair[0], branch = pair[1];
  ok(label + ' branch brings the tab forward', /focusThisTab\(\)/.test(branch));
  ok(label + ' branch prompts only once', /challengePrompted/.test(branch));
  ok(label + ' branch waits for the user', /CHALLENGE_WAIT_MS/.test(branch));
  ok(label + ' branch does not click', !/\.click\(\)|dispatchEvent|simulateHumanClick/.test(branch));
  ok(label + ' branch does not reload', !/location\.reload|res\.nextUrl|chrome\.tabs\.reload/.test(branch));
  ok(label + ' branch just watches the page', /return; \/\/ watch the page/.test(branch));
}

// Both files must define the wait constant - a missing one is a ReferenceError on every tick.
for (const pair of [['unmask', unmask], ['thatsthem', thatsthem]]) {
  const label = pair[0], src = pair[1];
  const m = src.match(/var CHALLENGE_WAIT_MS = (\d+);/);
  ok(label + ' defines CHALLENGE_WAIT_MS', !!m);
  if (m) {
    const ms = Number(m[1]);
    ok(label + ' wait is 1-10 minutes (' + ms + 'ms)', ms >= 60000 && ms <= 600000);
  }
}

// The wait must be measured from when the check was first seen, and reset when it clears.
ok('unmask times the wait from detection', /state\.challengeDetectedAt = Date\.now\(\)/.test(unmask));
ok('unmask resets the wait when the check clears', /state\.challengeDetectedAt = 0/.test(unmask));
ok('unmask permits a later challenge hand-back', /state\.challengeClearedSent = false/.test(unmask));
ok('thatsthem times the wait from detection', /state\.checkedAt = Date\.now\(\)/.test(thatsthem));
ok('thatsthem resets the wait when the check clears', /state\.checkedAt = 0/.test(thatsthem));
ok('thatsthem permits a later challenge hand-back', /state\.challengeClearedSent = false/.test(thatsthem));

// ---------------------------------------------------------------------------
// 3. The Unmask "unlock results" click is not a security check
// ---------------------------------------------------------------------------
const unlockRaw = unmask.slice(unmask.indexOf('// Priority 3:'), unmask.indexOf('// Priority 4:'));
// The prose in this block explains that a human check is deliberately excluded, and the click
// helper is called simulateHumanClick - so the "cannot match a widget" claim is asserted on the
// selector lines alone, which is what actually decides what gets clicked.
const unlockCode = unlockRaw
  .split('\n')
  .filter((line) => !/^\s*\/\//.test(line))
  .join('\n');
const unlockSelectors = unlockCode
  .split('\n')
  .filter((line) => line.includes('querySelector'))
  .join('\n');

ok('unlock-results branch is found', /Priority 3/.test(unlockRaw));
ok('unlock-results has selectors to check', unlockSelectors.length > 0);
ok('unlock-results never matches a human check', !/human|verify/i.test(unlockSelectors));
ok('unlock-results still ticks the search toggle', /View Address Search/.test(unlockCode) && /simulateHumanClick/.test(unlockCode));

// ---------------------------------------------------------------------------
// 4. The user is taken back to the tab they started on
// ---------------------------------------------------------------------------
ok('FOCUS_LOOKUP_TAB activates the lookup tab', /FOCUS_LOOKUP_TAB[\s\S]{0,400}chrome\.tabs\.update\(tabId, \{ active: true \}\)/.test(bg));
ok('FOCUS_LOOKUP_TAB focuses the window too', /FOCUS_LOOKUP_TAB[\s\S]{0,600}chrome\.windows\.update/.test(bg));
ok('the run remembers where the user came from', /session\.callerTabId = await resolveCallerTabId/.test(bg));
ok('a finished run hands the tab back', /function finishDobLookup[\s\S]{0,300}endDobLookup/.test(bg));
ok('endDobLookup restores the caller tab', /async function endDobLookup[\s\S]{0,400}restoreCallerTab/.test(bg));
ok('the lookup tab is closed afterwards', /chrome\.tabs\.remove\(lookupTabId\)/.test(bg));
// The user's own choice wins: never steal a tab they have already moved off.
ok('a tab the user left alone is not stolen back', /if \(lookupTab && !lookupTab\.active\) return false;/.test(bg));

// ---------------------------------------------------------------------------
// 5. No stale references to the removed solver
// ---------------------------------------------------------------------------
for (const pair of [['background', bg], ['unmask', unmask], ['thatsthem', thatsthem]]) {
  const label = pair[0], src = pair[1];
  ok(
    label + ' has no stale challenge state',
    !/challengeClicks|challengeLastClickAt|challengeWaitUntil|challengeWidgetId|challengeHandedOver|challengeVerifiedAt|challengeReloadAt|challengeReloadedAt|focusSteps/.test(src)
  );
  ok(label + ' has no BROWSER_CHECK_MAX_MS', !/BROWSER_CHECK_MAX_MS/.test(src));
}

console.log('');
console.log(failures.length ? 'FAILED: ' + failures.length : 'All ' + passed + ' assertions passed.');
process.exit(failures.length ? 1 : 0);
