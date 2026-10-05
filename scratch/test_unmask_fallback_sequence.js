'use strict';

const assert = require('assert');
const fs = require('fs');

const bgSrc = fs.readFileSync('background.js', 'utf8');
const unmaskSrc = fs.readFileSync('unmask_automation.js', 'utf8');
const offscreenSrc = fs.readFileSync('offscreen.js', 'utf8');

console.log('== Unmask Fallback Sequence & Offscreen Tests ==');

// 1. Verify fallback sequence order in background.js advanceDobNextAddress
const advanceFnIdx = bgSrc.indexOf('async function advanceDobNextAddress');
assert.ok(advanceFnIdx !== -1, 'advanceDobNextAddress exists');
const advanceSlice = bgSrc.slice(advanceFnIdx, advanceFnIdx + 6000);

const addrIdx = advanceSlice.indexOf('// 1. Next Address');
const phoneIdx = advanceSlice.indexOf('// 2. Phone Fallback');
const nameCityIdx = advanceSlice.indexOf('// 3. Name + State + City Fallback');
const nameStateIdx = advanceSlice.indexOf('// 4. Name + State Fallback');
const thatsThemIdx = advanceSlice.indexOf('// 5. Unmask exhausted -> fall back to the ThatSthem.com search order');

assert.ok(addrIdx !== -1, 'Address step exists');
assert.ok(phoneIdx !== -1, 'Phone step exists');
assert.ok(nameCityIdx !== -1, 'Name+City step exists');
assert.ok(nameStateIdx !== -1, 'Name+State step exists');
assert.ok(thatsThemIdx !== -1, 'ThatSthem fallback step exists');

assert.ok(addrIdx < phoneIdx, 'Address step is before Phone step');
assert.ok(phoneIdx < nameCityIdx, 'Phone step is before Name+City step');
assert.ok(nameCityIdx < nameStateIdx, 'Name+City step is before Name+State step');
assert.ok(nameStateIdx < thatsThemIdx, 'Name+State step is before ThatSthem step');

console.log('PASS: Fallback order: all addresses -> phone -> name+city+state -> name+state -> ThatSthem');

// 2. Verify advanceToUrl uses prepareRunner for offscreen and does NOT call chrome.tabs.create
const advanceToUrlIdx = advanceSlice.indexOf('function advanceToUrl');
const advanceToUrlSlice = advanceSlice.slice(advanceToUrlIdx, advanceToUrlIdx + 1200);
assert.ok(!advanceToUrlSlice.includes('chrome.tabs.create'), 'advanceToUrl never calls chrome.tabs.create');
assert.ok(advanceToUrlSlice.includes('prepareRunner'), 'advanceToUrl calls prepareRunner');
console.log('PASS: advanceToUrl uses prepareRunner and never opens tabs');

// 3. Verify goToThatsThemStep uses prepareRunner for offscreen and does NOT call chrome.tabs.create
const goToThatsThemIdx = bgSrc.indexOf('async function goToThatsThemStep');
const goToThatsThemSlice = bgSrc.slice(goToThatsThemIdx, goToThatsThemIdx + 2500);
assert.ok(!goToThatsThemSlice.includes('chrome.tabs.create'), 'goToThatsThemStep never calls chrome.tabs.create');
assert.ok(goToThatsThemSlice.includes("prepareRunner('thatsthem.com'"), 'goToThatsThemStep calls prepareRunner for thatsthem.com');
console.log('PASS: goToThatsThemStep prepares thatsthem.com runner without opening tabs');

// 4. Verify unmask_automation.js has the site content veto in isCloudflareChallengePage
assert.ok(unmaskSrc.includes('div.clickable.person, div[itemtype*=\'Person\'].person, .person'), 'Site content check exists in isCloudflareChallengePage');
assert.ok(/input\[type='checkbox'\]\[aria-label\*='Search'\]/.test(unmaskSrc), 'Search checkboxes recognized as site content');
console.log('PASS: isCloudflareChallengePage vetoes challenges when Unmask site content is present');

// 5. Verify offscreen.js PREPARE_RUNNER uses clean target URL without _r parameter
assert.ok(offscreenSrc.includes('frame.src = target;'), 'PREPARE_RUNNER uses clean target URL');
assert.ok(!offscreenSrc.includes('frame.src = `${target}${target.includes(\'?\')'), 'No _r parameter added to target URLs');
console.log('PASS: offscreen.js preserves clean search URLs');

console.log('\nAll Fallback Sequence tests PASSED!');
