// Regression harness for Record 3 (uspeoplesearch.net): the wiring, and the two extractors that read
// its answer - the TCPA table and the owner cards - driven with the markup the site really returns.
//
// Usage: node scratch/uspeoplesearch_test.js
//
// The extractors are sliced straight out of content.js, so what is tested is the shipping code. What
// the markup is made of matters here: the skeleton state (rows present, values unpopulated) has to read
// as "no answer yet", and the answer has to survive the labels that are split into a <sub>.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const contentSrc = read('content.js');
const bgSrc = read('background.js');
const widgetSrc = read('widget.js');
const popupSrc = read('popup.js');
const popupHtml = read('popup.html');
const offscreenHtml = read('offscreen.html');
const offscreenSrc = read('offscreen.js');
const manifest = JSON.parse(read('manifest.json'));
const rules = JSON.parse(read('rules.json'));

const SOURCE = 'uspeoplesearch.net';
const SITE_URL = 'https://www.uspeoplesearch.net/';

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
}
function checkJson(label, actual, expected) {
  check(label, JSON.stringify(actual), JSON.stringify(expected));
}
function ok(label, value) {
  check(label, !!value, true);
}

// --------------------------------------------------------------------------- the fake DOM
// Only what the extractors use: classes, ids, children, textContent, and the two selector shapes the
// code queries with ("a > b" and "a b", each part tag / .class / #id, compound allowed).
function element(tag, options) {
  const opts = options || {};
  const node = {
    tag: tag,
    id: opts.id || '',
    classes: String(opts.class || '').split(/\s+/).filter(Boolean),
    children: [],
    ownText: opts.text || '',
    querySelector: (selector) => queryAll(node, selector)[0] || null,
    querySelectorAll: (selector) => queryAll(node, selector),
    append(...children) {
      children.forEach((child) => {
        child.parent = node;
        node.children.push(child);
      });
      return node;
    },
    remove() {
      if (!node.parent) return;
      node.parent.children = node.parent.children.filter((c) => c !== node);
      node.parent = null;
    },
    cloneNode() {
      const copy = element(tag, { id: opts.id, class: opts.class, text: opts.text });
      node.children.forEach((child) => copy.append(child.cloneNode(true)));
      return copy;
    }
  };
  Object.defineProperty(node, 'textContent', {
    get: () => node.ownText + node.children.map((c) => c.textContent).join('')
  });
  node.classList = { contains: (name) => node.classes.indexOf(name) >= 0 };
  return node;
}

function simpleMatches(node, simple) {
  const m = /^([A-Za-z0-9]*)((?:[.#][\w-]+)*)$/.exec(simple || '');
  if (!m) return false;
  if (m[1] && node.tag.toLowerCase() !== m[1].toLowerCase()) return false;
  const tokens = m[2].match(/[.#][\w-]+/g) || [];
  return tokens.every((t) => (t[0] === '.' ? node.classes.indexOf(t.slice(1)) >= 0 : node.id === t.slice(1)));
}

function descendants(node, out) {
  const found = out || [];
  node.children.forEach((child) => {
    found.push(child);
    descendants(child, found);
  });
  return found;
}

function queryAll(root, selector) {
  const out = [];
  String(selector).split(',').forEach((clause) => {
    const childMode = clause.indexOf('>') >= 0;
    const parts = (childMode ? clause.split('>') : clause.trim().split(/\s+/))
      .map((p) => p.trim())
      .filter(Boolean);
    let pool = [root];
    parts.forEach((part) => {
      const next = [];
      pool.forEach((node) => {
        const candidates = childMode ? node.children : descendants(node);
        candidates.forEach((candidate) => {
          if (simpleMatches(candidate, part) && next.indexOf(candidate) < 0) next.push(candidate);
        });
      });
      pool = next;
    });
    pool.forEach((node) => {
      if (out.indexOf(node) < 0) out.push(node);
    });
  });
  return out;
}

// The document the sliced code sees: the page's tree, plus getElementById across every node.
function documentFor(...top) {
  const root = element('html', {});
  root.append(...top);
  const all = [root, ...descendants(root)];
  return {
    documentElement: root,
    body: { innerText: '' },
    getElementById: (id) => all.find((node) => node.id === id) || null,
    querySelector: (selector) => queryAll(root, selector)[0] || null,
    querySelectorAll: (selector) => queryAll(root, selector)
  };
}

// --------------------------------------------------------------------------- the shipped extractors
function slice(from, to) {
  const a = contentSrc.indexOf(from);
  const b = to ? contentSrc.indexOf(to, a) : contentSrc.length;
  if (a === -1 || b === -1 || b <= a) throw new Error(`Could not slice ${from} .. ${to}`);
  return contentSrc.slice(a, b);
}

const loadExtractors = new Function(
  'document',
  'port',
  'sourceName',
  'sleep',
  'activeSearchId',
  slice('function cleanAddressField(val) {', 'function splitStateZip(') +
    '\n' +
    slice('function cleanText(val) {', '\n})();') +
    '\nreturn { extractUsPeopleCompliance: extractUsPeopleCompliance, extractUsPeoplePersons: extractUsPeoplePersons,' +
    ' readUsPeopleDomState: readUsPeopleDomState };'
);

// The TCPA table as the site renders it: one row per check, its label (half of which can sit in a
// <sub>) and the value the scrub fills in, with the site's own verdict class beside it.
function tcpaTable(rows) {
  return element('div', { class: 'tcpa d-col', id: 'tcpa' }).append(
    ...rows.map((row) =>
      element('div', { class: 'd-row tcpa-row', id: row.id || 'state' }).append(
        element('div', { class: 'tcpa-label', text: row.label }).append(
          ...(row.sub ? [element('sub', { text: row.sub })] : [])
        ),
        element('div', { class: `tcpa-value ${row.classes || ''}`, text: row.value || '' })
      )
    )
  );
}

// One owner card: name, age, an address list ("LIVES AT" first, then the history) and the relatives.
function ownerCard(spec) {
  const card = element('div', { class: 'd-col cx-card enter' }).append(
    element('div', { class: 'd-row cx-basic' }).append(
      element('div', { class: 'd-col cx-name' }).append(
        element('h4', { class: 'label', text: 'PERSON NAME' }),
        element('h3', { class: 'value', text: spec.name || '' })
      ),
      element('div', { class: 'd-col cx-age' }).append(
        element('h4', { class: 'label', text: 'AGE' }),
        element('h3', { class: 'value', text: spec.age || '' })
      )
    )
  );

  const addresses = element('div', { class: 'd-col cx-addresses' });
  (spec.addresses || []).forEach((addr) => {
    addresses.append(
      element('div', { class: 'd-row cx-address' }).append(
        element('div', { class: 'd-col cx-address-col home' }).append(
          element('h5', { class: 'label', text: addr.label || 'LIVES AT' }),
          element('h4', { class: 'value', text: addr.street || '' })
        ),
        element('div', { class: 'd-col cx-address-col city' }).append(
          element('h5', { class: 'label', text: 'CITY' }),
          element('h4', { class: 'value', text: addr.city || '' })
        ),
        element('div', { class: 'd-col cx-address-col state' }).append(
          element('h5', { class: 'label', text: 'STATE' }),
          element('h4', { class: 'value', text: addr.state || '' })
        ),
        element('div', { class: 'd-col cx-address-col zip' }).append(
          element('h5', { class: 'label', text: 'ZIP' }),
          element('h4', { class: 'value', text: addr.zip || '' })
        )
      )
    );
  });
  card.append(addresses);

  const related = element('div', { class: 'd-row value-container relations' });
  (spec.related || []).forEach((name) => related.append(element('h3', { class: 'value relation', text: name })));

  card.append(
    element('div', { class: 'd-row cx-misc' }).append(
      element('div', { class: 'd-col cx-misc-col cx-related' }).append(
        element('h4', { class: 'label', text: 'RELATED' }),
        related
      ),
      element('div', { class: 'd-col cx-misc-col cx-dob' }).append(
        element('h4', { class: 'label', text: 'D.O.B' }),
        element('h3', { class: 'value', text: spec.dob || '' })
      )
    )
  );

  return card;
}

function pageWith(tcpaRows, cards, bodyText) {
  const doc = documentFor(
    tcpaTable(tcpaRows),
    element('div', { class: 'd-col cx-cards', id: 'cards-wrap' }).append(...cards)
  );
  doc.body.innerText = bodyText || '';
  return doc;
}

// The answer the site gives a phone registered on both lists, with the two other checks clear - the
// markup from the bug report.
const BOTH_REGISTERED = [
  { id: 'phone', label: 'Phone', value: '5138912438', classes: 'populated' },
  { id: 'state', label: 'State', value: 'OH', classes: 'populated' },
  { id: 'state', label: 'DNC', sub: 'National', value: 'Registered', classes: 'populated alert' },
  { id: 'state', label: 'DNC', sub: 'State', value: 'Registered', classes: 'populated alert' },
  { id: 'cases', label: 'Litigator', value: 'Clean', classes: 'populated safe' },
  { id: 'listed', label: 'Blacklist', value: 'Clean', classes: 'populated safe' },
  { id: 'owner-litigator', label: 'Litigator', sub: 'Owner', value: 'Clean', classes: 'populated safe' }
];

const MARY = {
  name: 'Mary F Ward',
  age: '84',
  dob: '1942',
  addresses: [
    { label: 'LIVES AT', street: '6613 Elwynne Dr', city: 'Cincinnati', state: 'Ohio', zip: '45236' },
    { label: 'LIVED AT', street: '3514 Ravenwood Ave', city: 'Cincinnati', state: 'Ohio', zip: '45213' },
    { label: 'LIVED AT', street: '3836 Congreve Ave', city: 'Cincinnati', state: 'Ohio', zip: '45213' }
  ],
  related: ['Ervin Doll Ward', 'Adam Wayne Ward', 'James E Ward']
};

const MARION = {
  name: 'Marion H Thompson',
  age: '95',
  dob: '1931',
  addresses: [{ label: 'LIVES AT', street: 'Po Box 42829', city: 'Cincinnati', state: 'Ohio', zip: '45242' }],
  related: ['Not Present']
};

// --------------------------------------------------------------------------- 1. the wiring
console.log('\n== 1. the third record is wired end to end ==\n');

ok('the manifest asks for the new host', manifest.host_permissions.some((h) => h.includes(SOURCE)));
ok(
  'the content script is injected on the new host',
  manifest.content_scripts.some(
    (entry) =>
      (entry.matches || []).some((m) => m.includes(SOURCE)) && (entry.js || []).indexOf('content.js') >= 0
  )
);
ok(
  'rules.json strips the framing headers for the new host',
  rules.some(
    (rule) =>
      ((rule.condition && rule.condition.urlFilter) || '').includes(SOURCE) &&
      (rule.condition.resourceTypes || []).indexOf('sub_frame') >= 0
  )
);

const runnersSrc = offscreenSrc.slice(offscreenSrc.indexOf('const RUNNERS = {'), offscreenSrc.indexOf('function getFrame('));
const RUNNERS = new Function(`${runnersSrc}\nreturn RUNNERS;`)();
checkJson('the offscreen runner points at the new site', RUNNERS[SOURCE], {
  frameId: 'frame-uspeoplesearch',
  url: SITE_URL
});
ok('offscreen.html carries the new frame', offscreenHtml.includes('id="frame-uspeoplesearch"'));

ok(
  'the background walks it with the other two',
  /const RECORD_SOURCES = \['infolookup\.site', 'infolookupp\.com', 'uspeoplesearch\.net'\]/.test(bgSrc)
);
ok('the third source has its own settings key', /'uspeoplesearch\.net': 'record3'/.test(bgSrc));
ok("it is labelled Record 3", /=== 'uspeoplesearch\.net'\) return 'Record 3'/.test(bgSrc));
ok(
  'a fresh install searches it too',
  /records: \{ record1: true, record2: true, record3: true \}/.test(bgSrc) &&
    /dnc: \{ record1: true, record2: true, record3: true \}/.test(bgSrc)
);
ok('there is a worker port for it', /'uspeoplesearch\.net': null/.test(bgSrc));
ok('all three site waits allow 45 seconds for data to load', (contentSrc.match(/const maxWaitResults = 45000/g) || []).length >= 3);
ok('the background waits up to 60 seconds before its lookup safety timeout', /}, 60000\);/.test(bgSrc));
ok('the widget waits longer than the source-result window', /65000\)/.test(widgetSrc));
ok('unknown compliance is not displayed as a flagged hit', /lower === "unknown"/.test(widgetSrc));
ok('a previous no-result prompt is not reused without a fresh result', /noRecordsBefore/.test(contentSrc) && /finalFreshAnswer/.test(contentSrc));

ok('the content script maps its host to the source', /'www\.uspeoplesearch\.net': 'uspeoplesearch\.net'/.test(contentSrc));
ok(
  'its own search flow is the one dispatched',
  /sourceName === 'uspeoplesearch\.net'[\s\S]{0,80}executeUsPeopleSearch/.test(contentSrc)
);

ok(
  'widget.js knows the third site',
  /"uspeoplesearch\.net": "Record 3"/.test(widgetSrc) && /"uspeoplesearch\.net": "record3"/.test(widgetSrc)
);
ok('widget.js offers its two switches', widgetSrc.includes('records.record3') && widgetSrc.includes('dnc.record3'));
['popup.js'].forEach((file) => {
  const src = popupSrc;
  ok(`${file} knows the third site`, /'uspeoplesearch\.net': 'Record 3'/.test(src) && /'uspeoplesearch\.net': 'record3'/.test(src));
  ok(`${file} defaults the third record on`, /record1: true, record2: true, record3: true/.test(src));
});
['popup.html'].forEach((file) => {
  const src = popupHtml;
  ok(`${file} offers its two switches`, src.includes('records.record3') && src.includes('dnc.record3'));
});

// --------------------------------------------------------------------------- 2. the TCPA table
console.log('\n== 2. the compliance table is read ==\n');

const answered = loadExtractors(pageWith(BOTH_REGISTERED, []));
checkJson('a phone registered on both lists is State & Federal DNC', answered.extractUsPeopleCompliance(), {
  dnc: 'State & Federal DNC',
  litigator: 'Clean',
  blacklist: 'Clean'
});
check('and the page is reported as answered', answered.readUsPeopleDomState().answered, true);
check('a loaded person may be read even if it has no address', loadExtractors(
  pageWith(BOTH_REGISTERED, [ownerCard({ name: 'Jamie Example' })])
).extractUsPeoplePersons().length, 1);

const notFoundPrompt = element('p', { id: 'cx-ie', class: 'd-row cx-prompt', text: 'Not Found' });
const notFoundPage = documentFor(
  tcpaTable([]),
  element('div', { class: 'd-col cx-cards', id: 'cards-wrap' }),
  notFoundPrompt
);
const notFound = loadExtractors(notFoundPage);
check('the #cx-ie Not Found prompt is recognized without compliance rows', notFound.readUsPeopleDomState().noRecords, true);

const complianceFor = (rows) => loadExtractors(pageWith(rows, [])).extractUsPeopleCompliance();
const withValue = (match, change) =>
  BOTH_REGISTERED.map((row) => (match(row) ? Object.assign({}, row, change) : row));

check(
  'national only reads as Federal DNC',
  complianceFor(withValue((r) => r.sub === 'State', { value: 'Not Registered', classes: 'populated safe' })).dnc,
  'Federal DNC'
);
check(
  'state only reads as State DNC',
  complianceFor(withValue((r) => r.sub === 'National', { value: 'Not Registered', classes: 'populated safe' })).dnc,
  'State DNC'
);
check(
  'neither register reads as Clean',
  complianceFor(withValue((r) => Boolean(r.sub), { value: 'Not Registered', classes: 'populated safe' })).dnc,
  'Clean'
);
check(
  'a litigator on the owner flags the card',
  complianceFor(withValue((r) => r.id === 'owner-litigator', { value: 'Listed', classes: 'populated alert' })).litigator,
  'Flagged'
);
check(
  'a blacklist hit flags the card',
  complianceFor(withValue((r) => r.id === 'listed', { value: 'Flagged', classes: 'populated alert' })).blacklist,
  'Flagged'
);

// The skeleton state: the rows and the cards are on screen, none of them carries a value yet. This is
// the state that must never be read as an answer.
const skeletonRows = BOTH_REGISTERED.map((row) => Object.assign({}, row, { value: '', classes: '' }));
const skeleton = loadExtractors(pageWith(skeletonRows, [ownerCard({ age: '84' })]));
checkJson('a skeleton table is not an answer', skeleton.extractUsPeopleCompliance(), null);
check('and the page is not reported as answered', skeleton.readUsPeopleDomState().answered, false);
check('no person is read from a skeleton card', skeleton.extractUsPeoplePersons().length, 0);

// --------------------------------------------------------------------------- 3. the owners
console.log('\n== 3. the owners are read ==\n');

const owners = loadExtractors(pageWith(BOTH_REGISTERED, [ownerCard(MARY), ownerCard(MARION)])).extractUsPeoplePersons();
check('both owners are read', owners.length, 2);
check('the name is read', owners[0].name, 'Mary F Ward');
check('the age carries the birth year, in the format the card shows', owners[0].age, '84 yrs (1942)');
check('the current address is the "LIVES AT" row', owners[0].address.street, '6613 Elwynne Dr');
check(
  'its city, state and ZIP come with it',
  `${owners[0].address.city}, ${owners[0].address.state} ${owners[0].address.zip}`,
  'Cincinnati, Ohio 45236'
);
check(
  'the address is formatted the way the card shows it',
  owners[0].address.full,
  '6613 Elwynne Dr, Cincinnati, Ohio 45236'
);
check('the history is kept beside it', owners[0].allAddresses.length, 3);
checkJson('the relatives are read', owners[0].related, ['Ervin Doll Ward', 'Adam Wayne Ward', 'James E Ward']);
checkJson('a "Not Present" relative reads as no relatives at all', owners[1].related, []);
check('the avatar is the initials of the name', owners[0].avatar, 'MA');

console.log(`\n=== TOTAL: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
