'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'unmask_automation.js'), 'utf8');

function liftFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Missing ${name}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Unbalanced function ${name}`);
}

const evidence = new Function([
  liftFunction('normalizeName'),
  liftFunction('parseNameDetails'),
  liftFunction('matchNameScore'),
  liftFunction('isAgeWithinTolerance'),
  liftFunction('profileMatchesTarget'),
  liftFunction('hasStrongUnmaskIdentityEvidence'),
  liftFunction('canInspectNameSearchCandidate'),
  liftFunction('unmaskProfileWasVisited'),
  liftFunction('rememberUnmaskProfile'),
  liftFunction('normalizeEvidenceDigits'),
  liftFunction('normalizeEvidenceAddress'),
  liftFunction('isUnmaskNameSearchPath'),
  liftFunction('matchUnmaskCardAddress'),
  liftFunction('matchUnmaskCardPhone'),
  liftFunction('unmaskNameCardEvidence'),
  'var MATCH_AGE_TOLERANCE = 3;' +
  'var NAME_STATE_PATH_PATTERN = /^\\/[A-Za-z0-9_.\x27-]+\\/[A-Za-z]{2}(?:-[A-Za-z0-9_.\x27-]+)?\\/?$/;' +
  'var NAME_SLUG_PATH_PATTERN = /^\\/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\\/?$/;' +
  'return { matchUnmaskCardAddress, matchUnmaskCardPhone, unmaskNameCardEvidence, profileMatchesTarget,' +
    ' hasStrongUnmaskIdentityEvidence, canInspectNameSearchCandidate,' +
    ' isUnmaskNameSearchPath, unmaskProfileWasVisited, rememberUnmaskProfile };',
].join('\n'))();

let passed = 0;
function check(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, label);
  passed++;
  console.log(`PASS: ${label}`);
}

function card(text, values) {
  return {
    textContent: text,
    querySelectorAll: () => (values || []).map((value) => ({
      textContent: value,
      getAttribute: () => '',
    })),
  };
}

const targetAddress = {
  street: '1405 Air Base Rd Trlr 30',
  city: 'Waco',
  state: 'TX',
  zip: '76705',
};

check(
  'exact historical street and ZIP are strong address evidence',
  evidence.matchUnmaskCardAddress(
    card('1405 Air Base Rd Trlr 30, Waco, TX 76705'),
    [targetAddress]
  ),
  80
);
check(
  'common road suffix spelling differences still match the exact historical street and ZIP',
  evidence.matchUnmaskCardAddress(
    card('315 Burkett Flat Road, Greenbrier, AR 72058'),
    [{
      street: '315 Burkett Flat Rd',
      city: 'Greenbrier',
      state: 'AR',
      zip: '72058',
    }]
  ),
  80
);
check(
  'matching ZIP, city, and state are weaker corroboration',
  evidence.matchUnmaskCardAddress(card('Waco, TX 76705'), [targetAddress]),
  35
);
check(
  'same city and state with a different ZIP is only weak corroboration',
  evidence.matchUnmaskCardAddress(card('Waco, TX 76708'), [targetAddress]),
  20
);
check(
  'unrelated location is not address corroboration',
  evidence.matchUnmaskCardAddress(card('Austin, TX 78701'), [targetAddress]),
  0
);
check(
  'Unmask name-only results URL is recognized as a name search',
  evidence.isUnmaskNameSearchPath('/Cathleen-Mattox/'),
  true
);
check(
  'Unmask name plus state results URL remains recognized',
  evidence.isUnmaskNameSearchPath('/Danny-Kirkpatrick/AR/'),
  true
);
check(
  'a UUID-backed person profile is not mistaken for a name search',
  evidence.isUnmaskNameSearchPath('/Cathleen-Mattox/OH-Cincinnati/12345678-1234-1234-1234-123456789abc/'),
  false
);
check(
  'exact phone number corroborates the name-search candidate',
  evidence.matchUnmaskCardPhone(
    card('Phone: (210) 555-1212', ['(210) 555-1212']),
    ['2105551212']
  ),
  true
);
check(
  'partial phone number does not corroborate the candidate',
  evidence.matchUnmaskCardPhone(card('Phone: 210-555-12XX'), ['2105551212']),
  false
);
check(
  'a mismatched profile name is rejected without a matching alias',
  evidence.profileMatchesTarget('Jerry Busch', 'Gerald Busch', []),
  false
);
check(
  'an explicit matching profile alias is accepted',
  evidence.profileMatchesTarget('Jerry Busch', 'Gerald Busch', ['Jerry James Busch']),
  true
);
const profileSession = {};
evidence.rememberUnmaskProfile(
  profileSession,
  'https://unmask.com/Patricia-Metzger/OH-Cincinnati/first/',
  'https://unmask.com/address/894-Gorham-Drive--Cincinnati-OH-45245/'
);
check(
  'the selected profile is recorded before following it',
  evidence.unmaskProfileWasVisited(profileSession, 'https://unmask.com/Patricia-Metzger/OH-Cincinnati/first/'),
  true
);
check(
  'the originating address results URL is retained for profile rescans',
  profileSession.unmaskSearchUrl,
  'https://unmask.com/address/894-Gorham-Drive--Cincinnati-OH-45245/'
);
check(
  'a January-placeholder profile is saved to the run instead of returned immediately',
  /if \(isPlaceholder && session\.unmaskSearchUrl\) \{[\s\S]{0,400}session\.unmaskPlaceholderDob = dob;[\s\S]{0,500}window\.location\.href = session\.unmaskSearchUrl;/.test(source),
  true
);
check(
  'an exact-name card with a compatible age can be inspected without card-level address evidence',
  evidence.canInspectNameSearchCandidate(
    'Danny Kirkpatrick',
    'Danny Kirkpatrick',
    60,
    61,
    { address: 0, phone: false }
  ),
  true
);
check(
  'a namesake outside the age tolerance is not inspected without identity evidence',
  evidence.canInspectNameSearchCandidate(
    'Danny Kirkpatrick',
    'Danny Kirkpatrick',
    60,
    68,
    { address: 0, phone: false }
  ),
  false
);
check(
  'a different first name is not inspected without identity evidence',
  evidence.canInspectNameSearchCandidate(
    'Danny Kirkpatrick',
    'Daniel Kirkpatrick',
    60,
    60,
    { address: 0, phone: false }
  ),
  false
);
check(
  'profile-level exact address permits a candidate whose result card lacked evidence',
  evidence.hasStrongUnmaskIdentityEvidence({ address: 80, phone: false }, 60, 61),
  true
);
check(
  'profile-level ZIP/city evidence only qualifies with an exact age match',
  evidence.hasStrongUnmaskIdentityEvidence({ address: 35, phone: false }, 60, 60),
  true
);
check(
  'profile-level ZIP/city evidence without an exact age match is not enough',
  evidence.hasStrongUnmaskIdentityEvidence({ address: 35, phone: false }, 60, 61),
  false
);
check(
  'the placeholder is returned only after the candidate results are rescanned',
  /if \(session\.unmaskPlaceholderDob\) \{[\s\S]{0,500}continueSearch: true/.test(source),
  true
);

const unmaskSourceChecks = [
  /var mayUseCandidate = !isNameSearchPage \|\| canInspectNameSearchCandidate\(/,
  /if \(directNameScore > 0 && mayUseCandidate\)/,
  /if \(bestAliasMatchScore >= 80 && mayUseCandidate\)/,
  /var isTargetProfile = profileNameMatches &&\s*\(!session\.unmaskCandidateNeedsEvidence \|\|\s*hasStrongUnmaskIdentityEvidence\(profileIdentityEvidence, targetAge, profileAge\)\);/,
  /await revisitUnmaskSearchResults\(\s*noDobReason \+ "\. Checking the next matching Unmask profile\.\.\."\s*\)/,
  /if \(session\.unmaskSearchUrl && await revisitUnmaskSearchResults\([\s\S]{0,200}profileNameMatches/,
  /session\.unmaskCandidateNeedsEvidence = isNameSearchPage &&/,
];
check(
  'name-search cards inspect age-compatible exact names, verify identity on-profile, and resume results to check other candidates',
  unmaskSourceChecks.every((pattern) => pattern.test(source)),
  true
);
check(
  'profile extraction does not trust the selected-link status or URL slug as identity proof',
  !/session\.status === "on_target_profile" \|\| isSlugMatch/.test(source),
  true
);

console.log(`\n=== TOTAL: ${passed} passed, 0 failed ===\n`);
