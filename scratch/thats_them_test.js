// Regression harness for the ThatSthem.com fallback.
// Run with:  node scratch/thats_them_test.js
//
// The parsers / matching rules are sliced out of thatsthem_automation.js and the
// URL builders out of background.js, then driven with the exact strings that the
// real thatsthem.com result cards contain.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..');
const themSrc = fs.readFileSync(path.join(DIR, 'thatsthem_automation.js'), 'utf8');
const bgSrc = fs.readFileSync(path.join(DIR, 'background.js'), 'utf8');

function slice(src, start, end) {
  const a = src.indexOf(start);
  const b = src.indexOf(end);
  if (a === -1 || b === -1 || b <= a) throw new Error(`Could not slice ${start} .. ${end}`);
  return src.slice(a, b);
}

// ---- content script: helpers + name/age rules + parsers + matching --------
const themBlock = slice(themSrc, '  // ---- same rules as unmask_automation.js', '  // ---- run loop');

const them = new Function(
  themBlock +
    '\nreturn { parseBornText, parseLivesIn, parseKnownAs, parseCityStateZip, parseAddressBlock,' +
    ' parseNameDetails, matchNameScore, evaluateAliasMatch, isAgeWithinTolerance, matchAgeScore,' +
    ' evaluateRecord, buildTarget, streetKey, normalizeZip, stateToCode, cleanText,' +
    ' readRecord, readRecords, readAddressList, isNoResultsPage,' +
    ' isBrowserCheckPage, CHALLENGE_WAIT_MS,' +
    ' CARDS_SETTLE_MS, PAGE_TIMEOUT_MS, recordsFingerprint };'
)();

// ---- background: url builders + plan -------------------------------------
const bgBlock =
  slice(bgSrc, 'const STATE_NAME_TO_CODE = {', 'function slugifyAddress') +
  slice(bgSrc, 'function parseFirstLastForUnmask', 'function buildUnmaskNameCityUrl') +
  slice(bgSrc, 'const THATSTHEM_STORAGE_KEY = ', 'function parseFirstLastForUnmask') +
  slice(bgSrc, 'function primaryZipForSession', 'async function startThatsThemPhase');

const bg = new Function(
  bgBlock +
    '\nreturn { buildThatsThemNameUrl, buildThatsThemAddressUrl, buildThatsThemPhoneUrl,' +
    ' splitStreetAndLocation, buildThatsThemPlan, primaryZipForSession };'
)();

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

console.log('\n== ThatSthem card parsing (strings taken from the real markup) ==\n');

// Verbatim strings from a live thatsthem.com result card
const CARD_BORN = 'Born October 1958 (67 years old)';
const CARD_LIVES = 'Lives in Houston, TX';
const CARD_KNOWN_AS =
  'Known as: Deborah D. Clifton • Deborah Doreen Williams • Deborah S. Williams • Deborah L. Williams • Deborah Diane Williams • Deborah Lynn Smith • Deborah A. Williams';
const CARD_CSZ = 'Houston, TX 77047';
const CARD_ADDR_BLOCK = 'Current Address: 3724 Kildare Dr Houston, TX 77047';

check('born line -> month + year + age', them.parseBornText(CARD_BORN), {
  label: 'October 1958',
  month: 'October',
  year: 1958,
  age: 67,
});
check('born line without a month', them.parseBornText('Born 1958 (67 years old)'), {
  label: '1958',
  month: '',
  year: 1958,
  age: 67,
});
check('age on its own', them.parseBornText('Age: 67 years old'), { label: '', month: '', year: null, age: 67 });
check('no birth information', them.parseBornText('Last updated 2 months ago.'), null);
check('impossible year rejected', them.parseBornText('Born May 2099 (1 years old)'), null);

check('lives in -> city/state', them.parseLivesIn(CARD_LIVES), { city: 'Houston', state: 'TX' });
check('lives in with full state name', them.parseLivesIn('Lives in Houston, Texas'), { city: 'Houston', state: 'TX' });
check('lives in with 2 word city', them.parseLivesIn('Lives in Coral Springs, FL'), { city: 'Coral Springs', state: 'FL' });
check('no lives-in line', them.parseLivesIn(CARD_BORN), null);

const aliases = them.parseKnownAs(CARD_KNOWN_AS);
check('known as -> all 7 aliases', aliases.length, 7);
check('known as first + last alias', [aliases[0], aliases[6]], ['Deborah D. Clifton', 'Deborah A. Williams']);
check('known as label stripped from aliases', aliases.some((a) => /known as/i.test(a)), false);
check('known as absent -> no aliases', them.parseKnownAs(CARD_LIVES), []);

check('city/state/zip line', them.parseCityStateZip(CARD_CSZ), { city: 'Houston', state: 'TX', zip: '77047' });
check('city/state/zip+4 line', them.parseCityStateZip('Houston, TX 77047-1234'), { city: 'Houston', state: 'TX', zip: '77047' });
check('city/state line', them.parseCityStateZip('Houston, TX'), { city: 'Houston', state: 'TX', zip: '' });

check('flattened address block (street div + city div joined)', them.parseAddressBlock(CARD_ADDR_BLOCK), {
  street: '3724 Kildare Dr',
  city: 'Houston',
  state: 'TX',
  zip: '77047',
});
check('address block with commas', them.parseAddressBlock('3724 Kildare Dr, Houston, TX 77047'), {
  street: '3724 Kildare Dr',
  city: 'Houston',
  state: 'TX',
  zip: '77047',
});

// ---- matching rules --------------------------------------------------------
function card(opts) {
  const addresses =
    opts.addresses ||
    (opts.zip || opts.city || opts.street
      ? [{ street: opts.street || '', city: opts.city || '', state: opts.state || '', zip: opts.zip || '' }]
      : []);

  const record = {
    name: opts.name,
    nameDetails: them.parseNameDetails(opts.name),
    aliases: opts.aliases || [],
    dob: null,
    year: null,
    age: null,
    city: opts.city || '',
    state: opts.state || '',
    zip: opts.zip || '',
    street: opts.street || '',
    addresses,
  };
  if (opts.born) {
    record.dob = them.parseBornText(opts.born);
    record.year = record.dob ? record.dob.year : null;
    record.age = record.dob ? record.dob.age : null;
  }
  return record;
}

console.log('\n== ThatSthem matching (name + DOB/age + zip) ==\n');

const target = them.buildTarget({
  targetName: 'Deborah Williams',
  targetAge: 67,
  targetYear: 1958,
  city: 'Houston',
  state: 'TX',
  addresses: [{ street: '3724 Kildare Dr', city: 'Houston', state: 'TX', zip: '77047' }],
});
check(
  'target built from the run session',
  [target.name, target.age, target.year, target.city, target.state, target.zip, target.street],
  ['Deborah Williams', 67, 1958, 'Houston', 'TX', '77047', '3724 Kildare Dr']
);

const goodCard = card({ name: 'Deborah Williams', born: CARD_BORN, city: 'Houston', state: 'TX', zip: '77047', street: '3724 Kildare Dr' });
const good = them.evaluateRecord(target, goodCard);
check('the real card matches', !!good, true);
check('reported DOB comes from the card', good && good.dob.label, 'October 1958');
check('score clears the accept threshold', good && good.score >= 80, true);

const aliasCard = card({
  name: 'Deborah Clifton',
  aliases: ['Deborah D. Clifton', 'Deborah S. Williams'],
  born: CARD_BORN,
  city: 'Houston',
  state: 'TX',
  zip: '77047',
});
const aliasMatch = them.evaluateRecord(target, aliasCard);
check('card matched through a "Known as" alias', !!aliasMatch, true);
check('the alias that matched is reported', aliasMatch && aliasMatch.matchedAs, 'Deborah S. Williams');
check('alias match is not a direct match', aliasMatch && aliasMatch.isDirect, false);

// DOB rules (same as Unmask)
check(
  '1954 card rejected for a 1958 record',
  them.evaluateRecord(target, card({ name: 'Deborah Williams', born: 'Born October 1954 (71 years old)', city: 'Houston', state: 'TX', zip: '77047' })),
  null
);
check(
  'age 5 years off rejected even with the right year',
  them.evaluateRecord(target, card({ name: 'Deborah Williams', born: 'Born October 1958 (72 years old)', city: 'Houston', state: 'TX', zip: '77047' })),
  null
);
check(
  'within +/-3 years accepted',
  !!them.evaluateRecord(target, card({ name: 'Deborah Williams', born: 'Born October 1960 (65 years old)', city: 'Houston', state: 'TX', zip: '77047' })),
  true
);

// gates
check('different zip rejected', them.evaluateRecord(target, card({ name: 'Deborah Williams', born: CARD_BORN, city: 'Houston', state: 'TX', zip: '77099' })), null);
check('different state rejected', them.evaluateRecord(target, card({ name: 'Deborah Williams', born: CARD_BORN, city: 'Sacramento', state: 'CA', zip: '77047' })), null);
check('first-name-only match rejected', them.evaluateRecord(target, card({ name: 'Michael R. Williams', born: CARD_BORN, city: 'Houston', state: 'TX', zip: '77047' })), null);
check('different last name rejected', them.evaluateRecord(target, card({ name: 'Deborah Smith', born: CARD_BORN, city: 'Houston', state: 'TX', zip: '77047' })), null);

const partial = them.evaluateRecord(target, card({ name: 'Deborah Williams', born: CARD_BORN, city: 'Houston', state: 'TX', zip: '77047', street: '99 Elm St' }));
check('exact street match outranks the rest', good.score > partial.score, true);

const noZipTarget = them.buildTarget({ targetName: 'Deborah Williams', targetAge: 67, targetYear: 1958, state: 'TX', addresses: [] });
check(
  'record without a zip still matches a card in another zip',
  !!them.evaluateRecord(noZipTarget, card({ name: 'Deborah Williams', born: CARD_BORN, city: 'Houston', state: 'TX', zip: '77099' })),
  true
);
check(
  'card without a DOB has no label to report',
  !them.evaluateRecord(target, card({ name: 'Deborah Williams', city: 'Houston', state: 'TX', zip: '77047' })).dob,
  true
);

// ---- URL builders ----------------------------------------------------------
console.log('\n== ThatSthem URL builders (background.js) ==\n');

check('name url', bg.buildThatsThemNameUrl('Deborah Williams', 'Houston', 'TX', '77047'), 'https://thatsthem.com/name/Deborah-Williams/Houston-TX-77047');
check('name url without zip', bg.buildThatsThemNameUrl('Deborah Williams', 'Houston', 'TX', ''), 'https://thatsthem.com/name/Deborah-Williams/Houston-TX');
check(
  'name url without any location still searches the name',
  bg.buildThatsThemNameUrl('Deborah Williams', '', '', ''),
  'https://thatsthem.com/name/Deborah-Williams'
);
check(
  'address url',
  bg.buildThatsThemAddressUrl({ street: '3724 Kildare Dr', city: 'Houston', state: 'TX', zip: '77047' }),
  'https://thatsthem.com/address/3724-Kildare-Dr-Houston-TX-77047'
);
check(
  'address url from a combined street string',
  bg.buildThatsThemAddressUrl({ street: '3724 Kildare Dr, Houston, TX 77047' }),
  'https://thatsthem.com/address/3724-Kildare-Dr-Houston-TX-77047'
);
check('phone url', bg.buildThatsThemPhoneUrl('7132526330'), 'https://thatsthem.com/phone/713-252-6330');
check('phone url from a formatted number', bg.buildThatsThemPhoneUrl('(713) 252-6330'), 'https://thatsthem.com/phone/713-252-6330');

const plan = bg.buildThatsThemPlan({
  targetName: 'Deborah Williams',
  city: 'Houston',
  state: 'TX',
  addresses: [
    { street: '3724 Kildare Dr', city: 'Houston', state: 'TX', zip: '77047' },
    { street: '99 Elm St', city: 'Houston', state: 'TX', zip: '77002' },
  ],
  phone: '7132526330',
});
check('plan order = name, every address, phone', plan.map((s) => s.kind).join(' > '), 'name > address > address > phone');
check('plan urls', plan.map((s) => s.url), [
  'https://thatsthem.com/name/Deborah-Williams/Houston-TX-77047',
  'https://thatsthem.com/address/3724-Kildare-Dr-Houston-TX-77047',
  'https://thatsthem.com/address/99-Elm-St-Houston-TX-77002',
  'https://thatsthem.com/phone/713-252-6330',
]);
check('plan label describes the step', plan[0].label, 'name (Deborah Williams in Houston TX 77047)');
check('empty session plans nothing', bg.buildThatsThemPlan({ addresses: [] }).length, 0);

// A record whose address has no city/state/zip must still get a name step (the cards
// are filtered by name + DOB + zip anyway) - this was skipping ThatSthem entirely.
check(
  'name url falls back to the bare name when no location is known',
  bg.buildThatsThemNameUrl('Charles Loughry', '', '', ''),
  'https://thatsthem.com/name/Charles-Loughry'
);

// ---- the real "Charles W. Loughry" card ------------------------------------
console.log('\n== Real card: Charles W. Loughry (Copley, OH) ==\n');

const loughryCard = card({
  name: 'Charles W. Loughry',
  aliases: ['Charles William Loughry', 'Charles E. Loughry', 'Chuck Loughry'],
  born: 'Born December 1962 (63 years old)',
  city: 'Copley',
  state: 'OH',
  zip: '44321',
  street: 'Kibler Rd', // house number is redacted on the real card
});
const loughryTarget = them.buildTarget({
  targetName: 'Charles Loughry',
  targetAge: 63,
  targetYear: 1963,
  city: 'Copley',
  state: 'OH',
  addresses: [{ street: '2740 Kibler Rd', city: 'Copley', state: 'OH', zip: '44321' }],
});
const loughryMatch = them.evaluateRecord(loughryTarget, loughryCard);
check('the real card is accepted', !!loughryMatch, true);
check('the month is extracted, not just the year', loughryMatch && loughryMatch.dob.label, 'December 1962');
check('zip + state come from the card', [loughryMatch.zip, loughryMatch.state, loughryMatch.city], ['44321', 'OH', 'Copley']);
check('years 1963 vs 1962 stay inside the +/-3 window', loughryMatch && loughryMatch.score >= 80, true);

// a year-only card for the same person must lose against the full date
const yearOnlyCard = card({ name: 'Charles Loughry', born: 'Born 1962', city: 'Copley', state: 'OH', zip: '44321' });
const yearOnlyMatch = them.evaluateRecord(loughryTarget, yearOnlyCard);
check('year-only card keeps only the year', yearOnlyMatch && yearOnlyMatch.dob.label, '1962');
check('year-only card has no month', yearOnlyMatch && !yearOnlyMatch.dob.month, true);
check('month-bearing card scores higher than the year-only card', loughryMatch.score > yearOnlyMatch.score, true);

// ---- the real 4-card results page (the actual miss) ------------------------
console.log('\n== Real results page: four "Charles W. Loughry" cards ==\n');

const pageFourTarget = them.buildTarget({
  targetName: 'Charles Loughry',
  targetAge: 63,
  targetYear: 1963,
  city: 'Akron',
  state: 'OH',
  addresses: [{ street: '2740 Kibler Rd', city: 'Akron', state: 'OH', zip: '44321' }],
});

// The right person: current address is a DIFFERENT zip (44313);
// "2740 Kibler Rd / 44321" only appears in his previous addresses.
const december1962Card = card({
  name: 'Charles W. Loughry',
  aliases: ['Charles William Loughry', 'Charles E. Loughry', 'Chuck Loughry'],
  born: 'Born December 1962 (63 years old)',
  city: 'Akron',
  state: 'OH',
  addresses: [
    { street: 'Hampton Ridge Dr', city: 'Akron', state: 'OH', zip: '44313' }, // current
    { street: 'Kibler Rd', city: 'Copley', state: 'OH', zip: '44321' }, // previous (number redacted)
    { street: 'First Pl Ste', city: 'Bedford', state: 'OH', zip: '44146' },
    { street: '2682 Kibler Rd Unit 2706', city: 'Akron', state: 'OH', zip: '44321' },
  ],
});

const realMatch = them.evaluateRecord(pageFourTarget, december1962Card);
check('the December 1962 card is accepted', !!realMatch, true);
check('its DOB keeps the month', realMatch && realMatch.dob.label, 'December 1962');
check(
  'the zip came from a previous address',
  realMatch && realMatch.addresses.some((a) => a.zip === '44321'),
  true
);
check('the street came from a previous address too', realMatch && realMatch.score >= 150, true);

// the other three cards on that page are different (older) people
[
  'Born May 1921 (105 years old)',
  'Born December 1954 (71 years old)',
  'Born March 1933 (93 years old)',
].forEach((born) => {
  const other = card({
    name: 'Charles W. Loughry',
    born,
    city: 'Akron',
    state: 'OH',
    addresses: [{ street: '2740 Kibler Rd', city: 'Akron', state: 'OH', zip: '44321' }],
  });
  check(`card with "${born}" is rejected`, them.evaluateRecord(pageFourTarget, other), null);
});

// a same-name card whose addresses never touch the record's zip is still rejected
const wrongZipCard = card({
  name: 'Charles Loughry',
  born: 'Born December 1962 (63 years old)',
  city: 'Dayton',
  state: 'OH',
  addresses: [{ street: '99 Elm St', city: 'Dayton', state: 'OH', zip: '45402' }],
});
check('a card with no matching zip anywhere is rejected', them.evaluateRecord(pageFourTarget, wrongZipCard), null);

// ---- DOM layer: readRecord() against the real card structure ---------------
console.log('\n== ThatSthem DOM extraction (card markup) ==\n');

const streetDiv = { textContent: ' 3724 Kildare Dr ' };
const cityDiv = { textContent: 'Houston, TX 77047' };
const addressWrapper = {
  querySelectorAll: (sel) => (sel === 'div' ? [streetDiv, cityDiv] : []),
};
const addressHeading = {
  textContent: 'Current Address:',
  parentElement: { querySelectorAll: (sel) => (sel === 'span[x-href]' ? [addressWrapper] : []) },
};

const aliasNames = [
  'Deborah D. Clifton',
  'Deborah Doreen Williams',
  'Deborah S. Williams',
  'Deborah L. Williams',
  'Deborah Diane Williams',
  'Deborah Lynn Smith',
  'Deborah A. Williams',
];

const paragraph = (text, aliasNodes) => ({
  textContent: text,
  querySelectorAll: (sel) => (sel === 'span[x-href]' && aliasNodes ? aliasNodes : []),
});

const liveCard = {
  textContent:
    ' Last updated 2 months ago. Deborah Williams Lives in Houston, TX Born October 1958 (67 years old) Current Address: 3724 Kildare Dr Houston, TX 77047 67 years old ',
  querySelector: (sel) => (sel === 'h2 span[x-href]' ? { textContent: ' Deborah Williams ' } : null),
  querySelectorAll: (sel) => {
    if (sel === 'p') {
      return [
        paragraph(' Lives in Houston, TX '),
        paragraph(' Born October 1958 (67 years old) '),
        paragraph(' Known as: ' + aliasNames.join(' • '), aliasNames.map((n) => ({ textContent: ' ' + n + ' ' }))),
      ];
    }
    if (sel === 'h3') return [addressHeading];
    return [];
  },
};

const liveRecord = them.readRecord(liveCard);
check('readRecord: name from the h2', liveRecord.name, 'Deborah Williams');
check('readRecord: DOB + age', [liveRecord.dob.label, liveRecord.age], ['October 1958', 67]);
check('readRecord: location', [liveRecord.city, liveRecord.state], ['Houston', 'TX']);
check('readRecord: address + zip', [liveRecord.street, liveRecord.zip], ['3724 Kildare Dr', '77047']);
check('readRecord: aliases from the Known-as line', [liveRecord.aliases.length, liveRecord.aliases[0]], [7, 'Deborah D. Clifton']);
check('readRecord -> match pipeline reports the card DOB', them.evaluateRecord(target, liveRecord).dob.label, 'October 1958');

// card whose own name differs but lists our person under "Known as"
const aliasOnlyCard = {
  textContent: ' Deborah D. Clifton Born October 1958 (67 years old) ',
  querySelector: () => ({ textContent: ' Deborah D. Clifton ' }),
  querySelectorAll: (sel) => {
    if (sel === 'p') {
      return [
        paragraph(' Born October 1958 (67 years old) '),
        paragraph(' Known as: ' + aliasNames.join(' • '), aliasNames.map((n) => ({ textContent: ' ' + n + ' ' }))),
      ];
    }
    return [];
  },
};
const aliasOnlyMatch = them.evaluateRecord(target, them.readRecord(aliasOnlyCard));
// several "Deborah ... Williams" aliases exist; the best scoring one is reported
check('readRecord: matched through the Known-as list', aliasOnlyMatch.matchedAs.endsWith('Williams'), true);
check('readRecord: alias match still reports the DOB', aliasOnlyMatch.dob.label, 'October 1958');

// records without a name must be skipped, not crash
check('readRecord: nameless card ignored', them.readRecord({ querySelector: () => null, querySelectorAll: () => [] }), null);

// ---- "No Results Found" panel ---------------------------------------------
const noResultsHeading = { textContent: 'No Results Found', getBoundingClientRect: () => ({ width: 220, height: 40 }) };
globalThis.window = {
  getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
};
globalThis.document = {
  querySelectorAll: (sel) => (sel === 'h1, h2, h3' ? [noResultsHeading] : []),
  body: { innerText: "No Results Found We couldn't find any records matching your search." },
};
check('no-results panel detected', them.isNoResultsPage(), true);

globalThis.document = {
  querySelectorAll: () => [],
  body: { innerText: 'Deborah Williams Born October 1958 (67 years old)' },
};
check('a normal result page is not "no results"', them.isNoResultsPage(), false);

// ---- "Checking your browser" interstitial (real markup) --------------------
console.log('\n== ThatSthem browser-verification interstitial ==\n');

function browserCheckDocument(opts) {
  const o = opts || {};
  let clicks = 0;
  const cache = {};

  // Same element instance per selector, like a real DOM (attribute state persists)
  const node = (key, text, classes) => {
    if (!cache[key]) {
      const attrs = {};
      cache[key] = {
        textContent: text || '',
        classList: { contains: (c) => !!(classes && classes.indexOf(c) !== -1) },
        getAttribute: (name) => (name in attrs ? attrs[name] : null),
        setAttribute: (name, value) => {
          attrs[name] = value;
        },
        getBoundingClientRect: () => ({ width: 300, height: 65 }),
        click: () => {
          clicks++;
        },
      };
    }
    return cache[key];
  };

  globalThis.window = {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
  };

  globalThis.document = {
    title: o.pageTitle === undefined ? 'Security Check' : o.pageTitle,
    querySelectorAll: (sel) => {
      // Its own "No Results Found" card (heading + amber panel), as the live page renders it.
      if (sel.indexOf('h1, h2, h3') !== -1) {
        return o.noResultsHeading || o.noResultsPanel ? [node('nrheading', 'No Results Found', '')] : [];
      }
      if (sel.indexOf('amber') !== -1 || sel.indexOf('.no-results') !== -1) {
        return o.noResultsPanel ? [node('nrpanel', 'No Results Found', '')] : [];
      }
      return [];
    },
    body: { innerText: o.bodyText || '' },
    querySelector: (sel) => {
      if (sel.indexOf('meta[name=') !== -1) return o.securityMeta ? node('meta', '', '') : null;
      if (sel.indexOf('#captcha-container') !== -1 || sel.indexOf('.cf-turnstile') !== -1) {
        return o.captcha ? node('captcha', '', '') : null;
      }
      // Cloudflare's interstitial markup (never a bare widget).
      if (
        sel.indexOf('#challenge-form') !== -1 ||
        sel.indexOf('main.challenge') !== -1 ||
        sel.indexOf("script[src*='chl_page']") !== -1
      ) {
        return o.challengeMarkup ? node('challengemarkup', '', '') : null;
      }
      // The site's own search box, which every page of its layout carries.
      if (sel.indexOf("input[name='phone']") !== -1 || sel.indexOf("input[type='tel']") !== -1) {
        return o.siteSearchBox ? node('searchbox', '', '') : null;
      }
      if (sel.indexOf('#spinner') !== -1) return o.spinner === false ? null : node('spinner', '', '');
      if (sel === '#title') {
        return node('title', o.titleText === undefined ? "Confirm you're human" : o.titleText, '');
      }
      if (sel === '#description') {
        return node('description', o.descriptionText === undefined ? 'Complete the check below to continue.' : o.descriptionText, '');
      }
      if (sel === '#status') {
        return node('status', o.statusText === undefined ? '' : o.statusText, '');
      }
      if (sel === '#failed') return node('failed', '', o.failed ? '' : 'hidden');
      if (sel === '#retry') return node('retry', 'Try again', o.failed ? '' : 'hidden');
      return null;
    },
  };

  return () => clicks;
}

// ---- the real sentinel / Turnstile security page ---------------------------
browserCheckDocument({ securityMeta: true, captcha: true });
check('the sentinel/Turnstile security page is detected', them.isBrowserCheckPage(), true);

// each signal on its own must be enough
browserCheckDocument({ securityMeta: true, captcha: false, titleText: '', descriptionText: '', pageTitle: 'ThatsThem' });
check('the sentinel meta alone is enough', them.isBrowserCheckPage(), true);

browserCheckDocument({ pageTitle: 'Security Check', captcha: false, titleText: '', descriptionText: '' });
check('the "Security Check" title alone is enough', them.isBrowserCheckPage(), true);

browserCheckDocument({
  pageTitle: 'ThatsThem',
  captcha: true,
  titleText: '',
  descriptionText: '',
});
check('a Turnstile widget on its own is not a check', them.isBrowserCheckPage(), false);

browserCheckDocument({
  pageTitle: 'ThatsThem',
  challengeMarkup: true,
  titleText: '',
  descriptionText: '',
});
check('the Cloudflare interstitial markup is a check', them.isBrowserCheckPage(), true);

// THE REPORTED BUG: ThatSthem answers a search with nothing, and the page it renders carries its own
// Turnstile widget. Reading that widget as a challenge handed the "No Results Found" page to the user
// as something to solve - and the run then sat there for up to three minutes.
browserCheckDocument({
  pageTitle: 'People named Raymond Rodriguez - ThatsThem',
  captcha: true,
  noResultsPanel: true,
  siteSearchBox: true,
  bodyText: "No Results Found We couldn't find any records matching your search. Try a different spelling or broader search terms.",
  titleText: '',
  descriptionText: '',
});
check('a no-results page carrying the site widget is not a check', them.isBrowserCheckPage(), false);
check('and it is still read as "no records"', them.isNoResultsPage(), true);

browserCheckDocument({
  pageTitle: 'ThatsThem',
  captcha: true,
  siteSearchBox: true,
  titleText: '',
  descriptionText: '',
});
check('a page carrying the site search box is not a check', them.isBrowserCheckPage(), false);

browserCheckDocument({
  pageTitle: 'ThatsThem',
  captcha: false,
  titleText: '',
  descriptionText: 'Complete the check below to continue.',
});
check('the "complete the check below" text alone is enough', them.isBrowserCheckPage(), true);

browserCheckDocument({ pageTitle: 'Checking your browser', captcha: false, titleText: 'Checking your browser', descriptionText: '' });
check('the older "Checking your browser" page is still detected', them.isBrowserCheckPage(), true);

// ---- real result pages must never be mistaken for a check -------------------
const resultsPageOpts = {
  pageTitle: 'Charles W. Loughry, 63 - ThatsThem',
  securityMeta: false,
  captcha: false,
  titleText: '',
  descriptionText: '',
};

browserCheckDocument(resultsPageOpts);
check('a results page is not a verification page', them.isBrowserCheckPage(), false);

browserCheckDocument({
  ...resultsPageOpts,
  pageTitle: 'People named Charles Loughry - ThatsThem',
  bodyText: "No Results Found We couldn't find any records matching your search.",
});
check('the no-results page is not a verification page', them.isBrowserCheckPage(), false);
check('the no-results page is still detected as empty', them.isNoResultsPage(), true);

// The check is the user's to clear: even when it reports itself as failed, the extension
// must lay off completely - no "Try again", no retry click, nothing.
const clickCount = browserCheckDocument({ securityMeta: true, captcha: true, failed: true });
check('a failed check is still a check', them.isBrowserCheckPage(), true);
check('nothing on the check is ever clicked', clickCount(), 0);

// The run waits for the user rather than solving, so the window must be a real one.
check('the run waits at least 60s through the check', them.CHALLENGE_WAIT_MS >= 60000, true);
check('the run does not wait forever', them.CHALLENGE_WAIT_MS <= 600000, true);

console.log(`\n=== TOTAL: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);

