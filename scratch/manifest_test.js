// The manifest is the one file whose mistakes are not a bug in the code but a dead extension: Chrome
// refuses to load at all, or loads it with no background worker, which leaves the toolbar icon doing
// nothing at all. This checks the things that have actually bitten, and that every file it names is
// really there - a missing icon or rules file stops the load just as quietly.
//
// Usage: node scratch/manifest_test.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const manifestPath = path.join(ROOT, 'manifest.json');

let failures = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
  console.log(`FAIL  manifest.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

// 1. Manifest V3, and a background block Chrome will actually accept. `scripts` (and `page`, and
//    `persistent`) are Manifest V2 keys: beside `service_worker` they make Chrome refuse the whole
//    background block - the extension loads, and then does nothing when the icon is clicked.
check('manifest version 3', manifest.manifest_version, 3);
check('a service worker is declared', manifest.background && manifest.background.service_worker, 'background.js');
check('no Manifest V2 background keys', ['scripts', 'page', 'persistent'].filter((k) => k in (manifest.background || {})), []);
check(
  'no Manifest V2 toolbar keys',
  ['browser_action', 'page_action', 'applications', 'app'].filter((k) => k in manifest),
  []
);
check('the MV3 action is declared', Boolean(manifest.action), true);
check(
  'web_accessible_resources is the MV3 shape',
  Array.isArray(manifest.web_accessible_resources) &&
    manifest.web_accessible_resources.every((entry) => Array.isArray(entry.resources) && Array.isArray(entry.matches)),
  true
);

// 2. Every file the manifest names exists. A typo here is a refusal to load, with the reason buried in
//    chrome://extensions rather than in the page.
const named = [];
if (manifest.background && manifest.background.service_worker) named.push(manifest.background.service_worker);
(manifest.content_scripts || []).forEach((entry) => (entry.js || []).forEach((file) => named.push(file)));
Object.values((manifest.action && manifest.action.default_icon) || {}).forEach((file) => named.push(file));
Object.values(manifest.icons || {}).forEach((file) => named.push(file));
(((manifest.declarative_net_request || {}).rule_resources) || []).forEach((rule) => named.push(rule.path));
(manifest.web_accessible_resources || []).forEach((entry) => {
  (entry.resources || []).forEach((resource) => named.push(resource.replace(/\/\*$/, '')));
});

const missing = named.filter((file) => file && !fs.existsSync(path.join(ROOT, file)));
check('every file the manifest names exists', missing, []);

// 3. The Google AI Mode page is what the four automation scripts hang off, and each of them has to be
//    listed - a script left out of the manifest loads nowhere, and the card's button then does nothing.
const googleScript = (manifest.content_scripts || []).find((entry) => (entry.matches || []).includes('https://www.google.com/*'));
check(
  'all four Google scripts are content scripts',
  googleScript ? googleScript.js.slice().sort() : null,
  ['google_address_automation.js', 'google_automation.js', 'google_email_automation.js', 'google_gender_automation.js']
);

// 4. The version and the build the widget reports are the same number, which is what makes the Settings
//    drawer's "Build ..." line worth reading when a page is running an older copy of the file.
const widget = fs.readFileSync(path.join(ROOT, 'widget.js'), 'utf8');
const build = /WIDGET_BUILD = "([^"]+)"/.exec(widget);
check('the widget names this version', build ? build[1].indexOf(manifest.version) === 0 : false, true);

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
