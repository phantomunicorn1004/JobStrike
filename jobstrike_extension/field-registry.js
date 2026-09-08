/**
 * ATS-agnostic profile field registry.
 * Maps varied question labels / field names → semantic categories (gender, race, …)
 * and profile values → likely option text on any job board.
 */
(function (root) {
  'use strict';

  function normalizeText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const GENDER_IDENTITY_ALIASES = {
    male: 'Man',
    man: 'Man',
    female: 'Woman',
    woman: 'Woman',
    'non-binary': 'Non-binary',
    nonbinary: 'Non-binary',
    nb: 'Non-binary'
  };

  const SEXUAL_ORIENTATION_ALIASES = {
    heterosexual: 'Heterosexual',
    straight: 'Heterosexual',
    hetero: 'Heterosexual',
    gay: 'Gay',
    lesbian: 'Lesbian',
    bisexual: 'Bisexual',
    bi: 'Bisexual',
    queer: 'Queer',
    pansexual: 'Pansexual',
    asexual: 'Asexual'
  };

  const DECLINE_ALIASES = {
    'prefer not to answer': "I don't wish to answer",
    'prefer not': "I don't wish to answer",
    'decline to answer': "I don't wish to answer",
    'do not wish': "I don't wish to answer",
    "don't wish": "I don't wish to answer",
    'self describe': 'I prefer to self-describe',
    'self-describe': 'I prefer to self-describe',
    'prefer to self-describe': 'I prefer to self-describe'
  };

  /** Ordered most-specific first. */
  const PROFILE_FIELD_DEFS = [
    {
      category: 'first_name',
      confidence: 0.95,
      labelPatterns: [/^first name$/i, /^given name$/i],
      nameTokens: ['firstname', 'first_name', 'fname']
    },
    {
      category: 'last_name',
      confidence: 0.95,
      labelPatterns: [/^last name$/i, /^family name$/i, /^surname$/i],
      nameTokens: ['lastname', 'last_name', 'lname']
    },
    {
      category: 'email',
      confidence: 0.96,
      labelPatterns: [/^email$/i, /^email address$/i],
      nameTokens: ['email']
    },
    {
      category: 'phone',
      confidence: 0.92,
      labelPatterns: [/^phone$/i, /^phone number$/i, /^mobile$/i],
      nameTokens: ['phone', 'phonenumber', 'phone_number']
    },
    {
      category: 'address',
      confidence: 0.93,
      labelPatterns: [
        /^street$/i,
        /^street address$/i,
        /^address line\s*\d*$/i,
        /^mailing address$/i,
        /^address$/i,
        /^home address$/i
      ],
      excludeLabelPatterns: [/email address/i],
      nameTokens: ['street', 'address', 'addressline1', 'address1', 'streetaddress']
    },
    {
      category: 'city',
      confidence: 0.9,
      labelPatterns: [/^city$/i, /^town$/i],
      nameTokens: ['city']
    },
    {
      category: 'state',
      confidence: 0.9,
      labelPatterns: [/^state$/i, /^province$/i, /^region$/i],
      nameTokens: ['state', 'province', 'region']
    },
    {
      category: 'zip',
      confidence: 0.9,
      labelPatterns: [/^zip code$/i, /^zip$/i, /^postal code$/i, /^postcode$/i],
      nameTokens: ['zip', 'zipcode', 'postalcode', 'postal_code']
    },
    {
      category: 'country',
      confidence: 0.9,
      labelPatterns: [/^country$/i],
      excludeLabelPatterns: [/country of birth/i, /country of citizenship/i, /country of origin/i],
      nameTokens: ['country']
    },
    {
      category: 'work_authorization_us',
      confidence: 0.96,
      labelPatterns: [
        /authorized to work in the (?:united states|u\.?\s*s\.?|usa)\b/i,
        /legally authorized.*\b(?:u\.?\s*s\.?|usa|united states)\b/i,
        /eligible to work.*\b(?:u\.?\s*s\.?|usa|united states)\b/i
      ],
      yesNoStyle: true
    },
    {
      category: 'work_authorization_ca',
      confidence: 0.96,
      labelPatterns: [
        /authorized to work in canada/i,
        /legally authorized.*\bcanada\b/i,
        /eligible to work.*\bcanada\b/i
      ],
      yesNoStyle: true
    },
    {
      category: 'work_authorization_uk',
      confidence: 0.96,
      labelPatterns: [
        /authorized to work in the united kingdom/i,
        /authorized to work in the uk\b/i,
        /legally authorized.*\b(?:united kingdom|uk)\b/i,
        /eligible to work.*\b(?:united kingdom|uk)\b/i
      ],
      yesNoStyle: true
    },
    {
      category: 'lgbtq_identity',
      confidence: 0.95,
      labelPatterns: [
        /identify as lgbtq/i,
        /lgbtq\+/i,
        /\blgbtq\b/i,
        /\blgbt\b/i
      ],
      yesNoStyle: true
    },
    {
      category: 'sexual_orientation',
      confidence: 0.94,
      labelPatterns: [/how would you describe your sexual orientation/i, /sexual orientation/i],
      excludeLabelPatterns: [/\blgbtq/i],
      nameTokens: ['sexualorientation', 'sexual_orientation']
    },
    {
      category: 'gender_identity',
      confidence: 0.94,
      labelPatterns: [/how would you describe your gender identity/i, /gender identity/i],
      excludeLabelPatterns: [/sexual orientation/i],
      nameTokens: ['genderidentity', 'gender_identity']
    },
    {
      category: 'hispanic_latino',
      confidence: 0.93,
      labelPatterns: [/are you hispanic/i, /hispanic\/latino/i, /hispanic or latino/i, /spanish origin/i],
      nameTokens: ['hispanic', 'hispaniclatino', 'hispanic_ethnicity'],
      yesNoStyle: true
    },
    {
      category: 'transgender',
      confidence: 0.92,
      labelPatterns: [/do you identify as transgender/i, /transgender/i],
      nameTokens: ['transgender', 'trans'],
      yesNoStyle: true
    },
    {
      category: 'veteran_status',
      confidence: 0.92,
      labelPatterns: [
        /veteran status/i,
        /protected veteran/i,
        /armed forces/i,
        /are you a veteran/i,
        /military service/i
      ],
      nameTokens: ['veteran', 'veteranstatus', 'veteran_status'],
      yesNoStyle: true
    },
    {
      category: 'disability_status',
      confidence: 0.92,
      labelPatterns: [
        /disability status/i,
        /voluntary self-identification of disability/i,
        /have a disability/i,
        /substantially limits/i,
        /disability or chronic condition/i
      ],
      nameTokens: ['disability', 'disabilitystatus', 'disability_status'],
      yesNoStyle: true
    },
    {
      category: 'race',
      confidence: 0.94,
      labelPatterns: [
        /what is your ethnicity/i,
        /please identify your race/i,
        /identify your race/i,
        /racial\/ethnic background/i,
        /describe your racial/i,
        /race\/ethnicity/i,
        /ethnic background/i,
        /^ethnicity$/i,
        /\bethnicity\b/i
      ],
      excludeLabelPatterns: [/hispanic/i, /latino/i],
      nameTokens: ['race', 'ethnicity', 'ethnic', 'racial']
    },
    {
      category: 'gender',
      confidence: 0.9,
      labelPatterns: [/^gender$/i],
      excludeLabelPatterns: [/identity/i, /sexual/i, /pay gap/i],
      nameTokens: ['gender']
    },
    {
      category: 'pronouns',
      confidence: 0.9,
      labelPatterns: [/^pronouns$/i, /what are your pronouns/i, /preferred pronouns/i],
      nameTokens: ['pronouns', 'pronounsstrategy', 'pronouns_strategy']
    }
  ];

  const DEMOGRAPHIC_CATEGORIES = new Set([
    'gender',
    'gender_identity',
    'sexual_orientation',
    'race',
    'hispanic_latino',
    'transgender',
    'veteran_status',
    'disability_status',
    'lgbtq_identity',
    'pronouns'
  ]);

  const PLATFORM_FIELD_IDS = {
    greenhouse: {
      '4007494009': 'gender_identity',
      '4007495009': 'race',
      '4007496009': 'sexual_orientation',
      '4007497009': 'transgender',
      '4007498009': 'disability_status',
      '4007499009': 'veteran_status',
      gender: 'gender',
      hispanic_ethnicity: 'hispanic_latino',
      veteran_status: 'veteran_status',
      disability_status: 'disability_status'
    },
    rippling: {
      first_name: 'first_name',
      last_name: 'last_name',
      email: 'email',
      phone_number: 'phone',
      current_company: 'current_company',
      linkedin_link: 'linkedin',
      location: 'city',
      resume: 'resume_upload',
      cover_letter: 'cover_letter_upload',
      'eeoc.gender': 'gender',
      'eeoc.race': 'race',
      'eeoc.hispanicorlatino': 'hispanic_latino',
      'eeoc.veteranstatus': 'veteran_status',
      'eeoc.disabilitystatus': 'disability_status',
      pronouns_strategy: 'pronouns',
      pronouns: 'pronouns'
    },
    lever: {
      'input-resume': 'resume_upload',
      'name-input': 'full_name',
      'email-input': 'email',
      'phone-input': 'phone',
      'location-input': 'city',
      'org-input': 'current_company',
      'application-file-upload': 'cover_letter_upload'
    },
    ashby: {
      '_systemfield_name': 'full_name',
      '_systemfield_email': 'email',
      '_systemfield_resume': 'resume_upload',
      '_systemfield_location': 'city',
      '_systemfield_eeoc_gender': 'gender',
      '_systemfield_eeoc_race': 'race',
      '_systemfield_eeoc_veteran_status': 'veteran_status',
      '_systemfield_eeoc_disability_status': 'disability_status'
    },
    workday: {
      'name--legalname--firstname': 'first_name',
      'name--legalname--lastname': 'last_name',
      'address--addressline1': 'address',
      'address--addressline2': 'address',
      'address--city': 'city',
      'address--countryregion': 'state',
      'address--postalcode': 'zip',
      'country--country': 'country',
      'phonenumber--phonenumber': 'phone',
      'phonenumber--phonetype': 'custom_question',
      'phonenumber--countryphonecode': 'country',
      'phonenumber--extension': 'custom_question',
      'source--source': 'custom_question',
      'previousworker--candidateispreviousworker': 'custom_question',
      'formfield-legalname--firstname': 'first_name',
      'formfield-legalname--lastname': 'last_name',
      'formfield-addressline1': 'address',
      'formfield-city': 'city',
      'formfield-countryregion': 'state',
      'formfield-postalcode': 'zip',
      'formfield-country': 'country',
      'formfield-phonenumber': 'phone'
    }
  };

  function matchByLabel(labelText) {
    const L = normalizeText(labelText);
    if (!L) return null;
    for (const def of PROFILE_FIELD_DEFS) {
      if (def.excludeLabelPatterns && def.excludeLabelPatterns.some((p) => p.test(L))) continue;
      if (def.labelPatterns.some((p) => p.test(L))) {
        return { category: def.category, confidence: def.confidence || 0.9 };
      }
    }
    return null;
  }

  function matchByName(nameAttr) {
    const raw = String(nameAttr || '').toLowerCase();
    if (!raw) return null;

    const eeoBracket = /^eeo\[([^\]]+)\]/i.exec(nameAttr);
    const eeoDot = /^eeoc\.([^.]+)$/i.exec(nameAttr);
    const eeoLegacy = /^eeo\.([^.]+)/i.exec(nameAttr);
    const eeoMatch = eeoBracket || eeoDot || eeoLegacy;
    if (eeoMatch) {
      const key = eeoMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const def of PROFILE_FIELD_DEFS) {
        if (!def.nameTokens) continue;
        if (def.nameTokens.some((token) => key === token || key.includes(token))) {
          return { category: def.category, confidence: 0.92 };
        }
      }
    }

    const normalized = raw.replace(/[^a-z0-9]/g, '');
    for (const def of PROFILE_FIELD_DEFS) {
      if (!def.nameTokens) continue;
      if (def.nameTokens.some((token) => normalized === token || normalized.includes(token))) {
        return { category: def.category, confidence: 0.88 };
      }
    }
    return null;
  }

  function normalizePlatformToken(value) {
    return String(value || '').toLowerCase().replace(/-/g, '_');
  }

  function matchByPlatformId(platform, idAttr) {
    if (!platform || !idAttr) return null;
    const table = PLATFORM_FIELD_IDS[platform];
    if (!table) return null;
    const raw = String(idAttr).toLowerCase();
    const id = normalizePlatformToken(idAttr);
    const category = table[raw] || table[id];
    if (!category) return null;
    return { category, confidence: 0.95 };
  }

  function resolveFieldCategory(context) {
    const { platform, idAttr, nameAttr, labelText } = context || {};
    const fromId = matchByPlatformId(platform, idAttr);
    if (fromId) return fromId;
    const fromName = matchByName(nameAttr);
    if (fromName) return fromName;
    const fromLabel = matchByLabel(labelText);
    if (fromLabel) return fromLabel;
    return null;
  }

  function looksLikeAbsoluteUrl(value) {
    return /^https?:\/\//i.test(String(value || '').trim());
  }

  function coerceSingleProfileValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    // Do not split URLs (https://… would become "https:").
    if (looksLikeAbsoluteUrl(raw) || /^www\./i.test(raw)) return raw;
    const parts = raw.split(/\s*[/|,;]\s*|\s+\band\b\s+/i).map((s) => s.trim()).filter(Boolean);
    return parts[0] || raw;
  }

  function isDemographicCategory(category) {
    return DEMOGRAPHIC_CATEGORIES.has(category);
  }

  function isNegativeDemographicAnswer(value) {
    const v = normalizeText(value);
    if (!v) return false;
    if (/^(no|none|n\/a|false|0)$/.test(v)) return true;
    if (/^not\b|don\s*t|do\s*not|decline|prefer\s*not|don\s*t\s*wish/i.test(v)) return true;
    if (/not\s*veteran|non\s*veteran/.test(v)) return true;
    return false;
  }

  function isPositiveDemographicAnswer(value) {
    const v = normalizeText(value);
    return /^(yes|true|1)$/.test(v) || /^i\s*(am|have|identify)/.test(v);
  }

  function normalizeDemographicFillValue(category, value) {
    if (!value) return value;
    const single = coerceSingleProfileValue(value);
    const key = normalizeText(single);
    if (category === 'gender_identity' && GENDER_IDENTITY_ALIASES[key]) {
      return GENDER_IDENTITY_ALIASES[key];
    }
    if (category === 'sexual_orientation' && SEXUAL_ORIENTATION_ALIASES[key]) {
      return SEXUAL_ORIENTATION_ALIASES[key];
    }
    if (DECLINE_ALIASES[key]) return DECLINE_ALIASES[key];
    if (category === 'veteran_status') {
      if (/^no$|not\s*veteran|non\s*veteran|not\s*a\s*veteran/i.test(key)) return 'No';
      if (/^yes$|veteran/i.test(key)) return 'Yes';
    }
    if (category === 'disability_status' || category === 'hispanic_latino' || category === 'transgender' || category === 'lgbtq_identity') {
      if (/^no$|not|none|don\s*t|do\s*not/i.test(key)) return 'No';
      if (/^yes$/.test(key)) return 'Yes';
      if (/decline|prefer\s*not/.test(key)) return 'Prefer not to answer';
    }
    if (category === 'race' && /decline|prefer\s*not/.test(key)) {
      return 'Prefer not to answer';
    }
    return single;
  }

  function demographicYesNoOptionScore(optionText, targetText, category) {
    const opt = normalizeText(optionText);
    if (!opt) return 0;
    const neg = isNegativeDemographicAnswer(targetText);
    const pos = isPositiveDemographicAnswer(targetText);

    if (category === 'veteran_status') {
      if (neg) {
        if (/not a protected veteran|not a veteran|i am not|no i am not|non veteran/.test(opt)) return 0.95;
        if (opt === 'no' || opt.startsWith('no ') || opt.startsWith('no,')) return 0.88;
      }
      if (pos && !neg) {
        if (/protected veteran|i am a veteran/.test(opt) && !/not/.test(opt)) return 0.92;
        if (opt === 'yes' || opt.startsWith('yes ')) return 0.88;
      }
    }

    if (category === 'disability_status' || category === 'hispanic_latino' || category === 'transgender' || category === 'lgbtq_identity') {
      if (neg) {
        if (/do not have|don t have|not have|i am not|not identify|decline/.test(opt)) return 0.95;
        if (opt === 'no' || opt.startsWith('no ') || opt.startsWith('no,')) return 0.88;
      }
      if (pos && !neg) {
        if ((/i have|identify as|yes/.test(opt)) && !/do not|don t|not /.test(opt)) return 0.9;
      }
      if (/decline|prefer not/.test(normalizeText(targetText)) && /decline|prefer not/.test(opt)) return 0.94;
    }

    return 0;
  }

  function demographicOptionScore(optionText, targetText, category) {
    const yesNo = category ? demographicYesNoOptionScore(optionText, targetText, category) : 0;
    if (yesNo > 0) return yesNo;

    const a = normalizeText(optionText);
    const b = normalizeText(targetText);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.startsWith(`${b} `) || a.startsWith(`${b}(`) || a.startsWith(`${b}/`)) return 0.95;
    if (a.includes(b) || b.includes(a)) {
      if (a.length > b.length + 2 && a.includes(b) && !a.startsWith(b)) {
        return Math.max(0.52, 0.8 - (a.length - b.length) * 0.03);
      }
      return 0.8;
    }
    const aTokens = new Set(a.split(' '));
    const bTokens = new Set(b.split(' '));
    let overlap = 0;
    bTokens.forEach((token) => { if (aTokens.has(token)) overlap += 1; });
    return overlap / Math.max(aTokens.size, bTokens.size);
  }

  function getDemographicCandidates(category, value) {
    const single = coerceSingleProfileValue(value);
    const candidates = new Set([single, normalizeDemographicFillValue(category, single)]);
    const key = normalizeText(single);

    if (category === 'race') {
      if (key === 'asian') candidates.add('Asian (Not Hispanic or Latino)');
      if (key === 'white') candidates.add('White (Not Hispanic or Latino)');
      if (key === 'black' || key === 'african american') candidates.add('Black or African American');
      if (key === 'hispanic' || key === 'latino') candidates.add('Hispanic or Latino');
      if (key === 'native' || key.includes('american indian')) candidates.add('American Indian or Alaska Native');
      if (key.includes('hawaiian') || key.includes('pacific')) {
        candidates.add('Native Hawaiian or Other Pacific Islander');
      }
      if (key.includes('two or more')) candidates.add('Two or More Races');
    }

    if (category === 'veteran_status') {
      if (isNegativeDemographicAnswer(single)) {
        ['I am not a protected veteran', 'I am not a veteran', 'Not a protected veteran', 'No'].forEach((c) => candidates.add(c));
      } else if (isPositiveDemographicAnswer(single) || /veteran/i.test(single)) {
        ['I am a protected veteran', 'Yes'].forEach((c) => candidates.add(c));
      }
    }

    if (category === 'disability_status') {
      if (isNegativeDemographicAnswer(single)) {
        ['No, I do not have a disability', 'I do not have a disability', 'No'].forEach((c) => candidates.add(c));
      } else if (isPositiveDemographicAnswer(single)) {
        ['Yes, I have a disability', 'Yes'].forEach((c) => candidates.add(c));
      }
    }

    if (category === 'hispanic_latino' || category === 'transgender' || category === 'lgbtq_identity') {
      if (isNegativeDemographicAnswer(single)) candidates.add('No');
      if (isPositiveDemographicAnswer(single)) candidates.add('Yes');
      if (/decline|prefer\s*not/i.test(single)) {
        ['Decline to state', 'Prefer not to answer', 'I do not wish to answer'].forEach((c) => candidates.add(c));
      }
    }

    if (category === 'race' && /decline|prefer\s*not/i.test(single)) {
      ['Decline to state', 'Prefer not to answer', 'I do not wish to answer'].forEach((c) => candidates.add(c));
    }

    return [...candidates].filter(Boolean);
  }

  root.SmartJobFieldRegistry = {
    PROFILE_FIELD_DEFS,
    DEMOGRAPHIC_CATEGORIES,
    PLATFORM_FIELD_IDS,
    looksLikeAbsoluteUrl,
    matchByLabel,
    matchByName,
    matchByPlatformId,
    resolveFieldCategory,
    coerceSingleProfileValue,
    isDemographicCategory,
    normalizeDemographicFillValue,
    demographicOptionScore,
    demographicYesNoOptionScore,
    getDemographicCandidates,
    isNegativeDemographicAnswer,
    isPositiveDemographicAnswer
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
