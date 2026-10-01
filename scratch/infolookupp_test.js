// Regression harness for the second lookup source (infolookupp.com, formerly vibegenx.com).
// Run with:  node scratch/infolookupp_test.js
//
// The second source moved to a new domain with a slightly different results markup, so this
// harness pins down both halves of that:
//
//   1. the wiring - manifest host/matches, the DNR framing rule, the offscreen runner frame, the
//      background dispatch key, and the host -> source map in content.js. The map matters most:
//      `infolookupp.com` contains the string "infolookup", so the old
//      `host.includes('infolookup')` check sent the second source down the first source's flow.
//   2. the parsing - the shipped extractors are sliced out of content.js and driven with the
//      real markup, including the combined "STATE / ZIP" column (`.cx-addr-statezip`) and the
//      "—" placeholders that must not leak into an address.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const contentSrc = read('content.js');
const bgSrc = read('background.js');
const offscreenSrc = read('offscreen.js');
const offscreenHtml = read('offscreen.html');
const manifest = JSON.parse(read('manifest.json'));
const rules = JSON.parse(read('rules.json'));

const SOURCE = 'infolookupp.com';
const SITE_URL = 'https://infolookupp.com/';

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) passed++;
  else failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`
  );
}

function checkJson(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const good = a === e;
  if (good) passed++;
  else failed++;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${label}\n      expected: ${e}\n      actual:   ${a}`);
}

function ok(label, value) {
  check(label, !!value, true);
}

function slice(from, to) {
  const a = contentSrc.indexOf(from);
  const b = to ? contentSrc.indexOf(to) : contentSrc.length;
  if (a === -1 || b === -1 || b <= a) throw new Error(`Could not slice ${from} .. ${to}`);
  return contentSrc.slice(a, b);
}

// Comment lines are dropped before the "the old heuristic is gone" checks, so the prose that
// explains the old bug cannot be counted as the bug.
const contentCode = contentSrc
  .split('\n')
  .filter((line) => !/^\s*\/\//.test(line))
  .join('\n');

// ---------------------------------------------------------------------------
console.log('\n== 1. the new source is wired everywhere the old one was ==\n');
// ---------------------------------------------------------------------------

ok('the manifest asks for the new host', manifest.host_permissions.some((h) => h.includes(SOURCE)));
ok('the old host is gone from the manifest', !JSON.stringify(manifest).includes('vibegenx.com'));
ok(
  'the content script is injected on the new host',
  (manifest.content_scripts[0].matches || []).some((m) => m.includes(SOURCE))
);
ok('the lookup content script may run in the offscreen frame', !!manifest.content_scripts[0].all_frames);

const framingRule = rules.find((r) => ((r.condition && r.condition.urlFilter) || '').includes(SOURCE));
ok('rules.json strips the framing headers for the new host', !!framingRule);
if (framingRule) {
  const removed = (framingRule.action.responseHeaders || [])
    .filter((h) => h.operation === 'remove')
    .map((h) => h.header.toLowerCase());
  ok('the new host rule removes x-frame-options', removed.includes('x-frame-options'));
  ok('the new host rule removes content-security-policy', removed.includes('content-security-policy'));
  ok('the new host rule applies to sub_frame', (framingRule.condition.resourceTypes || []).includes('sub_frame'));
}
ok('no framing rule is left for the old host', !JSON.stringify(rules).includes('vibegenx.com'));

const runnersSrc = offscreenSrc.slice(offscreenSrc.indexOf('const RUNNERS = {'), offscreenSrc.indexOf('function getFrame('));
const RUNNERS = new Function(runnersSrc + '\nreturn RUNNERS;')();
checkJson(
  'the offscreen runner points at the new site',
  RUNNERS[SOURCE],
  { frameId: 'frame-infolookupp', url: SITE_URL }
);
ok('the runner frame exists in offscreen.html', offscreenHtml.includes('id="frame-infolookupp"'));
ok('the new frame loads the new site', /id="frame-infolookupp" src="https:\/\/infolookupp\.com\/"/.test(offscreenHtml));
ok('the old frame is gone', !offscreenHtml.includes('frame-vibegenx') && !offscreenHtml.includes('vibegenx.com'));

ok('the background knows the new worker port', /'infolookupp\.com': null/.test(bgSrc));
ok(
  'the background dispatches the search to the new source',
  // The record list is what the lookup walks, so the new source is named there, and the walk
  // dispatches whatever the Settings panel left switched on.
  /const RECORD_SOURCES = \['infolookup\.site', 'infolookupp\.com', 'uspeoplesearch\.net'\]/.test(bgSrc) &&
    /for \(const source of recordSources\) \{[\s\S]{0,120}dispatchToWorker\(source, phoneNumber, searchId\)/.test(bgSrc)
);
ok('the background no longer names the old source', !bgSrc.includes('vibegenx'));

// ---------------------------------------------------------------------------
console.log('\n== 2. the host decides the flow, and it is matched exactly ==\n');
// ---------------------------------------------------------------------------

ok('the host -> source map is spelled out', /const SOURCE_BY_HOST = \{/.test(contentSrc));
check(
  'the new host maps to its own source',
  /'infolookupp\.com':\s*'infolookupp\.com'/.test(contentSrc),
  true
);
check(
  'the www host maps to the same source',
  /'www\.infolookupp\.com':\s*'infolookupp\.com'/.test(contentSrc),
  true
);
check(
  'the first source still maps to itself',
  /'infolookup\.site':\s*'infolookup\.site'/.test(contentSrc),
  true
);
// THE BUG THIS PINS DOWN: "infolookupp.com" contains "infolookup", so a substring test
// classified the second source as infolookup.site and ran the wrong flow against it.
ok('the substring heuristic is gone', !/host\.includes\(['"]infolookup['"]\)/.test(contentCode));
ok('the source is read out of the map', /const sourceName = SOURCE_BY_HOST\[host\]/.test(contentCode));

const manifestHosts = manifest.host_permissions
  .map((h) => h.replace(/^https?:\/\//, '').replace(/\/\*$/, '').replace(/^\*\./, ''))
  .filter((h) => h.endsWith('infolookupp.com') || h.endsWith('infolookup.site'));
check('every lookup host in the manifest is covered by the map', manifestHosts.length, 2);
ok(
  'and each of them has an entry',
  manifestHosts.every((h) => new RegExp(`'${h.replace(/\./g, '\\.')}':`).test(contentSrc))
);

ok('the second flow is named after the site it scrapes', /async function executeInfolookuppSearch\(/.test(contentCode));
ok(
  'that flow is the one the port runs for the second source',
  /await executeInfolookuppSearch\(msg\.phone, msg\.searchId\)/.test(contentCode)
);
ok('the extractors are named after the site too', /function extractInfolookuppPersons\(/.test(contentCode));
const payloadSources = contentCode.match(/source: sourceName,/g) || [];
ok('every reported result is stamped with the source it came from (' + payloadSources.length + ')', payloadSources.length >= 5);
ok('no payload hard codes the old source', !contentCode.includes("source: 'vibegenx.com'"));
ok('the old source name is gone from the shipped code', !contentCode.includes("'vibegenx.com'"));

// ---------------------------------------------------------------------------
console.log('\n== 3. the search row of the new build is handled ==\n');
// ---------------------------------------------------------------------------

ok(
  'the search box is looked for inside .search-input-wrap first',
  /document\.querySelector\('\.search-input-wrap input\[type="tel"\]'\)/.test(contentCode)
);
ok('the plain input shapes are still accepted', /input\[inputmode="numeric"\]/.test(contentCode));
ok('the submit control is searched by id, type, class and label', /const findSearchButton = \(\) => \{/.test(contentCode));
ok('a submit button is accepted', /button\[type="submit"\], input\[type="submit"\]/.test(contentCode));
ok(
  'the "Paste" control can never be the submit',
  /classList\.contains\('paste-clear-btn'\)/.test(contentCode)
);
ok(
  'a build without a submit button is not an immediate failure',
  !/Search button was not found/.test(contentCode)
);
ok('Enter is still dispatched next to the click', /key: 'Enter', code: 'Enter'/.test(contentCode));
ok('the form is submitted when there is no button at all', /form\.requestSubmit\(\)/.test(contentCode));

// ---------------------------------------------------------------------------
console.log('\n== 4. the combined "STATE / ZIP" column is split, placeholders are not values ==\n');
// ---------------------------------------------------------------------------

const parseSrc =
  slice('function cleanAddressField(val) {', 'function extractInfolookupSitePersons() {') +
  slice('function extractInfolookuppPersons() {', 'function extractInfolookuppPerson() {') +
  (() => {
    const tail = slice('function extractInfolookuppCompliance() {');
    return tail.slice(0, tail.lastIndexOf('})();'));
  })();

const parse = new Function(
  parseSrc +
    '\nreturn { cleanAddressField, splitStateZip, extractInfolookuppPersons,' +
    ' extractInfolookuppCompliance, formatInfolookuppComplianceValue };'
)();

const SPLIT_CASES = [
  ['TX 77047', { state: 'TX', zip: '77047' }],
  ['TX, 77047', { state: 'TX', zip: '77047' }],
  ['TX-77047', { state: 'TX', zip: '77047' }],
  ['TX 77047-1234', { state: 'TX', zip: '77047' }],
  ['Texas 77047', { state: 'Texas', zip: '77047' }],
  ['77047', { state: '', zip: '77047' }],
  ['TX', { state: 'TX', zip: '' }],
  ['—', { state: '', zip: '' }],
  ['-', { state: '', zip: '' }],
  ['', { state: '', zip: '' }],
  ['N/A', { state: '', zip: '' }],
  [null, { state: '', zip: '' }]
];
for (const [input, expected] of SPLIT_CASES) {
  checkJson(`splitStateZip(${JSON.stringify(input)})`, parse.splitStateZip(input), expected);
}


// ---------------------------------------------------------------------------
console.log('\n== 5. owners are read out of the real markup ==\n');
// ---------------------------------------------------------------------------

// The fake DOM answers exactly the selectors the shipped extractor asks for - the same idea the
// other harnesses in scratch/ use, minus a real parser.
function textNode(text) {
  return { textContent: text };
}

function nameNode(name) {
  return {
    textContent: name,
    cloneNode: () => ({ textContent: name, querySelectorAll: () => [{ remove: () => {} }] })
  };
}

function addrRow(fields) {
  const values = {
    '.cx-addr-street': fields.street,
    '.cx-addr-city': fields.city,
    '.cx-addr-statezip': fields.statezip,
    '.cx-addr-state': fields.state,
    '.cx-addr-zip': fields.zip
  };
  return { querySelector: (sel) => (values[sel] ? textNode(values[sel]) : null) };
}

function ownerCard(owner) {
  const rows = (owner.rows || []).map(addrRow);
  return {
    querySelector: (sel) => {
      if (sel === '.cx-name .value') return owner.name === undefined ? null : nameNode(owner.name);
      if (sel === '.cx-avatar') return owner.avatar ? textNode(owner.avatar) : null;
      if (sel === '.cx-age-badge') return owner.age ? textNode(owner.age) : null;
      return null;
    },
    querySelectorAll: (sel) => (sel.indexOf('.cx-addr-row') !== -1 ? rows : [])
  };
}

function domWithOwners(owners, bodyText) {
  globalThis.document = {
    querySelectorAll: (sel) => (sel.indexOf('.cx-card') !== -1 ? owners.map(ownerCard) : []),
    getElementById: () => null,
    body: { innerText: bodyText || '' }
  };
}

// Lifted from the live page: three "Potential Owners", the first two rows street-only with the
// "—" placeholder in both the CITY and the STATE / ZIP column.
const REAL_OWNERS = [
  {
    name: 'Roxane Lemme',
    avatar: 'RL',
    age: '65 age (1961)',
    rows: [{ street: '8301 Tumbleweed Trl, Apt 3601', city: '—', statezip: '—' }]
  },
  {
    name: 'William John Lemme',
    avatar: 'WL',
    age: '92 age (1934)',
    rows: [{ street: 'PO Box 782', city: '—', statezip: '—' }]
  },
  {
    name: 'Danny Sanchez',
    avatar: 'DS',
    age: '59 age (1967)',
    rows: [{ street: '501 S Walnut St, Apt 13', city: '—', statezip: '—' }]
  }
];

domWithOwners(REAL_OWNERS);
const owners = parse.extractInfolookuppPersons();
check('all three owners are read', owners.length, 3);
check('the card takes its owner from .cx-name .value', owners[0].name, 'Roxane Lemme');
check('the copy button beside the name is not part of it', owners[0].name.toLowerCase().includes('copy'), false);
check('the avatar is used as rendered', owners[0].avatar, 'RL');
check('the age badge is kept whole', owners[0].age, '65 age (1961)');
check('the street survives as rendered', owners[0].address.street, '8301 Tumbleweed Trl, Apt 3601');
check('a dash placeholder is not a city', owners[0].address.city || '', '');
check('a dash placeholder is not a state', owners[0].address.state || '', '');
check('a dash placeholder is not a ZIP', owners[0].address.zip || '', '');
check(
  'a street-only address reads as just the street',
  owners[0].address.full,
  '8301 Tumbleweed Trl, Apt 3601'
);
check('the second owner is read as well', owners[1].name, 'William John Lemme');
check('and so is the third', owners[2].name, 'Danny Sanchez');
check('every owner keeps one address entry', owners.every((p) => p.allAddresses.length >= 1), true);

// The same card with the location filled in: the combined column has to split.
domWithOwners([
  {
    name: 'Danny Sanchez',
    avatar: 'DS',
    age: '59 age (1967)',
    rows: [{ street: '501 S Walnut St, Apt 13', city: 'Houston', statezip: 'TX 77047' }]
  }
]);
const located = parse.extractInfolookuppPersons()[0];
check('the combined column yields the state', located.address.state, 'TX');
check('the combined column yields the ZIP', located.address.zip, '77047');
check(
  'the full address reads the way the record card shows it',
  located.address.full,
  '501 S Walnut St, Apt 13, Houston, TX 77047'
);

// An older build put state and ZIP in columns of their own - that still has to work.
domWithOwners([
  { name: 'Roxane Lemme', rows: [{ street: '8301 Tumbleweed Trl', city: 'Blossom', state: 'TX', zip: '75416' }] }
]);
const legacy = parse.extractInfolookuppPersons()[0];
check('the separate state column still works', legacy.address.state, 'TX');
check('the separate ZIP column still works', legacy.address.zip, '75416');
check('and the legacy address is whole', legacy.address.full, '8301 Tumbleweed Trl, Blossom, TX 75416');


// ---------------------------------------------------------------------------
console.log('\n== 6. the compliance pills are read as the site writes them ==\n');
// ---------------------------------------------------------------------------

function complianceItem(label, value) {
  return { textContent: label, nextElementSibling: { textContent: value }, parentElement: null };
}

// The sampled page: DNC flagged ("State & Federal DNC" in a .status-pill.flag), the other two
// clean. The label and its pill are siblings inside .compliance-status-item.
globalThis.document = {
  querySelectorAll: () => [
    complianceItem('DNC status', 'State & Federal DNC'),
    complianceItem('Litigator', 'Clean'),
    complianceItem('Blacklist', 'Clean')
  ],
  getElementById: () => null,
  body: {
    innerText:
      'Owner & compliance\nPublic records lookup\nCompliance status (Internal compliance results)\n' +
      'State / Location\nTX Texas\nDNC status\nState & Federal DNC\nLitigator\nClean\nBlacklist\nClean\n'
  }
};

checkJson('the flagged DNC pill is read as written', parse.extractInfolookuppCompliance(), {
  dnc: 'State & Federal DNC',
  litigator: 'Clean',
  blacklist: 'Clean'
});
check('a clean pill stays clean', parse.formatInfolookuppComplianceValue('Clean'), 'Clean');
check(
  'the flagged pill keeps the site wording',
  parse.formatInfolookuppComplianceValue('State & Federal DNC'),
  'State & Federal DNC'
);
check('a federal-only listing reads as federal', parse.formatInfolookuppComplianceValue('Federal'), 'Federal DNC');
check('a state-only listing reads as state', parse.formatInfolookuppComplianceValue('State DNC'), 'State DNC');
check('a flagged listing reads as flagged', parse.formatInfolookuppComplianceValue('Flagged'), 'Flagged');
check('a placeholder dash is not a status', parse.formatInfolookuppComplianceValue('—'), '—');

// ---------------------------------------------------------------------------
console.log(`\n=== TOTAL: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);

