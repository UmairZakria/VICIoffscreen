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
const offscreenSrc = fs.readFileSync(path.join(DIR, 'offscreen.js'), 'utf8');
const offscreenHtml = fs.readFileSync(path.join(DIR, 'offscreen.html'), 'utf8');
const widgetSrc = fs.readFileSync(path.join(DIR, 'widget.js'), 'utf8');

function slice(src, start, end) {
  const a = src.indexOf(start);
  const b = src.indexOf(end);
  if (a === -1 || b === -1 || b <= a) throw new Error(`Could not slice ${start} .. ${end}`);
  return src.slice(a, b);
}

function liftFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Could not find ${name}`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`Unbalanced function ${name}`);
}

// ---- content script: helpers + name/age rules + parsers + matching --------
const themBlock = slice(themSrc, '  // ---- same rules as unmask_automation.js', '  // ---- run loop');

const them = new Function(
  themBlock +
    '\nreturn { parseBornText, parseLivesIn, parseKnownAs, parseCityStateZip, parseAddressBlock,' +
    ' parseNameDetails, matchNameScore, evaluateAliasMatch, isAgeWithinTolerance, matchAgeScore,' +
    ' evaluateRecord, buildTarget, streetKey, normalizeZip, stateToCode, cleanText,' +
    ' matchAddressEvidence, matchPhoneEvidence, isCorroboratedSearchMatch, normalizePhone,' +
    ' readRecord, readRecords, readAddressList, readEmailAddresses, readPhoneNumbers, decodePhoneHref, decodeEmailHref, selectEmailAddresses,' +
    ' emailRecordsFingerprint, EMAIL_CARD_SETTLE_MS, isNoResultsPage,' +
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
    ' splitStreetAndLocation, buildThatsThemAddressVariants, buildThatsThemPlan, primaryZipForSession };'
)();

const emailRunnerUrlBlock = slice(
  bgSrc,
  'function thatsThemEmailRunnerUrl',
  'async function finishThatsThemEmailLookup'
);
const emailRunnerUrl = new Function(`${emailRunnerUrlBlock}\nreturn thatsThemEmailRunnerUrl;`)();
const uniqueEmailAddressCount = new Function(
  `${liftFunction(bgSrc, 'uniqueEmailAddressCount')}\nreturn uniqueEmailAddressCount;`
)();
const widgetEmailHelpers = new Function(
  `${liftFunction(widgetSrc, 'mergeUniqueEmails')}\n${liftFunction(widgetSrc, 'mergeDobLookupResult')}` +
    '\nreturn { mergeUniqueEmails, mergeDobLookupResult };'
)();
const widgetEmailDisplay = new Function(
  `${liftFunction(widgetSrc, 'rankEmailAddresses')}\n${liftFunction(widgetSrc, 'visibleEmailAddresses')}` +
    '\nreturn { rankEmailAddresses, visibleEmailAddresses };'
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

console.log('\n== ThatSthem email links and preference policy ==\n');

const emailHref = (email) => Buffer.from(`/email/${email}`).toString('base64');
const emailLinkCard = (encodedEmails) => {
  const links = encodedEmails.map((encoded) => ({
    getAttribute: (name) => name === 'x-href' ? encoded : ''
  }));
  const heading = {
    textContent: 'Email Addresses:',
    parentElement: { querySelectorAll: () => links }
  };
  return { querySelectorAll: (selector) => selector === 'h3' ? [heading] : [] };
};

check(
  'masked x-href route decodes to the full email',
  them.decodeEmailHref({ getAttribute: (name) => name === 'x-href' ? emailHref('hillb@bellsouth.net') : '' }),
  'hillb@bellsouth.net'
);
const phoneHref = (phone) => Buffer.from(`/phone/${phone}`).toString('base64');
check(
  'masked phone x-href decodes to its normalized number',
  them.decodePhoneHref({ getAttribute: (name) => name === 'x-href' ? phoneHref('210-555-1212') : '' }),
  '2105551212'
);
check(
  'masked email links are collected from the Email Addresses card section',
  them.readEmailAddresses(emailLinkCard([emailHref('hillb@bellsouth.net'), emailHref('unicab@aol.com')])),
  ['hillb@bellsouth.net', 'unicab@aol.com']
);
check(
  'all decoded addresses are returned in stable unique order',
  them.selectEmailAddresses([
    'first@bellsouth.net',
    'second@aol.com',
    'third@proton.me',
    'fourth@fastmail.com',
    'preferred@gmail.com',
    'preferred@yahoo.com',
    'FIRST@BELLSOUTH.NET',
  ]),
  ['first@bellsouth.net', 'second@aol.com', 'third@proton.me', 'fourth@fastmail.com', 'preferred@gmail.com', 'preferred@yahoo.com']
);
const rankedEmailExamples = [
  'unknown@random.net',
  'person1982@random.net',
  'firstlast@random.net',
  'anything@gmail.com',
  'first@yahoo.com',
  'last1982@bellsouth.net',
  'xxxxxxxxxx@gmail.com',
];
const rankedDisplay = widgetEmailDisplay.visibleEmailAddresses(
  rankedEmailExamples,
  { name: 'First Last', age: '44 yrs (1982)' },
  false
);
check('emails matching name/year rank ahead of popular-domain-only addresses', rankedDisplay.ranked.slice(0, 3), [
  'firstlast@random.net',
  'last1982@bellsouth.net',
  'first@yahoo.com',
]);
check('popular providers are ranked after name/year matches', rankedDisplay.ranked.indexOf('anything@gmail.com') >
  rankedDisplay.ranked.indexOf('person1982@random.net'), true);
check('email card initially renders at most six addresses', rankedDisplay.visible.length, 6);
check('show more exposes every remaining unique address', widgetEmailDisplay.visibleEmailAddresses(
  rankedEmailExamples,
  { name: 'First Last', age: '44 yrs (1982)' },
  true
).visible.length, rankedDisplay.ranked.length);
check('remaining-address count drives the Show more control', rankedDisplay.remaining, 1);
console.log('\n== Merging email-button results with later DOB results ==\n');

const previouslyFound = {
  emails: ['hillb@bellsouth.net', 'unicab@aol.com', 'preferred@gmail.com'],
  dob2: 'October 1910',
  dob2Source: 'thatsthem.com',
};
const mergedDobResult = widgetEmailHelpers.mergeDobLookupResult(previouslyFound, {
  dob: 'August 1911',
  source: 'unmask.com',
  emails: ['new.address@yahoo.com', 'HILLB@bellsouth.net'],
});
check('later DOB result preserves and deduplicates earlier email results', mergedDobResult.emails, [
  'hillb@bellsouth.net',
  'unicab@aol.com',
  'preferred@gmail.com',
  'new.address@yahoo.com',
]);
check('later DOB result retains earlier ThatSthem DOB evidence', [
  mergedDobResult.firstDob,
  mergedDobResult.secondDob,
  mergedDobResult.secondDobSource,
], ['August 1911', 'October 1910', 'thatsthem.com']);
check('new Unmask DOB is still retained as the first result', [
  mergedDobResult.firstDob,
  mergedDobResult.firstDobSource,
  mergedDobResult.bestDob,
], ['August 1911', 'unmask.com', 'August 1911']);
check(
  'DOB result handler renders merged person emails, not only the latest message',
  /renderDiscoveredEmails\(record, person\.emails, person\)/.test(widgetSrc),
  true
);
check('email runner waits for links to stabilize', them.EMAIL_CARD_SETTLE_MS >= 1000, true);
check(
  'email card fingerprint changes when asynchronous links appear',
  them.emailRecordsFingerprint([{ name: 'Bertha Hill', emails: ['hillb@bellsouth.net'] }]) !==
    them.emailRecordsFingerprint([{ name: 'Bertha Hill', emails: [] }]),
  true
);

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
    emails: opts.emails || [],
    city: opts.city || '',
    state: opts.state || '',
    zip: opts.zip || '',
    street: opts.street || '',
    addresses,
    phoneNumbers: opts.phoneNumbers || [],
  };
  if (opts.born) {
    record.dob = them.parseBornText(opts.born);
    record.year = record.dob ? record.dob.year : null;
    record.age = record.dob ? record.dob.age : null;
  }
  return record;
}

console.log('\n== ThatSthem matching (name/alias + birth year) ==\n');

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
const emailMatch = them.evaluateRecord(
  target,
  card({
    name: 'Deborah Williams',
    born: CARD_BORN,
    city: 'Houston',
    state: 'TX',
    zip: '77047',
    street: '3724 Kildare Dr',
    emails: ['hillb@bellsouth.net', 'unicab@aol.com'],
  })
);
check('emails stay attached to the identity-matched card', emailMatch && emailMatch.emails, [
  'hillb@bellsouth.net',
  'unicab@aol.com',
]);

const fernandesTarget = them.buildTarget({
  targetName: 'Clair S Fernandes',
  targetAge: 84,
  targetYear: 1942,
  city: 'San Antonio',
  state: 'TX',
  addresses: [{ street: '9103 Honey Creek Dr', city: 'San Antonio', state: 'TX', zip: '78230' }],
});
const fernandezCard = card({
  name: 'Clara Severina Fernandez',
  born: 'Born September 1941 (84 years old)',
  city: 'San Antonio',
  state: 'TX',
  zip: '78230',
  street: '9103 Honey Creek Dr',
  emails: ['gfernandes@cs.com', 'clara.fernandes@aol.com'],
});
const fernandezMatch = them.evaluateRecord(fernandesTarget, fernandezCard);
check('Clair Fernandes matches the strongly corroborated Clara Fernandez card', !!fernandezMatch, true);
check('near-spelling match reports the matched card name and year', [
  fernandezMatch && fernandezMatch.name,
  fernandezMatch && fernandezMatch.year,
], ['Clara Severina Fernandez', 1941]);
check('near-spelling match returns the card DOB', fernandezMatch && fernandezMatch.dob.label, 'September 1941');
check('near-spelling match returns card emails', fernandezMatch && fernandezMatch.emails, [
  'gfernandes@cs.com',
  'clara.fernandes@aol.com',
]);
check(
  'near-spelling name and DOB match without address corroboration',
  !!them.evaluateRecord(fernandesTarget, card({
    name: 'Clara Severina Fernandez',
    born: 'Born September 1941 (84 years old)',
    city: 'Different City',
    state: 'CA',
    zip: '90001',
    street: '99 Other St',
  })),
  true
);
const nearNameOnlyMatch = them.evaluateRecord(fernandesTarget, card({
  name: 'Clara Severina Fernandez',
  born: 'Born September 1941 (84 years old)',
  city: 'Different City',
  state: 'CA',
  zip: '90001',
  street: '99 Other St',
}));
check('name search does not confirm a name/year-only near match', them.isCorroboratedSearchMatch(nearNameOnlyMatch, 'name'), false);
check('near-name match needs at least ZIP/city/state support', them.isCorroboratedSearchMatch({
  ...nearNameOnlyMatch,
  addressEvidence: 20,
}, 'name'), false);
check('address search may confirm the same name/year candidate', them.isCorroboratedSearchMatch(nearNameOnlyMatch, 'address'), true);
check(
  'similar name and address do not match when birth year is outside one year',
  them.evaluateRecord(fernandesTarget, card({
    name: 'Clara Severina Fernandez',
    born: 'Born September 1939 (84 years old)',
    city: 'San Antonio',
    state: 'TX',
    zip: '78230',
    street: '9103 Honey Creek Dr',
  })),
  null
);

const gabrielTarget = them.buildTarget({
  targetName: 'Gabriel J Fernandes',
  targetAge: 90,
  targetYear: 1936,
  city: 'San Antonio',
  state: 'TX',
  addresses: [{ street: '8918 Fall River Dr', city: 'San Antonio', state: 'TX', zip: '78250' }],
});
const gabrielCard = card({
  name: 'Gabriel Fernandes',
  aliases: ['Gabriel J. Fernandes', 'Gabriel S. Fernandes'],
  born: 'Born March 1936 (90 years old)',
  city: 'San Antonio',
  state: 'TX',
  addresses: [
    { street: '3711 Medical Dr Apt 918', city: 'San Antonio', state: 'TX', zip: '78229' },
    { street: '9103 Honey Creek Dr', city: 'San Antonio', state: 'TX', zip: '78230' },
    { street: '4226 Dumaine St', city: 'New Orleans', state: 'LA', zip: '70119' },
  ],
  emails: ['fernandes@uthscsa.edu', 'headhunter716@gmail.com', 'jaywright7878@gmail.com'],
});
const gabrielMatch = them.evaluateRecord(gabrielTarget, gabrielCard);
check('exact Known as name and birth year match despite location differences', !!gabrielMatch, true);
check('matching city/state is weaker corroboration despite a different ZIP', gabrielMatch && gabrielMatch.addressEvidence, 20);
check('city/state-only name candidate continues to address and phone fallbacks', them.isCorroboratedSearchMatch(gabrielMatch, 'name'), false);
check('moved-address match returns the ThatSthem emails', gabrielMatch && gabrielMatch.emails, [
  'fernandes@uthscsa.edu',
  'headhunter716@gmail.com',
  'jaywright7878@gmail.com',
]);
check(
  'Known as name with a birth year outside one year is rejected',
  them.evaluateRecord(gabrielTarget, card({
    name: 'Gabriel Fernandes',
    aliases: ['Gabriel J. Fernandes'],
    born: 'Born March 1934 (90 years old)',
    city: 'San Antonio',
    state: 'TX',
    addresses: [{ street: '3711 Medical Dr Apt 918', city: 'San Antonio', state: 'TX', zip: '78229' }],
  })),
  null
);
check(
  'matching name and birth year are accepted despite different city and state',
  !!them.evaluateRecord(gabrielTarget, card({
    name: 'Gabriel Fernandes',
    aliases: ['Gabriel J. Fernandes'],
    born: 'Born March 1936 (90 years old)',
    city: 'Houston',
    state: 'TX',
    addresses: [{ street: '3711 Medical Dr Apt 918', city: 'Houston', state: 'TX', zip: '78229' }],
  })),
  true
);

const ashuTarget = them.buildTarget({
  targetName: 'Ashu Noel Fernandes',
  targetAge: 59,
  targetYear: 1967,
  city: 'San Antonio',
  state: 'TX',
  addresses: [{ street: '9103 Honey Creek Dr', city: 'San Antonio', state: 'TX', zip: '78230' }],
});
const ashuCard = card({
  name: 'Ashu N. Fernandes',
  aliases: ['Ashu Noel Fernandes', 'Ashu B. Fernandes', 'Fernandes Ashu'],
  born: 'Born December 1967 (58 years old)',
  city: 'Fishers',
  state: 'IN',
  addresses: [
    { street: '11712 Steamboat Dr Apt 2122', city: 'Fishers', state: 'IN', zip: '46037' },
    { street: '9103 Honey Creek Dr', city: 'San Antonio', state: 'TX', zip: '78230' },
  ],
  emails: ['fernandes.ashu@yahoo.com', 'afernandesdls@gmail.com', 'ashu.fernandes@invitae.com'],
});
const ashuMatch = them.evaluateRecord(ashuTarget, ashuCard);
check('exact prior address overrides the card current-location mismatch', !!ashuMatch, true);
check('Ashu exact-address match returns its emails', ashuMatch && ashuMatch.emails, [
  'fernandes.ashu@yahoo.com',
  'afernandesdls@gmail.com',
  'ashu.fernandes@invitae.com',
]);
check(
  'matching name and birth year do not require the target address on the card',
  !!them.evaluateRecord(ashuTarget, card({
    name: 'Ashu N. Fernandes',
    aliases: ['Ashu Noel Fernandes'],
    born: 'Born December 1967 (58 years old)',
    city: 'Fishers',
    state: 'IN',
    addresses: [{ street: '11712 Steamboat Dr Apt 2122', city: 'Fishers', state: 'IN', zip: '46037' }],
  })),
  true
);
const phoneTarget = them.buildTarget({
  targetName: 'Gabriel J Fernandes',
  targetAge: 90,
  targetYear: 1936,
  phone: '210-555-1212',
});
const phoneCandidate = them.evaluateRecord(phoneTarget, card({
  name: 'Gabriel Fernandes',
  aliases: ['Gabriel J. Fernandes'],
  born: 'Born March 1936 (90 years old)',
  phoneNumbers: ['2105551212'],
}));
check('an exact phone match strongly corroborates a name-search candidate', phoneCandidate && phoneCandidate.phoneMatch, true);
check('the exact phone match permits a name-search candidate', them.isCorroboratedSearchMatch(phoneCandidate, 'name'), true);
const exactAddressCandidate = them.evaluateRecord(gabrielTarget, card({
  name: 'Gabriel Fernandes',
  aliases: ['Gabriel J. Fernandes'],
  born: 'Born March 1936 (90 years old)',
  addresses: [{ street: '8918 Fall River Dr', city: 'San Antonio', state: 'TX', zip: '78250' }],
}));
check('an exact street and ZIP match permits a name-search candidate', them.isCorroboratedSearchMatch(exactAddressCandidate, 'name'), true);
check(
  'the selected ThatSthem DOB candidate sends its own emails with the DOB',
  /finish\(best\.dob\.label, best\.emails\)/.test(themSrc) &&
    /sendSuccess\(dob, target\.person, emails \|\| \[\]\)/.test(themSrc),
  true
);

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

const timothyTarget = them.buildTarget({
  targetName: 'Timothy Dalton',
  targetAge: 48,
  targetYear: 1978,
  city: 'Ashland',
  state: 'OH',
  addresses: [{ street: '1956 State Route 511', city: 'Ashland', state: 'OH', zip: '44805' }],
});
const timothyCard = them.evaluateRecord(timothyTarget, card({
  name: 'Timothy C. Dalton',
  aliases: ['Timothy Curtis Dalton'],
  born: 'Born December 1977 (48 years old)',
  city: 'Perrysville',
  state: 'OH',
  addresses: [
    { street: '1172 2256 County Rd', city: 'Perrysville', state: 'OH', zip: '44864' },
    { street: '**** State Rte', city: 'Ashland', state: 'OH', zip: '44805' },
  ],
  emails: ['tammy.dalton@yahoo.com'],
}));
check('Timothy Dalton exact-name and known-as card matches birth year within ±1', !!timothyCard, true);
check('redacted historical street retains exact ZIP/city/state evidence', timothyCard && timothyCard.addressEvidence, 35);
check('strong name plus ZIP/city/state permits this name-search match', them.isCorroboratedSearchMatch(timothyCard, 'name'), true);
check('the matched Timothy card keeps its December 1977 DOB', timothyCard && timothyCard.dob.label, 'December 1977');
check('the Timothy card emails remain attached to the matched result', timothyCard && timothyCard.emails, ['tammy.dalton@yahoo.com']);

// DOB rules (same as Unmask)
check(
  '1954 card rejected for a 1958 record',
  them.evaluateRecord(target, card({ name: 'Deborah Williams', born: 'Born October 1954 (71 years old)', city: 'Houston', state: 'TX', zip: '77047' })),
  null
);
check(
  'stale age does not override an exact name and birth year',
  !!them.evaluateRecord(target, card({ name: 'Deborah Williams', born: 'Born October 1958 (72 years old)', city: 'Houston', state: 'TX', zip: '77047' })),
  true
);
check(
  'one-year birth-year difference accepted',
  !!them.evaluateRecord(target, card({ name: 'Deborah Williams', born: 'Born October 1959 (66 years old)', city: 'Houston', state: 'TX', zip: '77047' })),
  true
);
check(
  'two-year birth-year difference rejected',
  them.evaluateRecord(target, card({ name: 'Deborah Williams', born: 'Born October 1960 (65 years old)', city: 'Houston', state: 'TX', zip: '77047' })),
  null
);

// Location is search context, not an identity gate.
check('different ZIP does not reject matching name and birth year', !!them.evaluateRecord(target, card({ name: 'Deborah Williams', born: CARD_BORN, city: 'Houston', state: 'TX', zip: '77099' })), true);
check('different state does not reject matching name and birth year', !!them.evaluateRecord(target, card({ name: 'Deborah Williams', born: CARD_BORN, city: 'Sacramento', state: 'CA', zip: '77047' })), true);
check('first-name-only match rejected', them.evaluateRecord(target, card({ name: 'Michael R. Williams', born: CARD_BORN, city: 'Houston', state: 'TX', zip: '77047' })), null);
check('different last name rejected', them.evaluateRecord(target, card({ name: 'Deborah Smith', born: CARD_BORN, city: 'Houston', state: 'TX', zip: '77047' })), null);

const partial = them.evaluateRecord(target, card({ name: 'Deborah Williams', born: CARD_BORN, city: 'Houston', state: 'TX', zip: '77047', street: '99 Elm St' }));
check('exact street and ZIP corroboration outrank a different street', good.score > partial.score, true);

const noZipTarget = them.buildTarget({ targetName: 'Deborah Williams', targetAge: 67, targetYear: 1958, state: 'TX', addresses: [] });
check(
  'record without a zip still matches a card in another zip',
  !!them.evaluateRecord(noZipTarget, card({ name: 'Deborah Williams', born: CARD_BORN, city: 'Houston', state: 'TX', zip: '77099' })),
  true
);
check(
  'target birth year rejects a card with no DOB year',
  them.evaluateRecord(target, card({ name: 'Deborah Williams', city: 'Houston', state: 'TX', zip: '77047' })),
  null
);

// ---- URL builders ----------------------------------------------------------
console.log('\n== ThatSthem URL builders (background.js) ==\n');

check('email lookup uses a separate named hidden frame', /id="frame-thatsthem-email" name="thatsthem-email"/.test(offscreenHtml), true);
check('email runner has its own source-to-frame mapping', /'thatsthem-email\.com': \{ frameId: 'frame-thatsthem-email'/.test(offscreenSrc), true);
check('email lookup persists under a separate session key', bgSrc.includes("const THATSTHEM_EMAIL_STORAGE_KEY = 'thatsthem_email_pending_lookup'"), true);
check('email lookup reuses the standard name-address-phone plan', /session\.steps = buildThatsThemPlan\(session\)/.test(bgSrc), true);
check('ThatSthem threshold counts unique email addresses', uniqueEmailAddressCount([
  'a@gmail.com', 'A@gmail.com', 'b@yahoo.com', 'c@outlook.com'
]), 3);
check('two unique ThatSthem emails do not meet the stop threshold', uniqueEmailAddressCount([
  'a@gmail.com', 'a@gmail.com', 'b@yahoo.com'
]), 2);
check('three or more ThatSthem emails stop the matching Google run', /foundEmailCount > 2[\s\S]*?finishGoogleEmailLookup\(true\)/.test(bgSrc), true);
check(
  'DOB lookup starts ThatSthem DOB/email scan alongside Unmask',
  /if \(sources && sources\.thatsthem\) \{\s*startThatsThemEmailLookup\(\{\s*person,\s*record: recordSource/.test(
    slice(bgSrc, 'async function startDobLookup(person', '// ---------------------------------------------------------------------------\n// ThatSthem phase:')
  ),
  true
);
check(
  'DOB button connects the parallel ThatSthem run to the card session',
  /emailSession\.thatsthemRunning = automationSetting\("dob\.thatsthem"\)/.test(widgetSrc),
  true
);
check(
  'email runner URL carries a distinct marker',
  new URL(emailRunnerUrl('https://thatsthem.com/name/Bertha-Hill/NY')).searchParams.get('__vici_email_runner'),
  '1'
);
check(
  'ThatSthem runner selects email mode from its URL marker',
  /new URLSearchParams\(window\.location\.search\)\.has\("__vici_email_runner"\)/.test(themSrc),
  true
);
check(
  'fallback navigations keep the email runner marker',
  /nextUrl: thatsThemEmailRunnerUrl\(nextStep\.url\)/.test(bgSrc),
  true
);

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
check(
  'Clair Fernandes address URL matches the manual ThatSthem search',
  bg.buildThatsThemAddressUrl({
    street: '9103 Honey Creek Dr',
    city: 'San Antonio',
    state: 'TX',
    zip: '78230',
  }),
  'https://thatsthem.com/address/9103-Honey-Creek-Dr-San-Antonio-TX-78230'
);
const wacoAddress = {
  street: '1405 Air Base Rd',
  city: 'WACO 30, Waco',
  state: 'TX',
  zip: '76705',
  full: '1405 Air Base Rd, WACO 30, Waco, Texas 76705',
};
check(
  'Waco address variant moves the embedded trailing number into a trailer unit',
  bg.buildThatsThemAddressVariants(wacoAddress),
  [{ street: '1405 Air Base Rd Trlr 30', city: 'Waco', state: 'TX', zip: '76705' }]
);
check(
  'normal city ending in a number is not rewritten without the repeated-city pattern',
  bg.buildThatsThemAddressVariants({
    street: '1405 Air Base Rd',
    city: 'Waco 30',
    state: 'TX',
    zip: '76705',
    full: '1405 Air Base Rd, Waco 30, Texas 76705',
  }),
  []
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
const wacoPlan = bg.buildThatsThemPlan({
  targetName: 'Target Person',
  city: 'Waco',
  state: 'TX',
  addresses: [wacoAddress],
});
check('Waco trailer-format query follows the original address query', wacoPlan.map((s) => s.url), [
  'https://thatsthem.com/name/Target-Person/Waco-TX-76705',
  'https://thatsthem.com/address/1405-Air-Base-Rd-Waco-30-Waco-TX-76705',
  'https://thatsthem.com/address/1405-Air-Base-Rd-Trlr-30-Waco-TX-76705',
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
check('years 1963 vs 1962 stay inside the +/-1 window', loughryMatch && loughryMatch.score >= 80, true);

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
check('the card is accepted independently of street scoring', !!realMatch, true);

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

// A same-name card can match even when its location history differs.
const wrongZipCard = card({
  name: 'Charles Loughry',
  born: 'Born December 1962 (63 years old)',
  city: 'Dayton',
  state: 'OH',
  addresses: [{ street: '99 Elm St', city: 'Dayton', state: 'OH', zip: '45402' }],
});
check('a card with no matching ZIP still matches its name and birth year', !!them.evaluateRecord(pageFourTarget, wrongZipCard), true);

// ---- DOM layer: readRecord() against the real card structure ---------------
console.log('\n== ThatSthem DOM extraction (card markup) ==\n');

const streetDiv = { textContent: ' 3724 Kildare Dr ' };
const cityDiv = { textContent: 'Houston, TX 77047' };
const addressWrapper = {
  querySelectorAll: (sel) => (sel === 'div' ? [streetDiv, cityDiv] : []),
};
const addressHeading = {
  textContent: 'Current Address:',
  parentElement: { querySelectorAll: (sel) => (sel === 'span' ? [addressWrapper] : []) },
};
const maskedEmailLinks = ['hillb@bellsouth.net', 'unicab@aol.com'].map((email) => ({
  getAttribute: (name) => name === 'x-href' ? emailHref(email) : '',
}));
const emailHeading = {
  textContent: 'Email Addresses:',
  parentElement: {
    querySelectorAll: (sel) => (
      sel === 'span[x-href], a[x-href], span[data-href], a[data-href]' ? maskedEmailLinks : []
    ),
  },
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
    if (sel === 'h3') return [addressHeading, emailHeading];
    return [];
  },
};

const liveRecord = them.readRecord(liveCard);
check('readRecord: name from the h2', liveRecord.name, 'Deborah Williams');
check('readRecord: DOB + age', [liveRecord.dob.label, liveRecord.age], ['October 1958', 67]);
check('readRecord: location', [liveRecord.city, liveRecord.state], ['Houston', 'TX']);
check('readRecord: address + zip', [liveRecord.street, liveRecord.zip], ['3724 Kildare Dr', '77047']);
check('readRecord: aliases from the Known-as line', [liveRecord.aliases.length, liveRecord.aliases[0]], [7, 'Deborah D. Clifton']);
check('readRecord: decodes masked email links from the matching card', liveRecord.emails, [
  'hillb@bellsouth.net',
  'unicab@aol.com',
]);
check('readRecord -> match pipeline reports the card DOB', them.evaluateRecord(target, liveRecord).dob.label, 'October 1958');

const plainHoneyCreekWrapper = {
  querySelectorAll: (sel) => (
    sel === 'div'
      ? [{ textContent: ' 9103 Honey Creek Dr ' }, { textContent: 'San Antonio, TX 78230' }]
      : []
  ),
};
check(
  'readAddressList includes unlinked previous-address entries',
  them.readAddressList({
    querySelectorAll: (sel) => (sel === 'span' ? [plainHoneyCreekWrapper] : []),
  }),
  [{ street: '9103 Honey Creek Dr', city: 'San Antonio', state: 'TX', zip: '78230' }]
);

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
