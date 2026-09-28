// Regression harness for relative-card link safety in unmask_automation.js.
// Run with:  node scratch/unmask_relative_link_test.js
//
// A DOB run must never wander off to a social or external link. unmask.com's own chrome
// (header, footer, "share" rows, app banners) carries anchors to Facebook, X, Instagram, ...,
// and the relative scan used to match a bare `a[href]` sweep of the whole page. Every candidate
// is now resolved first, and only an internal person profile on the host the run is already on
// can be scrolled to or loaded - so the target profile's DOB read is never cut short by a link
// that leaves the site.
//
// The helpers are sliced out of the content script (which is an IIFE that touches the DOM on
// load) and driven with plain link stubs, like every other harness in scratch/.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'unmask_automation.js');
const src = fs.readFileSync(SRC, 'utf8');

function slice(start, end) {
  const a = src.indexOf(start);
  const b = src.indexOf(end);
  if (a === -1 || b === -1 || b <= a) throw new Error(`Could not slice ${start} .. ${end}`);
  return src.slice(a, b);
}

// name rules + age helpers + the whole link-safety block (hostOf .. pickRelativeProfileLink)
const block =
  slice('function normalizeName(str) {', 'function isElementVisible(el) {') +
  slice('function isAgeWithinTolerance(targetAge, cardAge) {', 'var DOB_YEAR_TOLERANCE');

const mod = new Function(
  block +
    '\nreturn { resolveInternalUrl, isInternalProfileUrl, isExternalAnchor, relativeLinkText,' +
    ' pickRelativeProfileLink, isNameMatch };'
)();

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

function ok(label, value) {
  check(label, !!value, true);
}

// pickRelativeProfileLink answers with an object, so compare it by value.
function checkJson(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const good = a === e;
  if (good) passed++;
  else failed++;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${label}\n      expected: ${e}\n      actual:   ${a}`);
}

// The page a run is on when it scans relatives: a person profile on unmask.com.
const UUID = '3f1a6d20-9c4b-4e77-8a15-2b7c9d0e4f61';
const BASE = `https://unmask.com/Benita-Lopez-Cantu/TX-Houston/${UUID}/`;
const TARGET = 'Benita Lopez Cantu';

// The content script runs in a page, so the resolver falls back to window.location when no
// base is passed in (the "see all" click guard does exactly that). Give it the page it sees.
globalThis.window = { location: { href: BASE, hostname: 'unmask.com' } };


console.log('\n== a link is followed only inside the site ==\n');

// 1. Internal person profiles - every shape the site serves - are followed.
check(
  'absolute profile link is followed',
  mod.isInternalProfileUrl(`https://unmask.com/Benita-Lopez-Cantu/TX-Houston/${UUID}/`, BASE),
  `https://unmask.com/Benita-Lopez-Cantu/TX-Houston/${UUID}/`
);
check(
  'relative profile link is resolved',
  mod.isInternalProfileUrl(`/Benita-Lopez-Cantu/TX-Houston/${UUID}/`, BASE),
  `https://unmask.com/Benita-Lopez-Cantu/TX-Houston/${UUID}/`
);
check(
  'protocol-relative profile link is resolved',
  mod.isInternalProfileUrl(`//unmask.com/Benita-Lopez-Cantu/TX-Houston/${UUID}/`, BASE),
  `https://unmask.com/Benita-Lopez-Cantu/TX-Houston/${UUID}/`
);
check(
  'the same site under www is still the same site',
  mod.isInternalProfileUrl(`https://www.unmask.com/Benita-Lopez-Cantu/TX-Houston/${UUID}/`, BASE),
  `https://www.unmask.com/Benita-Lopez-Cantu/TX-Houston/${UUID}/`
);
check(
  'short name slug profile is followed',
  mod.isInternalProfileUrl('/Benita-Lopez-Cantu/', BASE),
  'https://unmask.com/Benita-Lopez-Cantu/'
);
check(
  'name + state-city profile is followed',
  mod.isInternalProfileUrl('/Benita-Lopez-Cantu/TX-Houston/', BASE),
  'https://unmask.com/Benita-Lopez-Cantu/TX-Houston/'
);
check(
  'name + state profile is followed',
  mod.isInternalProfileUrl('/Benita-Lopez-Cantu/TX/', BASE),
  'https://unmask.com/Benita-Lopez-Cantu/TX/'
);
check(
  'profile id without dashes is followed',
  mod.isInternalProfileUrl('/Benita-Lopez-Cantu/TX-Houston/9f3c1a7b2d/', BASE),
  'https://unmask.com/Benita-Lopez-Cantu/TX-Houston/9f3c1a7b2d/'
);

// 2. Social networks are refused even when the link carries the target's slug and profile id.
const SOCIAL = [
  ['facebook share row', `https://www.facebook.com/Benita-Lopez-Cantu/TX-Houston/${UUID}/`],
  ['facebook sharer', `https://www.facebook.com/sharer/sharer.php?u=https://unmask.com/Benita-Lopez-Cantu/TX-Houston/${UUID}/`],
  ['x.com', `https://x.com/Benita-Lopez-Cantu/${UUID}`],
  ['twitter', `https://twitter.com/Benita-Lopez-Cantu/${UUID}`],
  ['instagram', `https://www.instagram.com/Benita-Lopez-Cantu/${UUID}/`],
  ['linkedin', `https://www.linkedin.com/in/Benita-Lopez-Cantu-${UUID}/`],
  ['youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ['tiktok', 'https://www.tiktok.com/@benita.cantu'],
  ['pinterest', 'https://pinterest.com/pin/1234567890/'],
  ['reddit', 'https://www.reddit.com/user/benita_cantu/'],
  ['a data broker', 'https://www.whitepages.com/name/Benita-Cantu/Blossom-TX'],
  ['a maps link', `https://maps.google.com/?q=Benita+Lopez+Cantu/${UUID}`]
];
for (const [label, href] of SOCIAL) {
  check(`${label} is never a destination`, mod.isInternalProfileUrl(href, BASE), null);
  check(`${label} is never a resolved destination`, mod.resolveInternalUrl(href, BASE), null);
}

// 3. Anything else off the site is refused too.
check('another site is refused', mod.isInternalProfileUrl(`https://evil.example.com/${UUID}`, BASE), null);
check(
  'a lookalike domain is refused',
  mod.isInternalProfileUrl(`https://unmask.com.evil.example.com/Benita-Lopez-Cantu/TX-Houston/${UUID}/`, BASE),
  null
);
check('a subdomain of another site is refused', mod.isInternalProfileUrl(`https://cdn.evil.example.com/${UUID}`, BASE), null);
check('a lookalike suffix is refused', mod.isInternalProfileUrl(`https://notunmask.com/Benita-Lopez-Cantu/${UUID}`, BASE), null);

check('mailto is refused', mod.resolveInternalUrl('mailto:help@unmask.com', BASE), null);
check('tel is refused', mod.resolveInternalUrl('tel:+15551234567', BASE), null);
check('javascript: is refused', mod.resolveInternalUrl('javascript:window.location="https://evil.example.com"', BASE), null);
check('data: is refused', mod.resolveInternalUrl('data:text/html,<h1>hi</h1>', BASE), null);
check('an in-page jump is refused', mod.resolveInternalUrl('#relatives', BASE), null);
check('an empty href is refused', mod.resolveInternalUrl('', BASE), null);

// 4. The site's own furniture and listings are never destinations either, even though they
//    are internal.
const FURNITURE = [
  '/login/',
  '/privacy',
  '/privacy-policy',
  '/terms',
  '/terms-of-service',
  '/do-not-sell',
  '/opt-out',
  '/about-us',
  '/blog/how-it-works',
  '/support/contact',
  '/search?q=benita',
  '/unlock-search-results',
  '/'
];
for (const href of FURNITURE) {
  check(`${href} is not a person profile`, mod.isInternalProfileUrl(href, BASE), null);
}
check(
  'an address listing is not a profile',
  mod.isInternalProfileUrl('/address/3724-Kildare-Dr-Houston-TX-77047/', BASE),
  null
);
check(
  'a phone listing is not a profile',
  mod.isInternalProfileUrl('/phone/713-252-6330/', BASE),
  null
);

// The "unlock search results" controls are in-page, so the resolver reports them, but they
// are not profiles: only isInternalProfileUrl decides where a run may go.
check(
  'an internal link that is no profile resolves but is not followed',
  mod.resolveInternalUrl('/privacy', BASE),
  'https://unmask.com/privacy'
);

console.log('\n== the "see all relatives" control is never an exit ==\n');

function anchor(href, tag) {
  return { tagName: tag || 'A', getAttribute: (n) => (n === 'href' ? href : null) };
}

check('a button is clickable', mod.isExternalAnchor({ tagName: 'BUTTON', getAttribute: () => null }), false);
check('an internal link is clickable', mod.isExternalAnchor(anchor('/Benita-Lopez-Cantu/')), false);
check('an in-page link is clickable', mod.isExternalAnchor(anchor('#relatives')), false);
check('a link without an href is clickable', mod.isExternalAnchor(anchor(null)), false);
check('a missing element is clickable', mod.isExternalAnchor(null), false);
check(
  'a facebook "see all" anchor is never clicked',
  mod.isExternalAnchor(anchor('https://www.facebook.com/Benita-Lopez-Cantu/')),
  true
);
check('an external anchor is never clicked', mod.isExternalAnchor(anchor(`https://evil.example.com/${UUID}`)), true);
check('a mailto anchor is never clicked', mod.isExternalAnchor(anchor('mailto:help@unmask.com')), true);

console.log('\n== which relative card is followed ==\n');

// A card is a link plus the text on it; the title element is what the site renders.
function linkNode(href, title, opts) {
  opts = opts || {};
  return {
    getAttribute: (n) => (n === 'href' ? href : null),
    textContent: opts.text || '',
    querySelector: (sel) => (sel === '.wl-card-item__title' && title ? { textContent: title } : null),
    cloneNode: () => ({
      textContent: opts.text || '',
      querySelectorAll: () => [{ remove: () => {} }],
      querySelector: () => ({ textContent: opts.head || opts.text || '' })
    })
  };
}

const socialCard = linkNode('https://www.facebook.com/Benita-Lopez-Cantu/', TARGET);
const externalCard = linkNode(`https://evil.example.com/Benita-Lopez-Cantu/TX-Houston/${UUID}/`, TARGET);
const relativeCard = linkNode(
  `/Trenton-Shupp/TX-Blossom/${UUID}/`,
  'Trenton Shupp',
  { text: 'Trenton Shupp Blossom, TX' }
);
const targetCard = linkNode(
  `/Benita-Lopez-Cantu/TX-Houston/${UUID}/`,
  'Benita Lopez Cantu',
  { text: 'Benita Lopez Cantu Blossom, TX' }
);

check('a social card is skipped even when it carries the name', mod.pickRelativeProfileLink([socialCard], TARGET, BASE), null);
check('an external card is skipped even when it carries name and id', mod.pickRelativeProfileLink([externalCard], TARGET, BASE), null);
check('a relative who is not our person is skipped', mod.pickRelativeProfileLink([relativeCard], TARGET, BASE), null);
checkJson(
  'the matching internal card is followed',
  mod.pickRelativeProfileLink([relativeCard, targetCard], TARGET, BASE),
  { url: `https://unmask.com/Benita-Lopez-Cantu/TX-Houston/${UUID}/`, name: 'Benita Lopez Cantu' }
);
checkJson(
  'social and external cards never win the scan',
  mod.pickRelativeProfileLink([socialCard, externalCard, relativeCard, targetCard], TARGET, BASE),
  { url: `https://unmask.com/Benita-Lopez-Cantu/TX-Houston/${UUID}/`, name: 'Benita Lopez Cantu' }
);
check('no links at all means nothing to follow', mod.pickRelativeProfileLink([], TARGET, BASE), null);
check('a missing list means nothing to follow', mod.pickRelativeProfileLink(null, TARGET, BASE), null);
checkJson(
  'a card matched by its url slug is followed',
  mod.pickRelativeProfileLink([linkNode(`/Benita-Lopez-Cantu/${UUID}/`, '')], TARGET, BASE),
  { url: `https://unmask.com/Benita-Lopez-Cantu/${UUID}/`, name: TARGET }
);
checkJson(
  'a card without a title element is read from its own text',
  mod.pickRelativeProfileLink(
    [linkNode(`/Benita-Lopez-Cantu/TX-Houston/${UUID}/`, '', { head: 'Benita Lopez Cantu' })],
    TARGET,
    BASE
  ),
  { url: `https://unmask.com/Benita-Lopez-Cantu/TX-Houston/${UUID}/`, name: 'Benita Lopez Cantu' }
);
check(
  'the visible name of a card is the title, not the location line',
  mod.relativeLinkText(targetCard),
  'Benita Lopez Cantu'
);
check(
  'a card without a title is read from its text',
  mod.relativeLinkText(linkNode('/x/', '', { head: 'Trenton Shupp', text: 'Trenton Shupp Blossom, TX' })),
  'Trenton Shupp'
);
check('a social link is still a link - the resolver, not the card, refuses it', mod.resolveInternalUrl('https://www.facebook.com/x', BASE), null);


console.log('\n== the shipped file wires it up ==\n');

ok(
  'the relative scan goes through the resolver',
  /pickRelativeProfileLink\(relativeLinks, targetName, currentUrl\)/.test(src)
);
ok('the scan cannot assign an anchor href straight to the page', !/window\.location\.href = (pLink|href|dest|cHref)\b/.test(src));
ok('the old raw relative destination is gone', !/var dest = pLink\.href/.test(src));
ok('the relative hop loads the resolved profile url', /window\.location\.href = relativeMatch\.url;/.test(src));
ok(
  'card links are resolved before they are remembered',
  /isInternalProfileUrl\(cLink\.getAttribute\("href"\), currentUrl\)/.test(src)
);
ok(
  'relative candidates are resolved before they are remembered',
  /isInternalProfileUrl\(relObj\.href, currentUrl\)/.test(src)
);
ok(
  'every candidate is gated on an internal profile before it can win',
  /candidates\[cf\]\.reportUrl = isInternalProfileUrl\(candidates\[cf\]\.reportUrl, currentUrl\)/.test(src)
);
ok('the candidate gate drops what it cannot resolve', /if \(candidates\[cf\]\.reportUrl\) followableCandidates\.push/.test(src));
ok('the see-all control is checked before it is clicked', /!isExternalAnchor\(seeAllBtn\)/.test(src));
ok('the old uuid sniffing is gone', !/hasProfileUuid/.test(src));
ok('the old hand written skip list is gone', !/href\.includes\("login"\)/.test(src));

// The target profile's own DOB is read first: the relative scan, and with it the only
// scrollIntoView of the relatives section, lives behind the "we are not on the target
// profile" guard.
const guardIndex = src.indexOf('if (!isTargetProfile) {');
ok('the relative scan only runs off the target profile', guardIndex !== -1);
const guardBlock = src.slice(guardIndex, src.indexOf('// Profile timeout after 12 seconds'));
ok('the relatives section is only scrolled inside that guard', guardBlock.includes('relativesSec.scrollIntoView'));
ok('the relative scan lives inside that guard', guardBlock.includes('pickRelativeProfileLink(relativeLinks'));
ok('exactly one place scrolls the relatives section', (src.match(/relativesSec\.scrollIntoView/g) || []).length === 1);
ok(
  'the DOB read is wired before that guard',
  src.indexOf('extractDobFromText(summaryText, targetAge, targetYear)') !== -1 &&
    src.indexOf('extractDobFromText(summaryText, targetAge, targetYear)') < guardIndex
);
ok(
  'a matched profile still waits for its DOB before giving up',
  /isProfileSummarySettled\(profileSnapshot\)/.test(src.slice(guardIndex - 2000, guardIndex))
);

console.log(`\n=== TOTAL: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);

check('a missing href is refused', mod.resolveInternalUrl(null, BASE), null);
