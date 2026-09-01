// Side panel main app for Smart Job Autofill Assistant.

const STORAGE_KEY = 'scraped_jobs';
const USER_NAME_KEY = 'job_scraper_user_name';
const DAILY_DATE_KEY = 'job_scraper_daily_date';
const DAILY_COUNT_KEY = 'job_scraper_daily_count';
const DAILY_LIMIT_KEY = 'job_scraper_daily_limit';
const PROFILE_KEY = 'autofill_profile';
const CUSTOM_QUESTIONS_KEY = 'custom_question_bank';
const SETTINGS_KEY = 'autofill_settings';
const HERO_DISMISSED_KEY = 'autofill_hero_dismissed';
const TOTAL_FILLED_KEY = 'autofill_total_filled';
const HIDE_FILLED_KEY = 'autofill_hide_filled_fields';
const DISMISSED_FIELDS_KEY = 'autofill_dismissed_fields';
const APPLICATION_KITS_KEY = 'autofill_application_kits';
const SECONDS_PER_FIELD_SAVED = 15;
const DEFAULT_DAILY_LIMIT = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per uploaded resume/cover letter
const RESUME_ACCEPT_EXT = ['.pdf', '.docx', '.doc'];
const COVER_LETTER_ACCEPT_EXT = ['.pdf', '.docx', '.doc', '.txt'];

const defaultSettings = {
  dailyLimit: 10,
  customQuestionMatchThreshold: 0.75,
  selectMatchThreshold: 0.5,
  radioMatchThreshold: 0.45,
  autoFillConfidenceThreshold: 0.9,
  persistScanState: true,
  aiAutofillEnabled: false,
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini'
};

const AI_MAGIC_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.2 3.6L17 8l-3.8 1.4L12 13l-1.2-3.6L7 8l3.8-1.4L12 3z"/><path d="M5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15z"/><path d="M19 11l.6 1.7L21 13l-1.7.6L19 15l-.6-1.7L17 13l1.7-.6L19 11z"/></svg>`;

const SAVE_ANSWER_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;

/** Chat Completions models supported for AI field fill. */
const OPENAI_MODEL_OPTIONS = [
  { id: 'gpt-4o-mini', label: 'GPT-4o mini — fast, low cost (recommended)' },
  { id: 'gpt-4o', label: 'GPT-4o — balanced quality' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini — newer, efficient' },
  { id: 'gpt-4.1-nano', label: 'GPT-4.1 nano — fastest' },
  { id: 'gpt-4.1', label: 'GPT-4.1 — higher quality' },
  { id: 'o4-mini', label: 'o4-mini — reasoning' },
  { id: 'o3-mini', label: 'o3-mini — reasoning' }
];

const AI_FILL_BATCH_DELAY_MS = 450;

let editingQuestionId = null;

let currentFields = [];
let currentPlan = [];
let currentQuestions = [];
let currentProfile = {};
let currentSettings = { ...defaultSettings };
let currentScanUrl = '';
let lastSkippedCount = 0;
let lastDismissedCount = 0;
let hideFilledFields = true;
let dismissedFieldsByHost = {};
let applicationKits = [];
let expandedKitId = null;
let pendingKitFile = null; // { kitId, kind: 'resume' | 'coverLetter' }
let lastAdapterDebug = null;
let lastObservedTabId = null;
let lastObservedTabUrl = '';
let tabSwitchScrapeSeq = 0;
let tabSwitchScrapeTimer = null;

const defaultProfile = {
  firstName: '',
  lastName: '',
  preferredName: '',
  suffixName: '',
  fullName: '',
  email: '',
  dateOfBirth: '',
  phone: '',
  location: '',
  address: '',
  addressLine2: '',
  addressLine3: '',
  city: '',
  state: '',
  zip: '',
  country: '',
  linkedin: '',
  github: '',
  portfolio: '',
  currentCompany: '',
  currentTitle: '',
  yearsOfExperience: '',
  highestEducation: '',
  degree: '',
  school: '',
  major: '',
  gpa: '',
  educationStartMonth: '',
  educationStartYear: '',
  educationEndMonth: '',
  educationEndYear: '',
  graduationYear: '',
  workAuthorization: '',
  workAuthorizationUS: '',
  workAuthorizationCanada: '',
  workAuthorizationUK: '',
  sponsorshipRequirement: '',
  lgbtqIdentity: '',
  desiredSalary: '',
  noticePeriod: '',
  remotePreference: '',
  relocationPreference: '',
  gender: 'Male',
  genderIdentity: 'Man',
  sexualOrientation: 'Heterosexual',
  race: 'Asian',
  hispanicLatino: 'No',
  transgender: 'No',
  veteranStatus: 'No',
  disabilityStatus: 'No',
  pronouns: ''
};

/** Canonical profile choices; field-registry maps these to ATS-specific option text at fill time. */
const PROFILE_YES_NO_OPTIONS = {
  options: [
    { value: '', label: '— Select —' },
    { value: 'Yes', label: 'Yes' },
    { value: 'No', label: 'No' }
  ]
};

const PROFILE_YES_NO_DECLINE_OPTIONS = {
  options: [
    { value: '', label: '— Select —' },
    { value: 'Yes', label: 'Yes' },
    { value: 'No', label: 'No' },
    { value: 'Prefer not to answer', label: 'Decline to state' }
  ]
};

const PROFILE_DEMOGRAPHIC_OPTIONS = {
  workAuthorizationUS: PROFILE_YES_NO_OPTIONS,
  workAuthorizationCanada: PROFILE_YES_NO_OPTIONS,
  workAuthorizationUK: PROFILE_YES_NO_OPTIONS,
  sponsorshipRequirement: PROFILE_YES_NO_OPTIONS,
  lgbtqIdentity: PROFILE_YES_NO_DECLINE_OPTIONS,
  gender: {
    example: 'Federal EEO categories on many applications.',
    options: [
      { value: '', label: '— Select —' },
      { value: 'Male', label: 'Male' },
      { value: 'Female', label: 'Female' },
      { value: 'Non-binary', label: 'Non-Binary' },
      { value: 'Prefer not to answer', label: 'Decline to state' }
    ]
  },
  genderIdentity: {
    example: 'e.g. “Man”, “Woman”, or “Non-binary” on Greenhouse.',
    options: [
      { value: '', label: '— Select —' },
      { value: 'Man', label: 'Man' },
      { value: 'Woman', label: 'Woman' },
      { value: 'Non-binary', label: 'Non-binary' },
      { value: "I don't wish to answer", label: 'Prefer not to answer' },
      { value: 'I prefer to self-describe', label: 'Prefer to self-describe' }
    ]
  },
  sexualOrientation: {
    example: 'Pick the label closest to your answer.',
    options: [
      { value: '', label: '— Select —' },
      { value: 'Heterosexual', label: 'Heterosexual' },
      { value: 'Gay', label: 'Gay' },
      { value: 'Lesbian', label: 'Lesbian' },
      { value: 'Bisexual', label: 'Bisexual' },
      { value: 'Queer', label: 'Queer' },
      { value: 'Pansexual', label: 'Pansexual' },
      { value: 'Asexual', label: 'Asexual' },
      { value: "I don't wish to answer", label: 'Prefer not to answer' }
    ]
  },
  race: {
    example: 'We match longer labels (e.g. “Asian (Not Hispanic or Latino)”) automatically.',
    allowCustom: true,
    options: [
      { value: '', label: '— Select —' },
      { value: 'Asian', label: 'Asian' },
      { value: 'East Asian', label: 'East Asian' },
      { value: 'South Asian', label: 'South Asian' },
      { value: 'Southeast Asian', label: 'Southeast Asian' },
      { value: 'Black or African American', label: 'Black or African American' },
      { value: 'White', label: 'White' },
      { value: 'Hispanic or Latino', label: 'Hispanic or Latino' },
      { value: 'American Indian or Alaska Native', label: 'American Indian or Alaska Native' },
      { value: 'Native Hawaiian or Other Pacific Islander', label: 'Native Hawaiian or Other Pacific Islander' },
      { value: 'Two or More Races', label: 'Two or More Races' },
      { value: 'Prefer not to answer', label: 'Decline to state' },
      { value: 'Decline to state', label: 'Decline to state' },
      { value: '__custom__', label: 'Other (type below)' }
    ]
  },
  hispanicLatino: {
    example: 'Yes / No on most forms.',
    options: [
      { value: '', label: '— Select —' },
      { value: 'No', label: 'No' },
      { value: 'Yes', label: 'Yes' },
      { value: 'Prefer not to answer', label: 'Prefer not to answer' }
    ]
  },
  transgender: {
    example: 'Yes / No on most forms.',
    options: [
      { value: '', label: '— Select —' },
      { value: 'No', label: 'No' },
      { value: 'Yes', label: 'Yes' },
      { value: 'Prefer not to answer', label: 'Prefer not to answer' }
    ]
  },
  veteranStatus: {
    example: 'Applications may say “I am not a protected veteran” — we match that from No.',
    options: [
      { value: '', label: '— Select —' },
      { value: 'No', label: 'No' },
      { value: 'Yes', label: 'Yes' },
      { value: 'Prefer not to answer', label: 'Decline to state' }
    ]
  },
  disabilityStatus: {
    example: 'Applications may use long disability statements — we match from No or Yes.',
    options: [
      { value: '', label: '— Select —' },
      { value: 'No', label: 'No' },
      { value: 'Yes', label: 'Yes' },
      { value: 'Prefer not to answer', label: 'Decline to state' }
    ]
  }
};

const PROFILE_DEMOGRAPHIC_KEYS = [
  'race',
  'workAuthorizationUS',
  'workAuthorizationCanada',
  'workAuthorizationUK',
  'sponsorshipRequirement',
  'disabilityStatus',
  'lgbtqIdentity',
  'gender',
  'veteranStatus',
  'genderIdentity',
  'sexualOrientation',
  'hispanicLatino',
  'transgender'
];

const profileSections = [
  {
    id: 'personal',
    title: 'Personal',
    hero: true,
    customEdit: true,
    fields: []
  },
  {
    id: 'links',
    title: 'Links',
    icon: 'link',
    fields: [
      ['linkedin', 'LinkedIn URL'],
      ['github', 'GitHub URL'],
      ['portfolio', 'Portfolio URL']
    ]
  },
  {
    id: 'work',
    title: 'Work & application',
    icon: 'briefcase',
    fields: [
      ['currentCompany', 'Current Company'],
      ['currentTitle', 'Current Title'],
      ['yearsOfExperience', 'Years of Experience'],
      ['desiredSalary', 'Desired Salary'],
      ['noticePeriod', 'Notice Period / Start Date'],
      ['remotePreference', 'Remote Preference'],
      ['relocationPreference', 'Relocation Preference']
    ]
  },
  {
    id: 'education',
    title: 'Education',
    icon: 'education',
    customEdit: true,
    fields: []
  },
  {
    id: 'demographics',
    title: 'Demographics & EEO',
    icon: 'demographics',
    fields: [
      ['race', 'What is your ethnicity?'],
      ['workAuthorizationUS', 'Are you authorized to work in the US?'],
      ['workAuthorizationCanada', 'Are you authorized to work in Canada?'],
      ['workAuthorizationUK', 'Are you authorized to work in the United Kingdom?'],
      ['sponsorshipRequirement', 'Will you now or in the future require sponsorship for employment visa status?'],
      ['disabilityStatus', 'Do you have a disability?'],
      ['lgbtqIdentity', 'Do you identify as LGBTQ+?'],
      ['gender', 'What is your gender?'],
      ['veteranStatus', 'Are you a veteran?'],
      ['genderIdentity', 'Gender identity'],
      ['sexualOrientation', 'Sexual orientation'],
      ['hispanicLatino', 'Are you Hispanic/Latino?'],
      ['transgender', 'Transgender experience']
    ]
  }
];

const profileFields = profileSections.flatMap((section) => section.fields);

const PROFILE_SECTION_ICONS = {
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
  education: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1.1 2.7 2 6 2s6-.9 6-2v-5"/></svg>',
  demographics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
};

let profileEditMode = false;

const categoryToProfileKey = {
  first_name: 'firstName',
  last_name: 'lastName',
  preferred_name: 'preferredName',
  suffix_name: 'suffixName',
  full_name: 'fullName',
  date_of_birth: 'dateOfBirth',
  postal_code: 'zip',
  address_line_2: 'addressLine2',
  address_line_3: 'addressLine3',
  email: 'email',
  phone: 'phone',
  address: 'address',
  city: 'city',
  state: 'state',
  zip: 'zip',
  country: 'country',
  linkedin: 'linkedin',
  github: 'github',
  portfolio: 'portfolio',
  current_company: 'currentCompany',
  work_authorization: 'workAuthorizationUS',
  work_authorization_us: 'workAuthorizationUS',
  work_authorization_ca: 'workAuthorizationCanada',
  work_authorization_uk: 'workAuthorizationUK',
  sponsorship: 'sponsorshipRequirement',
  lgbtq_identity: 'lgbtqIdentity',
  salary: 'desiredSalary',
  relocation: 'relocationPreference',
  notice_period: 'noticePeriod',
  education: 'highestEducation',
  experience_years: 'yearsOfExperience',
  gender: 'gender',
  gender_identity: 'genderIdentity',
  sexual_orientation: 'sexualOrientation',
  race: 'race',
  hispanic_latino: 'hispanicLatino',
  transgender: 'transgender',
  veteran_status: 'veteranStatus',
  disability_status: 'disabilityStatus',
  pronouns: 'pronouns',
  school: 'school',
  degree: 'degree',
  graduation_year: 'graduationYear'
};

const PROFILE_LINK_CATEGORIES = new Set(['linkedin', 'github', 'portfolio']);

function isUsableProfileLinkValue(value) {
  const v = String(value || '').trim();
  if (!v) return false;
  if (/^https?:$/i.test(v)) return false;
  return true;
}

function parseRoleTitleParts(roleTitle) {
  const t = String(roleTitle || '').trim();
  const dash = /^(.+?)\s*[—–\-@]\s*(.+)$/.exec(t);
  if (dash) return { job_title: dash[1].trim(), employer_name: dash[2].trim() };
  const at = /^(.+?)\s+at\s+(.+)$/i.exec(t);
  if (at) return { job_title: at[1].trim(), employer_name: at[2].trim() };
  return { job_title: t, employer_name: '' };
}

function normalizeKitRole(raw) {
  const bullets = Array.isArray(raw.role_bullets)
    ? raw.role_bullets.map((b) => String(b).trim()).filter(Boolean)
    : Array.isArray(raw.roleBullets)
      ? raw.roleBullets.map((b) => String(b).trim()).filter(Boolean)
      : [];
  return {
    role_title: String(raw.role_title || raw.roleTitle || '').trim(),
    role_bullets: bullets,
    employer_name: String(raw.employer_name || raw.employerName || '').trim(),
    employer_phone: String(raw.employer_phone || raw.employerPhone || '').trim(),
    employer_location: String(raw.employer_location || raw.employerLocation || '').trim(),
    start_date: String(raw.start_date || raw.startDate || '').trim(),
    end_date: String(raw.end_date || raw.endDate || '').trim(),
    reason_for_leaving: String(raw.reason_for_leaving || raw.reasonForLeaving || '').trim(),
    is_current: Boolean(raw.is_current || raw.isCurrent)
  };
}

function getEmploymentKitValue(role, employmentKey, profile) {
  if (!employmentKey || employmentKey === 'intro') return '';
  const parsed = parseRoleTitleParts(role?.role_title);
  const bullets = (role?.role_bullets || []).join('\n');
  const profileLoc = [profile.city, profile.state, profile.zip].filter(Boolean).join(', ');
  const values = {
    employer_name: role?.employer_name || parsed.employer_name,
    employer_phone: role?.employer_phone || profile.phone || '',
    employer_location: role?.employer_location || profileLoc,
    start_date: role?.start_date || '',
    end_date: role?.end_date || (role?.is_current ? 'Present' : ''),
    job_title: parsed.job_title || profile.currentTitle || '',
    responsibilities: bullets,
    reason_for_leaving: role?.reason_for_leaving || 'N/A',
    is_current: (role?.is_current || /^present$/i.test(role?.end_date || '')) ? 'Yes' : 'No'
  };
  return String(values[employmentKey] ?? '').trim();
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

function demographicOptionValues(key) {
  const def = PROFILE_DEMOGRAPHIC_OPTIONS[key];
  if (!def) return [];
  return def.options.map((o) => o.value).filter((v) => v && v !== '__custom__');
}

function canonicalizeDemographicValue(key, value) {
  const single = coerceSingleProfileValue(value);
  if (!single) return '';
  const allowed = demographicOptionValues(key);
  if (allowed.includes(single)) return single;

  const lower = single.toLowerCase();
  const pick = (val) => (allowed.includes(val) ? val : single);

  if (key === 'gender') {
    if (lower === 'm' || lower === 'man') return pick('Male');
    if (lower === 'f' || lower === 'woman') return pick('Female');
    if (/non.?binary|nb/.test(lower)) return pick('Non-binary');
    if (/prefer not|decline|don.?t wish/.test(lower)) return pick('Prefer not to answer');
  }
  if (key === 'genderIdentity') {
    if (lower === 'male' || lower === 'man') return 'Man';
    if (lower === 'female' || lower === 'woman') return 'Woman';
    if (/non.?binary|nb/.test(lower)) return 'Non-binary';
    if (/prefer not|decline|don.?t wish/.test(lower)) return "I don't wish to answer";
    if (/self.?describ/.test(lower)) return 'I prefer to self-describe';
  }
  if (key === 'sexualOrientation') {
    if (/straight|hetero/.test(lower)) return 'Heterosexual';
    if (/prefer not|decline|don.?t wish/.test(lower)) return "I don't wish to answer";
  }
  if (['workAuthorizationUS', 'workAuthorizationCanada', 'workAuthorizationUK', 'sponsorshipRequirement'].includes(key)) {
    if (/^yes$|true|authorized|eligible/i.test(lower) && !/^no\b|not authorized|not eligible|don.?t|do not/i.test(lower)) {
      return pick('Yes');
    }
    if (/^no$|not|none|don.?t|do not|ineligible|unable|require sponsorship/i.test(lower)) return pick('No');
  }
  if (key === 'lgbtqIdentity') {
    if (/^yes$|true/i.test(lower) && !/^no\b|not\b/i.test(lower)) return pick('Yes');
    if (/^no$|not|don.?t|do not/i.test(lower)) return pick('No');
    if (/prefer not|decline/.test(lower)) return pick('Prefer not to answer');
  }
  if (key === 'hispanicLatino' || key === 'transgender') {
    if (/^no$|not|none|don.?t|do not/i.test(lower)) return pick('No');
    if (/^yes$|true|^i am\b/i.test(lower)) return pick('Yes');
    if (/prefer not|decline/.test(lower)) return pick('Prefer not to answer');
  }
  if (key === 'veteranStatus') {
    if (/not\s*veteran|non\s*veteran|not\s*a\s*veteran|^no$/.test(lower)) return pick('No');
    if (/^yes$|protected veteran|i am a veteran/.test(lower) && !/not/.test(lower)) return pick('Yes');
    if (/prefer not|decline/.test(lower)) return pick('Prefer not to answer');
    if (/^not veteran$/i.test(single)) return pick('No');
  }
  if (key === 'disabilityStatus') {
    if (/^no$|do not have|don.?t have|not have|no disability/.test(lower)) return pick('No');
    if (/^yes$|have a disability|i have/.test(lower) && !/do not|don.?t/.test(lower)) return pick('Yes');
    if (/prefer not|decline/.test(lower)) return pick('Prefer not to answer');
  }
  if (key === 'race') {
    if (/prefer not|decline/.test(lower)) {
      if (allowed.includes('Decline to state')) return 'Decline to state';
      return pick('Prefer not to answer');
    }
    if (/^asian\b/.test(lower) && !allowed.includes(single)) return 'Asian';
    if (/black|african/.test(lower)) return pick('Black or African American');
    if (/^white\b/.test(lower)) return pick('White');
    if (/hispanic|latino/.test(lower)) return pick('Hispanic or Latino');
    if (/prefer not|decline/.test(lower)) return pick('Prefer not to answer');
  }

  return single;
}

const EDUCATION_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const EDUCATION_DEGREE_TYPES = [
  'High School',
  'Associate',
  'Bachelor',
  "Bachelor's",
  "Bachelor's Degree",
  'Master',
  "Master's",
  'MBA',
  'PhD',
  'Doctorate',
  'Certificate',
  'Other'
];

function educationYearOptions() {
  const years = [];
  const now = new Date().getFullYear();
  for (let y = now + 2; y >= now - 45; y -= 1) years.push(String(y));
  return years;
}

function syncEducationProfileFields(p) {
  if (!p) return p;
  if (!p.educationEndYear && p.graduationYear) p.educationEndYear = String(p.graduationYear);
  if (!p.graduationYear && p.educationEndYear) p.graduationYear = String(p.educationEndYear);
  if (!p.degree && p.highestEducation) p.degree = p.highestEducation;
  if (!p.highestEducation && p.degree) p.highestEducation = p.degree;
  return p;
}

function normalizeProfile(stored) {
  const p = syncWorkAuthorizationProfileFields(syncPersonalProfileFields(syncEducationProfileFields({ ...defaultProfile, ...(stored || {}) })));
  for (const key of ['linkedin', 'portfolio', 'github']) {
    const v = String(p[key] || '').trim();
    if (/^https?:$/i.test(v)) p[key] = '';
  }
  if (stored && typeof stored === 'object') {
    for (const key of PROFILE_DEMOGRAPHIC_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(stored, key) && defaultProfile[key]) {
        p[key] = defaultProfile[key];
      }
    }
    if (!Object.prototype.hasOwnProperty.call(stored, 'genderIdentity') && stored.gender) {
      const g = String(stored.gender).trim().toLowerCase();
      const fromGender = { male: 'Man', man: 'Man', female: 'Woman', woman: 'Woman', 'non-binary': 'Non-binary', nonbinary: 'Non-binary' };
      if (fromGender[g]) p.genderIdentity = fromGender[g];
    }
    for (const key of PROFILE_DEMOGRAPHIC_KEYS) {
      if (p[key]) p[key] = canonicalizeDemographicValue(key, p[key]);
    }
  }
  return p;
}

function firstListValue(value) {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function splitFullName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function websiteProfileToAutofillProfile(record) {
  const fullName = String(record?.full_name || record?.fullName || '').trim();
  const names = splitFullName(fullName);
  const city = String(record?.city || '').trim();
  const state = String(record?.state || '').trim();
  const zip = String(record?.postal_code || record?.postalCode || '').trim();
  const location = [city, state, zip].filter(Boolean).join(', ');
  return normalizeProfile({
    fullName,
    firstName: names.firstName,
    lastName: names.lastName,
    email: firstListValue(record?.work_emails || record?.workEmails),
    phone: firstListValue(record?.phone_numbers || record?.phoneNumbers),
    dateOfBirth: String(record?.dob || '').trim(),
    address: String(record?.address || '').trim(),
    city,
    state,
    zip,
    location,
    school: String(record?.university || '').trim(),
    linkedin: String(record?.linkedin || '').trim()
  });
}

async function loadWebsiteProfileForAutofill() {
  const api = window.SmartJobRegisterResumeDb;
  const profileId = document.getElementById('regProfileId')?.value?.trim();
  if (!profileId) {
    showStatus('Select a profile first.', 'error');
    return false;
  }
  if (!api?.fetchProfileRecord) {
    showStatus('Profile loader is not available.', 'error');
    return false;
  }
  showStatus('Loading website profile…', 'info', 0);
  const record = await api.fetchProfileRecord(profileId);
  if (!record) {
    showStatus('Selected profile was not found on the website.', 'error');
    return false;
  }
  currentProfile = websiteProfileToAutofillProfile(record);
  return true;
}

function mimeTypeFromFileName(name) {
  const ext = fileExtensionOf(name);
  const map = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain'
  };
  return map[ext] || 'application/octet-stream';
}

function kitFileToUploadPayload(file) {
  if (!file || !file.dataUrl) return null;
  return {
    name: file.name,
    type: file.type || mimeTypeFromFileName(file.name),
    size: file.size,
    dataUrl: file.dataUrl
  };
}

function getKitUploadForCategory(category) {
  const kit = getDefaultKit();
  if (!kit) return null;
  if (category === 'resume_upload' && kit.resume) return kitFileToUploadPayload(kit.resume);
  if (category === 'cover_letter_upload' && kit.coverLetter) return kitFileToUploadPayload(kit.coverLetter);
  return null;
}

window.addEventListener('DOMContentLoaded', init);

function init() {
  if (document.documentElement.classList.contains('assistant-dialog')) {
    document.body.classList.add('assistant-dialog');
  }
  if (window.SmartJobTheme) {
    window.SmartJobTheme.initTheme();
    window.SmartJobTheme.wireThemeToggle();
    window.SmartJobTheme.wireThemeOptions();
  }
  setupTabs();
  if (window.SmartJobRegisterResumeDb) {
    window.SmartJobRegisterResumeDb.initRegisterResumeDb(showStatus);
  }
  if (window.SmartJobJson2Docx) {
    window.SmartJobJson2Docx.initJson2docxClient(showStatus);
  }
  renderProfileForm();
  wireProfileDemographicForm();
  wireProfileEducationForm();
  renderProfileView();
  ensureOpenAiModelSelect();
  bindEvents();
  wireOptimizedUi();
  registerPageTabSession();
  loadAllData();
  watchActiveTabChanges();
}

function bindEvents() {
  const globalRefreshBtn = document.getElementById('globalRefreshBtn');
  if (globalRefreshBtn) globalRefreshBtn.addEventListener('click', () => globalRefreshCurrentTab());
  // Rewinding to step 1 clears the scraped job description, so re-read the page.
  document.addEventListener('rwh-request-rescrape', () => {
    void scrapeCurrentJob(false);
  });
  const fillBtn = document.getElementById('regAutofillBtn') || document.getElementById('fillSelectedBtn');
  if (fillBtn) fillBtn.addEventListener('click', () => autofillThisPage({ useAi: false }));
  const fillAiBtn = document.getElementById('fillSelectedAiBtn');
  if (fillAiBtn) fillAiBtn.addEventListener('click', () => autofillThisPage({ useAi: true }));
  const aiSettingsForm = document.getElementById('aiSettingsForm');
  if (aiSettingsForm) aiSettingsForm.addEventListener('submit', saveAiSettings);
  const aiToggle = document.getElementById('aiAutofillEnabledSetting');
  if (aiToggle) {
    aiToggle.addEventListener('change', () => {
      updateAiKeyFieldHint();
      if (aiToggle.checked && !String(document.getElementById('openaiApiKeySetting')?.value || '').trim() && !getOpenAiApiKey()) {
        showStatus('Add your OpenAI API key below, then click Save AI settings.', 'info', 5000);
      }
    });
  }
  const openaiKeyInput = document.getElementById('openaiApiKeySetting');
  if (openaiKeyInput) {
    openaiKeyInput.addEventListener('input', () => {
      clearOpenAiKeyError();
      updateAiKeyFieldHint();
    });
  }
  const saveProfileBtn = document.getElementById('saveProfileBtn');
  if (saveProfileBtn) saveProfileBtn.addEventListener('click', saveProfile);
  const clearProfileBtn = document.getElementById('clearProfileBtn');
  if (clearProfileBtn) clearProfileBtn.addEventListener('click', clearProfile);
  const profileEditBtn = document.getElementById('profileEditBtn');
  if (profileEditBtn) profileEditBtn.addEventListener('click', () => setProfileEditMode(true));
  const profileCancelEditBtn = document.getElementById('profileCancelEditBtn');
  if (profileCancelEditBtn) profileCancelEditBtn.addEventListener('click', () => setProfileEditMode(false));
  const profileRefreshBtn = document.getElementById('profileRefreshBtn');
  if (profileRefreshBtn) profileRefreshBtn.addEventListener('click', refreshProfileFromStorage);
  const profileSectionsView = document.getElementById('profileSectionsView');
  if (profileSectionsView) {
    profileSectionsView.addEventListener('click', onProfileCopyClick);
  }
  const profileHeroBody = document.getElementById('profileHeroBody');
  if (profileHeroBody) {
    profileHeroBody.addEventListener('click', onProfileCopyClick);
  }
  const questionForm = document.getElementById('questionForm');
  if (questionForm) questionForm.addEventListener('submit', saveCustomQuestion);
  const addQuestionBtn = document.getElementById('addQuestionBtn');
  if (addQuestionBtn) addQuestionBtn.addEventListener('click', () => startNewQuestion());
  const cancelQuestionEditBtn = document.getElementById('cancelQuestionEditBtn');
  if (cancelQuestionEditBtn) cancelQuestionEditBtn.addEventListener('click', () => closeQuestionEditor());
  const questionsSearch = document.getElementById('questionsSearch');
  if (questionsSearch) {
    questionsSearch.addEventListener('input', () => renderQuestionsList());
    questionsSearch.addEventListener('search', () => renderQuestionsList());
  }
  const fieldsSearch = document.getElementById('fieldsSearch');
  if (fieldsSearch) {
    fieldsSearch.addEventListener('input', () => renderFieldPlan());
    fieldsSearch.addEventListener('search', () => renderFieldPlan());
  }
  const jobForm = document.getElementById('jobForm');
  if (jobForm) jobForm.addEventListener('submit', saveJobFromForm);
  const downloadJsonBtn = document.getElementById('downloadJsonBtn');
  if (downloadJsonBtn) downloadJsonBtn.addEventListener('click', downloadJobsJson);
  const resetJobsBtn = document.getElementById('resetJobsBtn');
  if (resetJobsBtn) resetJobsBtn.addEventListener('click', resetJobs);
  const settingsForm = document.getElementById('settingsForm');
  if (settingsForm) settingsForm.addEventListener('submit', saveSettings);
  const resetSettingsBtn = document.getElementById('resetSettingsBtn');
  if (resetSettingsBtn) resetSettingsBtn.addEventListener('click', resetSettingsForm);
  const dismissBtn = document.getElementById('dismissHeroBtn');
  if (dismissBtn) dismissBtn.addEventListener('click', dismissHero);
  const quickSave = document.getElementById('quickSaveJobBtn');
  if (quickSave) quickSave.addEventListener('click', quickSaveCurrentJob);
  const hideFilledToggle = document.getElementById('hideFilledToggle');
  if (hideFilledToggle) hideFilledToggle.addEventListener('change', onHideFilledToggleChange);
  const refreshAdapterBtn = document.getElementById('refreshAdapterDebugBtn');
  if (refreshAdapterBtn) refreshAdapterBtn.addEventListener('click', refreshAdapterDebug);

  const addKitBtn = document.getElementById('addKitBtn');
  if (addKitBtn) addKitBtn.addEventListener('click', addApplicationKitFromUI);
  const kitFilePicker = document.getElementById('kitFilePicker');
  if (kitFilePicker) {
    kitFilePicker.addEventListener('change', () => {
      if (kitFilePicker.files && kitFilePicker.files.length && pendingKitFile) {
        uploadKitFile(pendingKitFile.kitId, pendingKitFile.kind, kitFilePicker.files[0]);
        kitFilePicker.value = '';
        pendingKitFile = null;
      }
    });
  }
  const kitsContainer = document.getElementById('kitsContainer');
  if (kitsContainer) kitsContainer.addEventListener('click', onKitsContainerClick);
  if (kitsContainer) kitsContainer.addEventListener('input', onKitsContainerInput);

  bindSettingsRangePreviews();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[APPLICATION_KITS_KEY]) {
      applicationKits = (Array.isArray(changes[APPLICATION_KITS_KEY].newValue)
        ? changes[APPLICATION_KITS_KEY].newValue
        : []
      ).map((k) => normalizeKit(k));
      renderApplicationKits();
    }
    if (changes[PROFILE_KEY]) {
      const mirrored = { ...defaultProfile, ...(changes[PROFILE_KEY].newValue || {}) };
      currentProfile = normalizeProfile(mirrored);
      fillProfileForm(currentProfile);
      renderProfileView(currentProfile);
      regeneratePlan();
    }
    if (changes[CUSTOM_QUESTIONS_KEY]) {
      currentQuestions = Array.isArray(changes[CUSTOM_QUESTIONS_KEY].newValue) ? changes[CUSTOM_QUESTIONS_KEY].newValue : [];
      renderQuestionsList();
      regeneratePlan();
    }
    if (changes[SETTINGS_KEY]) {
      currentSettings = { ...defaultSettings, ...(changes[SETTINGS_KEY].newValue || {}) };
      fillSettingsForm(currentSettings);
    syncAiUiVisibility();
      syncAiUiVisibility();
      regeneratePlan();
    }
    if (changes[STORAGE_KEY] || changes[DAILY_COUNT_KEY] || changes[DAILY_DATE_KEY]) {
      updateDailyStats();
      renderSavedJobs();
    }
    if (changes[TOTAL_FILLED_KEY]) {
      updateLifetimeStatsDisplay(Number(changes[TOTAL_FILLED_KEY].newValue || 0));
    }
    if (changes[HERO_DISMISSED_KEY]) {
      applyHeroDismissedState(Boolean(changes[HERO_DISMISSED_KEY].newValue));
    }
    if (changes[DISMISSED_FIELDS_KEY]) {
      dismissedFieldsByHost = (changes[DISMISSED_FIELDS_KEY].newValue && typeof changes[DISMISSED_FIELDS_KEY].newValue === 'object')
        ? changes[DISMISSED_FIELDS_KEY].newValue
        : {};
    }
  });
}

function ensureOpenAiModelSelect() {
  const select = document.getElementById('openaiModelSetting');
  if (!select || select.tagName !== 'SELECT') return null;
  if (select.dataset.populated === '1') return select;
  select.innerHTML = OPENAI_MODEL_OPTIONS.map(
    (m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`
  ).join('');
  select.dataset.populated = '1';
  return select;
}

function setOpenAiModelSelectValue(modelId) {
  const select = ensureOpenAiModelSelect();
  if (!select) return;
  const value = String(modelId || defaultSettings.openaiModel).trim() || defaultSettings.openaiModel;
  const known = OPENAI_MODEL_OPTIONS.some((m) => m.id === value);
  if (!known && value) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = `${value} (saved)`;
    select.appendChild(opt);
  }
  select.value = value;
}

function bindSettingsRangePreviews() {
  const rangeIds = [
    'customQuestionMatchThreshold',
    'selectMatchThreshold',
    'radioMatchThreshold',
    'autoFillConfidenceThreshold'
  ];
  rangeIds.forEach((id) => {
    const input = document.getElementById(id);
    const valueEl = document.getElementById(`${id}Value`);
    if (!input || !valueEl) return;
    input.addEventListener('input', () => { valueEl.textContent = Number(input.value).toFixed(2); });
  });
}

function fillSettingsForm(settings) {
  const merged = { ...defaultSettings, ...settings };
  const setRange = (id, value) => {
    const input = document.getElementById(id);
    const valueEl = document.getElementById(`${id}Value`);
    if (input) input.value = String(value);
    if (valueEl) valueEl.textContent = Number(value).toFixed(2);
  };
  setRange('customQuestionMatchThreshold', merged.customQuestionMatchThreshold);
  setRange('selectMatchThreshold', merged.selectMatchThreshold);
  setRange('radioMatchThreshold', merged.radioMatchThreshold);
  setRange('autoFillConfidenceThreshold', merged.autoFillConfidenceThreshold);
  const dailyInput = document.getElementById('dailyLimitSetting');
  if (dailyInput) dailyInput.value = String(merged.dailyLimit);
  const persistInput = document.getElementById('persistScanStateSetting');
  if (persistInput) persistInput.checked = Boolean(merged.persistScanState);
  const aiEnabled = document.getElementById('aiAutofillEnabledSetting');
  if (aiEnabled) aiEnabled.checked = Boolean(merged.aiAutofillEnabled);
  const apiKey = document.getElementById('openaiApiKeySetting');
  if (apiKey) apiKey.value = merged.openaiApiKey || '';
  setOpenAiModelSelectValue(merged.openaiModel || defaultSettings.openaiModel);
  syncAiUiVisibility();
  updateAiKeyFieldHint();
}

function readAiSettingsForm() {
  const modelSelect = ensureOpenAiModelSelect();
  return {
    aiAutofillEnabled: Boolean(document.getElementById('aiAutofillEnabledSetting')?.checked),
    openaiApiKey: String(document.getElementById('openaiApiKeySetting')?.value || '').trim(),
    openaiModel: String(modelSelect?.value || '').trim() || defaultSettings.openaiModel
  };
}

function readSettingsForm() {
  const num = (id) => Number(document.getElementById(id).value);
  return {
    customQuestionMatchThreshold: num('customQuestionMatchThreshold'),
    selectMatchThreshold: num('selectMatchThreshold'),
    radioMatchThreshold: num('radioMatchThreshold'),
    autoFillConfidenceThreshold: num('autoFillConfidenceThreshold'),
    dailyLimit: Math.max(1, parseInt(document.getElementById('dailyLimitSetting').value, 10) || defaultSettings.dailyLimit),
    persistScanState: document.getElementById('persistScanStateSetting').checked,
    aiAutofillEnabled: currentSettings.aiAutofillEnabled,
    openaiApiKey: currentSettings.openaiApiKey,
    openaiModel: currentSettings.openaiModel
  };
}

function isAiToggleEnabled() {
  return Boolean(currentSettings.aiAutofillEnabled);
}

function getOpenAiApiKey() {
  return String(currentSettings.openaiApiKey || '').trim();
}

function isAiModeEnabled() {
  return Boolean(isAiToggleEnabled() && getOpenAiApiKey());
}

function isAiFillButtonDisabled(row) {
  if (!isAiToggleEnabled()) return true;
  if (isAiBlockedField(row)) return true;
  if (!getOpenAiApiKey()) return true;
  if (!isRowFillable(row) && row?.source !== 'ai') return true;
  return false;
}

function getAiFillButtonTitle(row) {
  if (!isAiToggleEnabled()) return 'Enable AI fill in Settings';
  if (!getOpenAiApiKey()) return 'Add your OpenAI API key in Settings first';
  if (isAiBlockedField(row)) return 'Upload file in Application kits first';
  if (!isRowFillable(row) && row?.source !== 'ai') return 'Enter a value or enable profile data first';
  return 'Generate answer with OpenAI, then fill';
}

function clearOpenAiKeyError() {
  const input = document.getElementById('openaiApiKeySetting');
  const hint = document.getElementById('openaiApiKeyHint');
  if (input) {
    input.classList.remove('input-error');
    input.removeAttribute('aria-invalid');
  }
  if (hint) {
    hint.textContent = '';
    hint.classList.add('hidden');
  }
}

function openSettingsPanel() {
  const settingsPanel = document.getElementById('tab-settings');
  const alreadyOpen = Boolean(settingsPanel?.classList.contains('active'));
  if (alreadyOpen) {
    activateExtensionTab('register', { tier: 'main' });
    return;
  }
  activateExtensionTab('settings', { tier: 'settings' });
}

function showOpenAiKeyRequired(message) {
  const text = message || 'OpenAI API key is required. Enter your key below and click Save AI settings.';
  showStatus(text, 'error', 7000);
  openSettingsPanel();
  window.setTimeout(() => {
    const input = document.getElementById('openaiApiKeySetting');
    const hint = document.getElementById('openaiApiKeyHint');
    const card = input?.closest('.card');
    if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (input) {
      input.classList.add('input-error');
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
    if (hint) {
      hint.textContent = 'API key is required to use AI fill.';
      hint.classList.remove('hidden');
    }
    updateAiKeyFieldHint();
  }, 80);
  return false;
}

/** Returns API key string, or null after showing the settings prompt. */
function requireOpenAiApiKey(message) {
  const fromForm = String(document.getElementById('openaiApiKeySetting')?.value || '').trim();
  const key = getOpenAiApiKey() || fromForm;
  if (key) return key;
  showOpenAiKeyRequired(message);
  return null;
}

function updateAiKeyFieldHint() {
  const hint = document.getElementById('openaiApiKeyHint');
  const input = document.getElementById('openaiApiKeySetting');
  if (!hint || !input) return;
  const toggleOn = Boolean(document.getElementById('aiAutofillEnabledSetting')?.checked);
  const hasKey = Boolean(String(input.value || '').trim() || getOpenAiApiKey());
  if (toggleOn && !hasKey && !input.classList.contains('input-error')) {
    hint.textContent = 'Required when AI fill is enabled.';
    hint.classList.remove('hidden');
  } else if (!input.classList.contains('input-error')) {
    hint.textContent = '';
    hint.classList.add('hidden');
  }
}

function syncAiUiVisibility() {
  const toggleOn = isAiToggleEnabled();
  const hasKey = Boolean(getOpenAiApiKey());
  const bulkAi = document.getElementById('fillSelectedAiBtn');
  if (bulkAi) {
    bulkAi.classList.toggle('hidden', !toggleOn);
    bulkAi.classList.toggle('needs-api-key', toggleOn && !hasKey);
    bulkAi.title = toggleOn && !hasKey
      ? 'Add your OpenAI API key in Settings first'
      : 'Generate answers with OpenAI, then fill';
  }
  updateAiKeyFieldHint();
  if (currentPlan.length) renderFieldPlan();
}

function saveAiSettings(event) {
  if (event) event.preventDefault();
  const ai = readAiSettingsForm();
  if (ai.aiAutofillEnabled && !ai.openaiApiKey) {
    showOpenAiKeyRequired('Cannot enable AI fill without an API key. Paste your OpenAI key below.');
    return;
  }
  clearOpenAiKeyError();
  const settings = { ...currentSettings, ...ai };
  chrome.storage.local.set({ [SETTINGS_KEY]: settings }, () => {
    currentSettings = settings;
    syncAiUiVisibility();
    renderFieldPlan();
    if (ai.aiAutofillEnabled && ai.openaiApiKey) {
      showStatus('AI settings saved. Magic Fill buttons are ready.', 'success');
    } else if (ai.openaiApiKey) {
      showStatus('API key saved. Turn on AI fill to show magic Fill buttons.', 'success');
    } else {
      showStatus('AI settings saved.', 'success');
    }
  });
}

function saveSettings(event) {
  if (event) event.preventDefault();
  const settings = readSettingsForm();
  chrome.storage.local.set({
    [SETTINGS_KEY]: settings,
    [DAILY_LIMIT_KEY]: settings.dailyLimit
  }, () => {
    currentSettings = settings;
    // persistScanState only controls the durable copy; the live scan stays.
    regeneratePlan();
    showStatus('Settings saved.', 'success');
  });
}

function resetSettingsForm(event) {
  if (event) event.preventDefault();
  fillSettingsForm(defaultSettings);
  showStatus('Defaults loaded. Click Save Settings to apply.', 'info');
}

function activateExtensionTab(tabId, options = {}) {
  const tier = options.tier || 'main';

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabId}`);
  });

  const settingsBtn = document.getElementById('headerSettingsBtn');
  const isSettings = tabId === 'settings' || tier === 'settings';

  if (settingsBtn) {
    settingsBtn.classList.toggle('active', isSettings);
  }

  document.querySelectorAll('.tab-main').forEach((btn) => {
    btn.classList.toggle('active', !isSettings && tier === 'main' && btn.dataset.tab === tabId);
  });

  document.querySelectorAll('.tab-sub').forEach((btn) => {
    btn.classList.toggle(
      'active',
      btn.dataset.tab === tabId && (tier === 'sub' || tier === 'settings')
    );
  });
}

function setupTabs() {
  document.querySelectorAll('.tab-main, .tab-sub').forEach((btn) => {
    btn.addEventListener('click', () => {
      activateExtensionTab(btn.dataset.tab, { tier: btn.dataset.tier || 'main' });
    });
  });

  const settingsBtn = document.getElementById('headerSettingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      openSettingsPanel();
    });
  }
}

function loadAllData() {
  chrome.storage.local.get([
    PROFILE_KEY, APPLICATION_KITS_KEY, 'autofill_profiles', 'autofill_active_profile_id',
    CUSTOM_QUESTIONS_KEY, USER_NAME_KEY,
    SETTINGS_KEY, DAILY_LIMIT_KEY, HERO_DISMISSED_KEY, TOTAL_FILLED_KEY, HIDE_FILLED_KEY,
    DISMISSED_FIELDS_KEY
  ], (result) => {
    dismissedFieldsByHost = (result[DISMISSED_FIELDS_KEY] && typeof result[DISMISSED_FIELDS_KEY] === 'object')
      ? result[DISMISSED_FIELDS_KEY]
      : {};
    const legacyProfile = normalizeProfile(result[PROFILE_KEY] || {});
    if (!legacyProfile.fullName && result[USER_NAME_KEY]) legacyProfile.fullName = result[USER_NAME_KEY];
    currentProfile = legacyProfile;

    const migrated = migrateApplicationKitsIfNeeded(
      result[APPLICATION_KITS_KEY],
      result.autofill_profiles,
      result.autofill_active_profile_id,
      legacyProfile
    );
    applicationKits = migrated.kits;
    if (migrated.profileData) currentProfile = normalizeProfile(migrated.profileData);

    currentQuestions = Array.isArray(result[CUSTOM_QUESTIONS_KEY]) ? result[CUSTOM_QUESTIONS_KEY] : [];
    currentSettings = { ...defaultSettings, ...(result[SETTINGS_KEY] || {}) };
    if (result[DAILY_LIMIT_KEY]) currentSettings.dailyLimit = Number(result[DAILY_LIMIT_KEY]) || currentSettings.dailyLimit;

    hideFilledFields = result[HIDE_FILLED_KEY] === undefined ? true : Boolean(result[HIDE_FILLED_KEY]);
    const toggle = document.getElementById('hideFilledToggle');
    if (toggle) toggle.checked = hideFilledFields;

    fillProfileForm(currentProfile);
    renderProfileView(currentProfile);
    renderApplicationKits();
    fillSettingsForm(currentSettings);
    syncAiUiVisibility();
    renderQuestionsList();
    updateDailyStats();
    renderSavedJobs();
    applyHeroDismissedState(Boolean(result[HERO_DISMISSED_KEY]));
    updateLifetimeStatsDisplay(Number(result[TOTAL_FILLED_KEY] || 0));

    if (migrated.didMigrate) {
      persistApplicationKits({ mirror: currentProfile });
    }

    // Job info and scan state are restored by the per-tab session on bind.
  });
}

function applyHeroDismissedState(dismissed) {
  const heroCard = document.getElementById('heroCard');
  if (heroCard) heroCard.classList.toggle('hidden', dismissed);
}

function dismissHero() {
  chrome.storage.local.set({ [HERO_DISMISSED_KEY]: true }, () => applyHeroDismissedState(true));
}

function onHideFilledToggleChange(event) {
  hideFilledFields = Boolean(event.target.checked);
  chrome.storage.local.set({ [HIDE_FILLED_KEY]: hideFilledFields });
  renderFieldPlan();
}

function updateLifetimeStatsDisplay(total) {
  const safeTotal = Math.max(0, Math.floor(total || 0));
  const countEl = document.getElementById('totalFilledCount');
  if (countEl) countEl.textContent = safeTotal.toLocaleString();
  const minutesEl = document.getElementById('minutesSaved');
  if (minutesEl) {
    const minutes = Math.round((safeTotal * SECONDS_PER_FIELD_SAVED) / 60);
    minutesEl.textContent = minutes.toLocaleString();
  }
  const flame = document.getElementById('totalFilledFire');
  if (flame) flame.style.opacity = safeTotal > 0 ? '1' : '0.4';
}

function bumpLifetimeFilled(amount) {
  if (!amount || amount < 1) return;
  chrome.storage.local.get([TOTAL_FILLED_KEY], (result) => {
    const next = Number(result[TOTAL_FILLED_KEY] || 0) + Math.floor(amount);
    chrome.storage.local.set({ [TOTAL_FILLED_KEY]: next }, () => updateLifetimeStatsDisplay(next));
  });
}

function openPreviewSection() {
  const section = document.getElementById('previewSection');
  if (section && !section.open) section.open = true;
}

/** Scan state now lives in the per-tab session; this just triggers a capture. */
function saveScanState() {
  window.SmartJobTabSession?.sync();
}

function clearScanState() {
  currentFields = [];
  currentPlan = [];
  currentScanUrl = '';
  lastSkippedCount = 0;
  const detectedCount = document.getElementById('detectedCount');
  if (detectedCount) detectedCount.textContent = '0';
  renderFieldPlan();
  window.SmartJobTabSession?.sync();
}

/* --------------------------------------------------- per-tab session slice */

function capturePageSession() {
  const scrapeForm = {};
  ['jobCompany', 'jobTitle', 'jobLink'].forEach((id) => {
    scrapeForm[id] = document.getElementById(id)?.value || '';
  });
  return {
    scrapeForm,
    autofill: {
      fields: currentFields,
      plan: currentPlan.map((row) => ({
        fieldId: row.field.id,
        suggestedValue: row.suggestedValue,
        source: row.source,
        status: row.status,
        fillOutcome: row.fillOutcome || null,
        fillError: row.fillError || '',
        confidence: row.confidence,
        customQuestionId: row.customQuestionId
      })),
      url: currentScanUrl,
      skipped: lastSkippedCount
    }
  };
}

function restorePageSession(data) {
  const state = data || {};

  ['jobCompany', 'jobTitle', 'jobLink'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = state.scrapeForm?.[id] || '';
  });

  const saved = state.autofill || {};
  currentFields = Array.isArray(saved.fields) ? saved.fields : [];
  currentScanUrl = saved.url || '';
  lastSkippedCount = Number.isFinite(saved.skipped) ? saved.skipped : 0;

  const planById = new Map((saved.plan || []).map((row) => [row.fieldId, row]));
  currentPlan = currentFields.map((field) => {
    const fresh = createPlanRow(field);
    const stored = planById.get(field.id);
    if (!stored) return fresh;
    return {
      ...fresh,
      suggestedValue: stored.suggestedValue !== undefined ? stored.suggestedValue : fresh.suggestedValue,
      source: stored.source || fresh.source,
      status: stored.status || fresh.status,
      fillOutcome: stored.fillOutcome || fresh.fillOutcome || null,
      fillError: stored.fillError || fresh.fillError || '',
      confidence: stored.confidence ?? fresh.confidence,
      customQuestionId: stored.customQuestionId || fresh.customQuestionId
    };
  });

  invalidateAiContextCache();
  const detectedCount = document.getElementById('detectedCount');
  if (detectedCount) detectedCount.textContent = currentFields.length;
  renderFieldPlan();
  if (currentFields.length) openPreviewSection();
}

function pageSessionToPersist(data) {
  if (!data) return null;
  // Honour the existing "don't keep my scan" setting for the durable copy only;
  // in-memory per-tab isolation always applies.
  if (!currentSettings.persistScanState) {
    return { scrapeForm: data.scrapeForm || {}, autofill: null };
  }
  return data;
}

function pageSessionHasWork(data) {
  return Boolean(data?.autofill?.fields?.length);
}

function registerPageTabSession() {
  window.SmartJobTabSession?.registerSlice('page', {
    capture: capturePageSession,
    restore: restorePageSession,
    toPersist: pageSessionToPersist,
    hasWork: pageSessionHasWork
  });
}

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function showStatus(message, type = 'info', timeout = 4000) {
  const text = String(message || '').trim();
  if (!text) return;

  // Hidden dialog iframe: parent page shows the toast.
  if (IS_ASSISTANT_DIALOG) {
    notifyOptActionFeedback(message, type, timeout);
    return;
  }

  // Side panel: show on the active tab (bottom-right), not inside the narrow panel.
  try {
    chrome.runtime.sendMessage(
      { action: 'showPageToastOnActiveTab', message: text, type, timeout },
      (response) => {
        void chrome.runtime.lastError;
        if (!response?.success && typeof showToast === 'function') {
          showToast(message, type, timeout);
        }
      }
    );
  } catch (_) {
    if (typeof showToast === 'function') showToast(message, type, timeout);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSimilarity(a, b) {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.88;
  const xt = new Set(x.split(' ').filter((t) => t.length > 1));
  const yt = new Set(y.split(' ').filter((t) => t.length > 1));
  if (!xt.size || !yt.size) return 0;
  let overlap = 0;
  yt.forEach((token) => { if (xt.has(token)) overlap += 1; });
  const jaccard = overlap / new Set([...xt, ...yt]).size;
  const containment = overlap / Math.min(xt.size, yt.size);
  return Math.max(jaccard, containment * 0.8);
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const current = tabs[0] || null;
      if (current?.id && current.url && /^https?:\/\//i.test(current.url)) {
        resolve(current);
        return;
      }
      try {
        const lastFocused = await chrome.windows.getLastFocused({
          populate: true,
          windowTypes: ['normal']
        });
        const active = lastFocused?.tabs?.find((tab) => tab.active);
        if (active?.id) {
          resolve(active);
          return;
        }
      } catch (_) {
        /* ignore */
      }
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (fallbackTabs) => {
        resolve(fallbackTabs[0] || current || null);
      });
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, (pingResponse) => {
      if (!chrome.runtime.lastError && pingResponse && pingResponse.ready) {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(response);
        });
        return;
      }

      chrome.scripting.executeScript(
        { target: { tabId }, files: ['field-registry.js', 'content.js', 'assistant-overlay.js'] },
        () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, message, (response) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(response);
          });
        }, 120);
      });
    });
  });
}

async function sendToActiveTab(message) {
  const tab = await getActiveTab();
  if (!tab || !tab.id || !/^https?:\/\//.test(tab.url || '')) {
    throw new Error('Open a normal web page first.');
  }
  const response = await sendMessageToTab(tab.id, message);
  return { response, tab };
}

function summarizeTabUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    const text = `${host}${path}`;
    return text.length > 52 ? `${text.slice(0, 49)}...` : text;
  } catch (_) {
    return String(url || '').slice(0, 52) || 'this tab';
  }
}

/**
 * Shows which page the panel's current state belongs to, and flags when the tab
 * has since navigated somewhere else.
 */
function renderPinnedJobBar(tabId, liveUrl) {
  const bar = document.getElementById('pinnedJobBar');
  if (!bar) return;
  const TS = window.SmartJobTabSession;
  const boundUrl = TS?.getBoundUrl(tabId) || '';
  if (!boundUrl) {
    bar.hidden = true;
    return;
  }
  const moved = Boolean(TS?.isPinnedElsewhere(tabId, liveUrl));
  bar.hidden = false;
  bar.classList.toggle('is-moved', moved);
  const urlEl = document.getElementById('pinnedJobUrl');
  if (urlEl) {
    urlEl.textContent = summarizeTabUrl(boundUrl);
    urlEl.title = boundUrl;
  }
  const noteEl = document.getElementById('pinnedJobNote');
  if (noteEl) {
    noteEl.hidden = !moved;
    noteEl.title = moved ? 'Use Refresh to bind this panel to the current page.' : '';
  }
}

/** First scrape for a tab. Later visits restore the session instead. */
function scheduleFirstBindScrape(tabId, url) {
  if (tabSwitchScrapeTimer) {
    clearTimeout(tabSwitchScrapeTimer);
    tabSwitchScrapeTimer = null;
  }
  const TS = window.SmartJobTabSession;
  TS?.bindUrl(tabId, url);
  renderPinnedJobBar(tabId, url);

  const seq = ++tabSwitchScrapeSeq;
  const token = TS?.getGeneration();
  tabSwitchScrapeTimer = setTimeout(async () => {
    tabSwitchScrapeTimer = null;
    if (TS && !TS.isCurrentGeneration(token)) return;
    try {
      showStatus('Loading job info…', 'info', 0);
      try {
        await sendToActiveTab({ action: 'prepareForScan' });
      } catch (_) {
        /* optional */
      }
      await scrapeJobInfoToAllForms({ showSuccess: false });
      if (seq !== tabSwitchScrapeSeq) return;
      if (TS && !TS.isCurrentGeneration(token)) return;
      showStatus('Job info loaded from this tab.', 'success', 3200);
    } catch (error) {
      if (seq !== tabSwitchScrapeSeq) return;
      if (TS && !TS.isCurrentGeneration(token)) return;
      const msg = error.message || String(error);
      const friendly = /receiving end does not exist/i.test(msg)
        ? 'Cannot read this tab yet. Reload the page, or use Refresh in the header.'
        : msg;
      showStatus(friendly, 'error', 4500);
    }
  }, 350);
}

async function notifyActiveTabChange(source = 'switch') {
  try {
    const TS = window.SmartJobTabSession;
    if (source === 'ready') await TS?.hydrate();

    const tab = await getActiveTab();
    if (!tab || !tab.id) return;
    const url = String(tab.url || '');

    // A session is pinned to the page it was bound to, so navigating a tab
    // never changes panel state. Only Refresh re-binds.
    if (source === 'updated') {
      lastObservedTabUrl = url;
      renderPinnedJobBar(tab.id, url);
      return;
    }

    const previousTabId = TS?.getBoundTabId() ?? lastObservedTabId;
    if (previousTabId === tab.id && source !== 'ready') {
      renderPinnedJobBar(tab.id, url);
      return;
    }

    lastObservedTabId = tab.id;
    lastObservedTabUrl = url;

    const hadSession = Boolean(TS?.hasSession(tab.id));
    TS?.switchTo(previousTabId, tab.id);
    renderPinnedJobBar(tab.id, url);

    // Known tab: restore only. Re-scraping would overwrite its pinned draft.
    if (hadSession) return;

    if (!/^https?:\/\//.test(url)) {
      showStatus('This tab is not a web page — open a job listing to scrape.', 'info', 2800);
      return;
    }

    scheduleFirstBindScrape(tab.id, url);
  } catch (_) {}
}

function watchActiveTabChanges() {
  chrome.tabs.onActivated.addListener(() => {
    notifyActiveTabChange('switch');
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!tab || !tab.active) return;
    if (changeInfo.status !== 'complete' && !Object.prototype.hasOwnProperty.call(changeInfo, 'url')) return;
    // Same-tab navigation: refresh the pinned-URL bar only.
    notifyActiveTabChange('updated');
  });
  chrome.windows.onFocusChanged.addListener(() => {
    notifyActiveTabChange('focus');
  });
  notifyActiveTabChange('ready');
}

function getProfileDisplayName(profile) {
  const p = syncPersonalProfileFields(profile || currentProfile || {});
  if (p.fullName) return p.fullName.trim();
  const display = [p.preferredName || p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  return display || 'Your profile';
}

function getProfileInitials(profile) {
  const name = getProfileDisplayName(profile);
  if (!name || name === 'Your profile') return '?';
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatProfileLocation(profile) {
  const p = profile || currentProfile || {};
  if (p.location) return String(p.location).trim();
  const cityState = [p.city, p.state].filter(Boolean).join(', ');
  const withCountry = [cityState, p.country].filter(Boolean).join(cityState && p.country ? ', ' : '');
  if (withCountry) return withCountry;
  if (p.address) return p.address;
  return '';
}

function syncWorkAuthorizationProfileFields(p) {
  if (!p) return p;
  if (!p.workAuthorizationUS && p.workAuthorization) p.workAuthorizationUS = p.workAuthorization;
  if (!p.workAuthorization && p.workAuthorizationUS) p.workAuthorization = p.workAuthorizationUS;
  return p;
}

function syncPersonalProfileFields(p) {
  if (!p) return p;
  if (!p.preferredName && p.pronouns) p.preferredName = p.pronouns;
  if (p.location) {
    const parts = String(p.location).split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 1) p.city = parts[0];
    if (parts.length >= 2) p.state = parts[1];
    if (parts.length >= 3) p.country = parts.slice(2).join(', ');
  } else if (p.city || p.state || p.country) {
    p.location = formatProfileLocation(p);
  }
  const nameParts = [p.firstName, p.lastName, p.suffixName].filter(Boolean);
  if (nameParts.length) p.fullName = nameParts.join(' ').trim();
  return p;
}

function formatEducationSummary(profile) {
  const p = syncEducationProfileFields(profile || currentProfile || {});
  const lines = [];
  if (p.school) lines.push({ type: 'title', text: p.school });
  const detailParts = [p.major, p.degree || p.highestEducation, p.gpa ? `GPA ${p.gpa}` : ''].filter(Boolean);
  if (detailParts.length) lines.push({ type: 'sub', text: detailParts.join(' • ') });
  const start = [p.educationStartMonth, p.educationStartYear].filter(Boolean).join(' ');
  const end = [p.educationEndMonth, p.educationEndYear || p.graduationYear].filter(Boolean).join(' ');
  if (start && end) lines.push({ type: 'sub', text: `${start} – ${end}` });
  else if (end) lines.push({ type: 'sub', text: end });
  else if (p.graduationYear) lines.push({ type: 'sub', text: String(p.graduationYear) });
  return lines;
}

function formatWorkSummary(profile) {
  const p = profile || currentProfile || {};
  const lines = [];
  if (p.currentTitle) lines.push({ type: 'title', text: p.currentTitle });
  const companyParts = [p.currentCompany, p.yearsOfExperience ? `${p.yearsOfExperience} years` : ''].filter(Boolean);
  if (companyParts.length) lines.push({ type: 'sub', text: companyParts.join(' • ') });
  return lines;
}

function profileIconMarkup(iconKey) {
  const svg = PROFILE_SECTION_ICONS[iconKey] || PROFILE_SECTION_ICONS.demographics;
  return `<span class="profile-section-icon" aria-hidden="true">${svg}</span>`;
}

function profileCopyRowHtml(label, value, copyValue, options = {}) {
  const raw = value || '';
  const single = options.demographic ? coerceSingleProfileValue(raw) : raw;
  const display = single || 'Not set';
  const empty = !single;
  const copy = copyValue != null ? String(copyValue) : (single || '');
  return `
    <button type="button" class="profile-copy-row${empty ? ' empty' : ''}" data-copy="${escapeHtml(copy)}" title="Click to copy">
      <span class="profile-copy-label">${escapeHtml(label)}</span>
      <span class="profile-copy-value">${escapeHtml(display)}</span>
    </button>`;
}

function renderProfileHero(profile) {
  const nameEl = document.getElementById('profileDisplayName');
  const bodyEl = document.getElementById('profileHeroBody');
  if (!nameEl || !bodyEl) return;
  const p = profile || currentProfile || {};
  nameEl.textContent = getProfileDisplayName(p);
  const location = formatProfileLocation(p);
  bodyEl.innerHTML = `
    <div class="profile-avatar" aria-hidden="true">${escapeHtml(getProfileInitials(p))}</div>
    <div class="profile-hero-details">
      ${profileCopyRowHtml('Location', location, location)}
      ${profileCopyRowHtml('Email', p.email, p.email)}
      ${profileCopyRowHtml('Phone', p.phone, p.phone)}
    </div>`;
}

function renderProfileSectionView(section, profile) {
  const p = profile || currentProfile || {};
  if (section.id === 'personal') return '';

  if (section.id === 'education') {
    const lines = formatEducationSummary(p);
    if (!lines.length) {
      return `
        <section class="profile-section" data-section="${section.id}">
          <h3 class="profile-section-title">${escapeHtml(section.title)}</h3>
          <div class="profile-section-body">
            ${profileIconMarkup(section.icon)}
            <div class="profile-section-content profile-section-empty muted">No education added yet. Click Edit to add.</div>
          </div>
        </section>`;
    }
    return `
      <section class="profile-section" data-section="${section.id}">
        <h3 class="profile-section-title">${escapeHtml(section.title)}</h3>
        <div class="profile-section-body">
          ${profileIconMarkup(section.icon)}
          <div class="profile-section-content">
            ${lines.map((line) => {
              if (line.type === 'title') {
                return `<button type="button" class="profile-copy-row profile-summary-title" data-copy="${escapeHtml(line.text)}"><span class="profile-copy-value">${escapeHtml(line.text)}</span></button>`;
              }
              return `<button type="button" class="profile-copy-row" data-copy="${escapeHtml(line.text)}"><span class="profile-copy-value profile-summary-sub">${escapeHtml(line.text)}</span></button>`;
            }).join('')}
          </div>
        </div>
      </section>`;
  }

  if (section.id === 'work') {
    const lines = formatWorkSummary(p);
    const extraRows = section.fields
      .filter(([key]) => !['currentCompany', 'currentTitle', 'yearsOfExperience'].includes(key))
      .map(([key, label]) => profileCopyRowHtml(label, p[key], p[key]))
      .join('');
    const summaryHtml = lines.length
      ? `<div class="profile-work-summary">${lines.map((line) => {
        const cls = line.type === 'title' ? ' profile-summary-title' : ' profile-summary-sub';
        return `<button type="button" class="profile-copy-row${cls}" data-copy="${escapeHtml(line.text)}"><span class="profile-copy-value">${escapeHtml(line.text)}</span></button>`;
      }).join('')}</div>`
      : '';
    const hasAny = lines.length || section.fields.some(([key]) => p[key]);
    if (!hasAny) {
      return `
        <section class="profile-section" data-section="${section.id}">
          <h3 class="profile-section-title">${escapeHtml(section.title)}</h3>
          <div class="profile-section-body">
            ${profileIconMarkup(section.icon)}
            <div class="profile-section-content profile-section-empty muted">No work details yet. Click Edit to add.</div>
          </div>
        </section>`;
    }
    return `
      <section class="profile-section" data-section="${section.id}">
        <h3 class="profile-section-title">${escapeHtml(section.title)}</h3>
        <div class="profile-section-body">
          ${profileIconMarkup(section.icon)}
          <div class="profile-section-content">
            ${summaryHtml}
            ${extraRows ? `<div class="profile-field-list">${extraRows}</div>` : ''}
          </div>
        </div>
      </section>`;
  }

  const rows = section.fields
    .map(([key, label]) => profileCopyRowHtml(label, p[key], p[key], { demographic: section.id === 'demographics' }))
    .join('');
  const hasAny = section.fields.some(([key]) => p[key]);
  return `
    <section class="profile-section" data-section="${section.id}">
      <h3 class="profile-section-title">${escapeHtml(section.title)}</h3>
      <div class="profile-section-body">
        ${profileIconMarkup(section.icon)}
        <div class="profile-section-content${hasAny ? '' : ' profile-section-empty muted'}">
          ${hasAny ? rows : 'Nothing saved yet. Click Edit to add.'}
        </div>
      </div>
    </section>`;
}

function renderProfileView(profile) {
  const p = profile || currentProfile || {};
  renderProfileHero(p);
  const container = document.getElementById('profileSectionsView');
  if (!container) return;
  container.innerHTML = profileSections
    .filter((s) => !s.hero)
    .map((section) => renderProfileSectionView(section, p))
    .join('');
}

function renderDemographicFieldControl(key, label) {
  const def = PROFILE_DEMOGRAPHIC_OPTIONS[key];
  if (!def) {
    return `
      <label class="profile-edit-field">
        <span class="profile-edit-field-label">${escapeHtml(label)}</span>
        <input type="text" class="profile-edit-input" data-profile-key="${escapeHtml(key)}" autocomplete="off">
      </label>`;
  }
  const optionsHtml = def.options.map((o) =>
    `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`
  ).join('');
  const customHtml = def.allowCustom
    ? `<input type="text" class="profile-edit-input profile-edit-race-custom hidden" data-race-custom placeholder="Type your race / ethnicity answer" autocomplete="off">`
    : '';
  const exampleHtml = def.example
    ? `<span class="profile-edit-field-example muted">${escapeHtml(def.example)}</span>`
    : '';
  return `
    <label class="profile-edit-field profile-edit-field--demographic">
      <span class="profile-edit-field-label">${escapeHtml(label)}</span>
      <select class="profile-edit-input profile-edit-select" data-profile-key="${escapeHtml(key)}" data-demographic-select="1">${optionsHtml}</select>
      ${customHtml}
      ${exampleHtml}
    </label>`;
}

function renderPersonalTextField(key, label, { placeholder = '', required = false, optional = false, type = 'text' } = {}) {
  const labelText = optional ? `${label} (Optional)` : label;
  const reqMark = required ? '<span class="personal-field-required" aria-hidden="true">*</span>' : '';
  return `
    <label class="profile-edit-field personal-edit-field">
      <span class="profile-edit-field-label personal-edit-label">
        ${escapeHtml(labelText)}${reqMark}
      </span>
      <input type="${escapeHtml(type)}" class="profile-edit-input personal-edit-input" data-profile-key="${escapeHtml(key)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
    </label>`;
}

function renderPersonalEditSection() {
  return `
    <section class="profile-edit-section personal-edit-section profile-edit-section--personal" data-section="personal" aria-labelledby="profile-edit-personal-title">
      <h3 class="profile-edit-section-title personal-edit-title" id="profile-edit-personal-title">Edit Personal Info</h3>
      <div class="personal-edit-layout">
        ${renderPersonalTextField('firstName', 'First Name', { required: true })}
        ${renderPersonalTextField('lastName', 'Last Name', { required: true })}
        ${renderPersonalTextField('preferredName', 'Preferred Name', { optional: true, placeholder: 'e.g. Steven' })}
        ${renderPersonalTextField('suffixName', 'Suffix Name', { optional: true, placeholder: 'Enter Suffix Name' })}
        ${renderPersonalTextField('email', 'Email Address', { placeholder: 'you@example.com', type: 'email' })}
        ${renderPersonalTextField('dateOfBirth', 'Date of Birth', { placeholder: 'MM/DD/YYYY' })}
        ${renderPersonalTextField('phone', 'Phone', { placeholder: 'e.g. +1 430 203 3220' })}
        ${renderPersonalTextField('location', 'Location', { placeholder: 'e.g. Fort Worth, TX, USA' })}
        ${renderPersonalTextField('address', 'Address', { placeholder: 'e.g. 3832 Arroyo Rd' })}
        ${renderPersonalTextField('addressLine2', 'Address Line 2', { optional: true, placeholder: 'Enter Address Line 2' })}
        ${renderPersonalTextField('addressLine3', 'Address Line 3', { optional: true, placeholder: 'Enter Address Line 3' })}
        ${renderPersonalTextField('zip', 'Postal Code', { placeholder: 'e.g. 76109' })}
      </div>
    </section>`;
}

function renderEducationTextField(key, label, { placeholder = '' } = {}) {
  return `
    <label class="profile-edit-field education-edit-field education-edit-field--full">
      <span class="profile-edit-field-label">
        ${escapeHtml(label)}
      </span>
      <input type="text" class="profile-edit-input education-edit-input" data-profile-key="${escapeHtml(key)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
    </label>`;
}

function renderEducationSelectField(key, label, options, { placeholder = 'Select' } = {}) {
  const opts = options.map((opt) => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('');
  return `
    <label class="profile-edit-field education-edit-field">
      <span class="profile-edit-field-label">
        ${escapeHtml(label)}
      </span>
      <select class="profile-edit-input profile-edit-select education-edit-select" data-profile-key="${escapeHtml(key)}">
        <option value="">${escapeHtml(placeholder)}</option>
        ${opts}
      </select>
    </label>`;
}

function renderEducationEditSection() {
  const years = educationYearOptions();
  return `
    <section class="profile-edit-section education-edit-section profile-edit-section--education" data-section="education" aria-labelledby="profile-edit-education-title">
      <h3 class="profile-edit-section-title education-edit-title" id="profile-edit-education-title">Edit Education</h3>
      <div class="education-edit-layout">
        ${renderEducationTextField('school', 'School Name', {
          placeholder: 'e.g. Nanyang Technological University (NTU)'
        })}
        <div class="education-edit-row education-edit-row--3">
          ${renderEducationTextField('major', 'Major', {
            placeholder: 'e.g. Computer Science'
          })}
          ${renderEducationSelectField('degree', 'Degree Type', EDUCATION_DEGREE_TYPES, {
            placeholder: 'Select degree'
          })}
          ${renderEducationTextField('gpa', 'GPA', {
            placeholder: 'e.g. 3.9'
          })}
        </div>
        <div class="education-edit-row education-edit-row--4">
          ${renderEducationSelectField('educationStartMonth', 'Start Month', EDUCATION_MONTHS, { placeholder: 'Month' })}
          ${renderEducationSelectField('educationStartYear', 'Start Year', years, { placeholder: 'Year' })}
          ${renderEducationSelectField('educationEndMonth', 'End Month', EDUCATION_MONTHS, { placeholder: 'Month' })}
          ${renderEducationSelectField('educationEndYear', 'End Year', years, { placeholder: 'Year' })}
        </div>
        <div class="education-edit-footer">
          <button type="button" class="education-clear-dates" id="educationClearDatesBtn">Clear Dates</button>
        </div>
      </div>
    </section>`;
}

function renderProfileFieldControl(key, label, sectionId) {
  if (sectionId === 'demographics' && PROFILE_DEMOGRAPHIC_OPTIONS[key]) {
    return renderDemographicFieldControl(key, label);
  }
  return `
    <label class="profile-edit-field">
      <span class="profile-edit-field-label">${escapeHtml(label)}</span>
      <input type="text" class="profile-edit-input" data-profile-key="${escapeHtml(key)}" autocomplete="off">
    </label>`;
}

function syncRaceCustomVisibility() {
  const raceSel = document.querySelector('[data-profile-key="race"][data-demographic-select]');
  const raceCustom = document.querySelector('[data-race-custom]');
  if (!raceSel || !raceCustom) return;
  const show = raceSel.value === '__custom__';
  raceCustom.classList.toggle('hidden', !show);
  if (!show) raceCustom.removeAttribute('required');
  else raceCustom.setAttribute('aria-required', 'true');
}

function wireProfileEducationForm() {
  const form = document.getElementById('profileForm');
  if (!form || form.dataset.educationWired === '1') return;
  form.dataset.educationWired = '1';
  form.addEventListener('click', (event) => {
    const btn = event.target.closest('#educationClearDatesBtn');
    if (!btn) return;
    event.preventDefault();
    ['educationStartMonth', 'educationStartYear', 'educationEndMonth', 'educationEndYear'].forEach((key) => {
      const el = form.querySelector(`[data-profile-key="${key}"]`);
      if (el) el.value = '';
    });
  });
}

function wireProfileDemographicForm() {
  const form = document.getElementById('profileForm');
  if (!form || form.dataset.demographicWired === '1') return;
  form.dataset.demographicWired = '1';
  form.addEventListener('change', (event) => {
    if (event.target.matches('[data-profile-key="race"][data-demographic-select]')) {
      syncRaceCustomVisibility();
    }
  });
}

function renderProfileForm() {
  const form = document.getElementById('profileForm');
  if (!form) return;
  let first = true;
  form.innerHTML = profileSections.map((section) => {
    if (section.customEdit && section.id === 'personal') {
      const block = renderPersonalEditSection();
      if (first) {
        first = false;
        return block.replace('profile-edit-section personal-edit-section', 'profile-edit-section personal-edit-section profile-edit-section--first');
      }
      return block;
    }
    if (section.customEdit && section.id === 'education') {
      const block = renderEducationEditSection();
      if (first) {
        first = false;
        return block.replace('profile-edit-section education-edit-section', 'profile-edit-section education-edit-section profile-edit-section--first');
      }
      return block;
    }
    const firstClass = first ? ' profile-edit-section--first' : '';
    first = false;
    return `
    <section class="profile-edit-section${firstClass}" data-section="${escapeHtml(section.id)}" aria-labelledby="profile-edit-${escapeHtml(section.id)}-title">
      <h3 class="profile-edit-section-title" id="profile-edit-${escapeHtml(section.id)}-title">${escapeHtml(section.title)}</h3>
      ${section.id === 'demographics'
    ? '<p class="profile-edit-section-hint muted">Choose the answer that best describes you. The extension matches wording on each job application automatically — pick <strong>one</strong> option per field.</p>'
    : ''}
      <div class="profile-edit-fields">
        ${section.fields.map(([key, label]) => renderProfileFieldControl(key, label, section.id)).join('')}
      </div>
    </section>`;
  }).join('');
  wireProfileEducationForm();
}

function setProfileEditMode(editing) {
  profileEditMode = Boolean(editing);
  const viewPanel = document.getElementById('profileViewPanel');
  const editPanel = document.getElementById('profileEditPanel');
  const banner = document.getElementById('profileCopyBanner');
  if (editing) {
    fillProfileForm(currentProfile);
    viewPanel?.classList.add('hidden');
    editPanel?.classList.remove('hidden');
    banner?.classList.add('hidden');
  } else {
    viewPanel?.classList.remove('hidden');
    editPanel?.classList.add('hidden');
    banner?.classList.remove('hidden');
    renderProfileView();
  }
}

async function refreshProfileFromStorage() {
  try {
    const result = await chrome.storage.local.get([PROFILE_KEY]);
    currentProfile = normalizeProfile(result[PROFILE_KEY]);
    renderProfileView(currentProfile);
    fillProfileForm(currentProfile);
    renderProfileView(currentProfile);
    regeneratePlan();
    showStatus('Profile refreshed.', 'success', 2500);
  } catch (err) {
    showStatus(err.message || 'Could not refresh profile.', 'error');
  }
}

async function copyProfileText(text) {
  const value = String(text || '').trim();
  if (!value) {
    showStatus('Nothing to copy.', 'info', 2000);
    return;
  }
  try {
    if (typeof copyTextToClipboard === 'function') {
      await copyTextToClipboard(value);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      throw new Error('Clipboard unavailable');
    }
    showStatus('Copied to clipboard!', 'success', 2000);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      if (!document.execCommand('copy')) throw new Error('Copy failed.');
      showStatus('Copied to clipboard!', 'success', 2000);
    } catch (err) {
      showStatus('Copy failed.', 'error');
    }
    ta.remove();
  }
}

function onProfileCopyClick(event) {
  const row = event.target.closest('.profile-copy-row');
  if (!row) return;
  event.preventDefault();
  copyProfileText(row.getAttribute('data-copy') || row.textContent || '');
}

function fillProfileForm(profile) {
  const p = profile || {};
  document.querySelectorAll('[data-profile-key]').forEach((el) => {
    const key = el.dataset.profileKey;
    if (el.matches('[data-demographic-select]')) {
      const raw = canonicalizeDemographicValue(key, p[key] || '');
      const allowed = demographicOptionValues(key);
      const raceCustom = key === 'race' ? document.querySelector('[data-race-custom]') : null;
      if (key === 'race' && raw && !allowed.includes(raw)) {
        el.value = '__custom__';
        if (raceCustom) raceCustom.value = raw;
      } else {
        el.value = allowed.includes(raw) ? raw : (raw || '');
        if (raceCustom) raceCustom.value = '';
      }
      return;
    }
    if (el.matches('[data-race-custom]')) return;
    el.value = p[key] || '';
  });
  syncRaceCustomVisibility();
}

function readProfileForm() {
  const profile = { ...defaultProfile };
  document.querySelectorAll('[data-profile-key]').forEach((el) => {
    const key = el.dataset.profileKey;
    if (el.matches('[data-race-custom]')) return;
    let val = el.value.trim();
    if (el.matches('[data-demographic-select]')) {
      if (key === 'race' && val === '__custom__') {
        const custom = document.querySelector('[data-race-custom]');
        val = custom ? custom.value.trim() : '';
      }
      val = canonicalizeDemographicValue(key, val);
    } else if (PROFILE_DEMOGRAPHIC_KEYS.includes(key)) {
      val = coerceSingleProfileValue(val);
    }
    profile[key] = val;
  });
  return syncWorkAuthorizationProfileFields(syncPersonalProfileFields(syncEducationProfileFields(profile)));
}

function saveProfile(event) {
  if (event) event.preventDefault();
  const profile = normalizeProfile(readProfileForm());
  currentProfile = profile;
  persistProfileData(profile, () => {
    showStatus('Profile saved.', 'success');
    setProfileEditMode(false);
    regeneratePlan();
  });
}

function clearProfile(event) {
  if (event) event.preventDefault();
  currentProfile = { ...defaultProfile };
  fillProfileForm(currentProfile);
  persistProfileData(currentProfile, () => {
    renderProfileView();
    showStatus('Profile cleared.', 'success');
  });
}

function makeKitId() {
  return `kit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeFileId() {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeKit(raw, now) {
  const ts = now || new Date().toISOString();
  const workExperience = Array.isArray(raw.workExperience)
    ? raw.workExperience.map((role) => normalizeKitRole(role))
    : [];
  return {
    id: raw.id || makeKitId(),
    name: raw.name || 'Application kit',
    resume: raw.resume && raw.resume.dataUrl ? { ...raw.resume } : null,
    coverLetter: raw.coverLetter && raw.coverLetter.dataUrl ? { ...raw.coverLetter } : null,
    workExperience,
    isDefault: Boolean(raw.isDefault),
    createdAt: raw.createdAt || ts,
    updatedAt: raw.updatedAt || ts
  };
}

function migrateApplicationKitsIfNeeded(rawKits, rawProfiles, rawActiveId, legacyProfile) {
  const now = new Date().toISOString();
  if (Array.isArray(rawKits) && rawKits.length) {
    const kits = rawKits.map((k) => normalizeKit(k, now));
    if (!kits.some((k) => k.isDefault) && kits.length) kits[0].isDefault = true;
    return { kits, profileData: null, didMigrate: false };
  }

  if (rawProfiles && typeof rawProfiles === 'object' && Object.keys(rawProfiles).length) {
    const profileEntries = Object.values(rawProfiles);
    const activeId = rawActiveId && rawProfiles[rawActiveId] ? rawActiveId : Object.keys(rawProfiles)[0];
    const active = rawProfiles[activeId] || profileEntries[0];
    const profileData = { ...defaultProfile, ...(active.data || legacyProfile || {}) };
    const kits = [];

    profileEntries.forEach((p) => {
      const resumes = Array.isArray(p.resumes) ? p.resumes : [];
      const covers = Array.isArray(p.coverLetters) ? p.coverLetters : [];
      if (!resumes.length && !covers.length) return;
      if (!resumes.length && covers.length) {
        covers.forEach((cover, idx) => {
          kits.push(normalizeKit({
            id: makeKitId(),
            name: p.name ? `${p.name} — cover ${idx + 1}` : `Cover letter ${kits.length + 1}`,
            resume: null,
            coverLetter: cover,
            workExperience: [],
            isDefault: p.id === activeId && cover.id === p.defaultCoverLetterId,
            createdAt: p.createdAt || now,
            updatedAt: p.updatedAt || now
          }, now));
        });
        return;
      }
      resumes.forEach((resume, idx) => {
        const cover = covers[idx] || (resume.id === p.defaultResumeId && p.defaultCoverLetterId
          ? covers.find((c) => c.id === p.defaultCoverLetterId)
          : null) || null;
        kits.push(normalizeKit({
          id: makeKitId(),
          name: p.name && resumes.length > 1 ? `${p.name} — ${resume.name}` : (p.name || resume.name || `Kit ${kits.length + 1}`),
          resume,
          coverLetter: cover,
          workExperience: [],
          isDefault: p.id === activeId && resume.id === p.defaultResumeId,
          createdAt: p.createdAt || now,
          updatedAt: p.updatedAt || now
        }, now));
      });
    });

    if (!kits.length && profileEntries.length === 1) {
      const p = profileEntries[0];
      kits.push(normalizeKit({
        id: makeKitId(),
        name: p.name || 'Application kit',
        resume: null,
        coverLetter: null,
        workExperience: [],
        isDefault: true,
        createdAt: now,
        updatedAt: now
      }, now));
    }

    if (kits.length && !kits.some((k) => k.isDefault)) {
      const defaultResumeId = active.defaultResumeId;
      const match = kits.find((k) => k.resume && k.resume.id === defaultResumeId);
      (match || kits[0]).isDefault = true;
    }

    return { kits, profileData, didMigrate: true };
  }

  return { kits: [], profileData: null, didMigrate: false };
}

function getKitById(kitId) {
  const kit = applicationKits.find((k) => k.id === kitId) || null;
  if (kit && !Array.isArray(kit.workExperience)) kit.workExperience = [];
  return kit;
}

function syncKitNameFromDom(kitId) {
  const kit = getKitById(kitId);
  if (!kit) return;
  const kitEl = document.querySelector(`.kit-card[data-kit-id="${CSS.escape(kitId)}"]`);
  if (!kitEl) return;
  const nameInput = kitEl.querySelector('.kit-name-input');
  if (nameInput) kit.name = nameInput.value.trim() || kit.name;
}

function getDefaultKit() {
  return applicationKits.find((k) => k.isDefault) || applicationKits[0] || null;
}

function persistProfileData(profile, cb) {
  const payload = { [PROFILE_KEY]: profile };
  if (profile && profile.fullName) payload[USER_NAME_KEY] = profile.fullName;
  chrome.storage.local.set(payload, () => { if (typeof cb === 'function') cb(); });
}

function persistApplicationKits(opts = {}, cb) {
  const payload = { [APPLICATION_KITS_KEY]: applicationKits };
  if (opts.mirror) {
    payload[PROFILE_KEY] = opts.mirror;
    if (opts.mirror.fullName) payload[USER_NAME_KEY] = opts.mirror.fullName;
  }
  chrome.storage.local.set(payload, () => { if (typeof cb === 'function') cb(); });
}

function addApplicationKitFromUI() {
  const name = (window.prompt('Name for this application kit (e.g. Frontend SWE):', 'New application kit') || '').trim();
  if (!name) return;
  const now = new Date().toISOString();
  const kit = normalizeKit({
    id: makeKitId(),
    name,
    resume: null,
    coverLetter: null,
    workExperience: [],
    isDefault: applicationKits.length === 0,
    createdAt: now,
    updatedAt: now
  }, now);
  applicationKits.push(kit);
  expandedKitId = kit.id;
  renderApplicationKits();
  persistApplicationKits({}, () => showStatus(`Created kit "${name}".`, 'success'));
}

function deleteApplicationKit(kitId) {
  const kit = getKitById(kitId);
  if (!kit) return;
  if (!window.confirm(`Delete kit "${kit.name}" and its files? This cannot be undone.`)) return;
  applicationKits = applicationKits.filter((k) => k.id !== kitId);
  if (kit.isDefault && applicationKits.length) applicationKits[0].isDefault = true;
  if (expandedKitId === kitId) expandedKitId = null;
  renderApplicationKits();
  persistApplicationKits({}, () => showStatus('Kit deleted.', 'info', 2500));
}

function setDefaultKit(kitId) {
  const kit = getKitById(kitId);
  if (!kit) return;
  applicationKits.forEach((k) => { k.isDefault = k.id === kitId; });
  kit.updatedAt = new Date().toISOString();
  renderApplicationKits();
  persistApplicationKits({}, () => showStatus(`"${kit.name}" is now the default kit.`, 'success', 2500));
}

function toggleKitExpanded(kitId) {
  expandedKitId = expandedKitId === kitId ? null : kitId;
  renderApplicationKits();
}

function readWorkExperienceFromDom(kitId, { includeEmpty = false } = {}) {
  const kitEl = document.querySelector(`.kit-card[data-kit-id="${CSS.escape(kitId)}"]`);
  if (!kitEl) return null;
  const roles = [];
  kitEl.querySelectorAll('.kit-role').forEach((roleEl) => {
    const titleInput = roleEl.querySelector('.role-title-input');
    const bulletsInput = roleEl.querySelector('.role-bullets-input');
    const role_title = titleInput ? titleInput.value.trim() : '';
    const role_bullets = bulletsInput
      ? bulletsInput.value.split('\n').map((line) => line.trim()).filter(Boolean)
      : [];
    const role = normalizeKitRole({
      role_title,
      role_bullets,
      employer_name: roleEl.querySelector('.role-employer-input')?.value,
      employer_phone: roleEl.querySelector('.role-phone-input')?.value,
      employer_location: roleEl.querySelector('.role-location-input')?.value,
      start_date: roleEl.querySelector('.role-start-input')?.value,
      end_date: roleEl.querySelector('.role-end-input')?.value,
      reason_for_leaving: roleEl.querySelector('.role-reason-input')?.value,
      is_current: roleEl.querySelector('.role-current-input')?.checked
    });
    if (includeEmpty || role.role_title || role.role_bullets.length || role.employer_name) roles.push(role);
  });
  return roles;
}

function syncKitRolesFromDom(kitId) {
  const kit = getKitById(kitId);
  if (!kit) return;
  const roles = readWorkExperienceFromDom(kitId, { includeEmpty: true });
  if (roles) kit.workExperience = roles;
}

function saveKitFromDom(kitId, silent) {
  const kit = getKitById(kitId);
  if (!kit) return;
  const kitEl = document.querySelector(`.kit-card[data-kit-id="${CSS.escape(kitId)}"]`);
  if (kitEl) {
    const nameInput = kitEl.querySelector('.kit-name-input');
    if (nameInput) kit.name = nameInput.value.trim() || kit.name;
    const roles = readWorkExperienceFromDom(kitId);
    if (roles) kit.workExperience = roles;
  }
  kit.updatedAt = new Date().toISOString();
  if (!silent) {
    persistApplicationKits({}, () => showStatus('Kit saved.', 'success', 2000));
  }
}

function addRoleToKit(kitId) {
  syncKitNameFromDom(kitId);
  const kit = getKitById(kitId);
  if (!kit) return;
  syncKitRolesFromDom(kitId);
  kit.workExperience.push(normalizeKitRole({}));
  kit.updatedAt = new Date().toISOString();
  expandedKitId = kitId;
  renderApplicationKits();
  persistApplicationKits();
}

function removeRoleFromKit(kitId, roleIndex) {
  syncKitNameFromDom(kitId);
  syncKitRolesFromDom(kitId);
  const kit = getKitById(kitId);
  if (!kit || !kit.workExperience[roleIndex]) return;
  kit.workExperience.splice(roleIndex, 1);
  kit.updatedAt = new Date().toISOString();
  renderApplicationKits();
  persistApplicationKits();
}

function promptKitFile(kitId, kind) {
  const picker = document.getElementById('kitFilePicker');
  if (!picker) return;
  pendingKitFile = { kitId, kind };
  const accept = kind === 'resume'
    ? '.pdf,.docx,.doc,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : '.pdf,.docx,.doc,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';
  picker.accept = accept;
  picker.click();
}

async function uploadKitFile(kitId, kind, file) {
  const kit = getKitById(kitId);
  if (!kit || !file) return;
  const allowed = kind === 'resume' ? RESUME_ACCEPT_EXT : COVER_LETTER_ACCEPT_EXT;
  if (!isAcceptedFile(file, allowed)) {
    showStatus(`Unsupported file type. Allowed: ${allowed.join(', ')}`, 'error', 4000);
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showStatus('File is over 10 MB.', 'error', 4000);
    return;
  }
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const entry = {
      id: makeFileId(),
      name: file.name,
      type: file.type || '',
      size: file.size,
      dataUrl,
      uploadedAt: new Date().toISOString()
    };
    saveKitFromDom(kitId, true);
    if (kind === 'resume') kit.resume = entry;
    else kit.coverLetter = entry;
    kit.updatedAt = new Date().toISOString();
    expandedKitId = kitId;
    renderApplicationKits();
    persistApplicationKits({}, () => {
      showStatus(`${kind === 'resume' ? 'Resume' : 'Cover letter'} uploaded.`, 'success', 3000);
    });
  } catch (err) {
    showStatus(err.message || 'Upload failed.', 'error', 4000);
  }
}

function removeKitFile(kitId, kind) {
  const kit = getKitById(kitId);
  if (!kit) return;
  const label = kind === 'resume' ? 'resume' : 'cover letter';
  if (!window.confirm(`Remove the ${label} from this kit?`)) return;
  saveKitFromDom(kitId, true);
  if (kind === 'resume') kit.resume = null;
  else kit.coverLetter = null;
  kit.updatedAt = new Date().toISOString();
  renderApplicationKits();
  persistApplicationKits({}, () => showStatus(`${label} removed.`, 'info', 2500));
}

function onKitsContainerClick(event) {
  const btn = event.target.closest('[data-action]');
  if (!btn) {
    const header = event.target.closest('.kit-header');
    if (header && header.dataset.kitId) toggleKitExpanded(header.dataset.kitId);
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const { action, kitId } = btn.dataset;
  if (!kitId) return;
  if (action === 'toggle') toggleKitExpanded(kitId);
  else if (action === 'default') setDefaultKit(kitId);
  else if (action === 'delete-kit') deleteApplicationKit(kitId);
  else if (action === 'save-kit') saveKitFromDom(kitId, false);
  else if (action === 'upload-resume') promptKitFile(kitId, 'resume');
  else if (action === 'upload-cover') promptKitFile(kitId, 'coverLetter');
  else if (action === 'remove-resume') removeKitFile(kitId, 'resume');
  else if (action === 'remove-cover') removeKitFile(kitId, 'coverLetter');
  else if (action === 'add-role') addRoleToKit(kitId);
  else if (action === 'remove-role') removeRoleFromKit(kitId, Number(btn.dataset.roleIndex));
  else if (action === 'download-resume' || action === 'download-cover') {
    const kit = getKitById(kitId);
    const entry = action === 'download-resume' ? kit?.resume : kit?.coverLetter;
    if (entry) downloadUploadedFile(entry);
  }
}

function onKitsContainerInput(event) {
  const input = event.target;
  if (!input.closest('.kit-card')) return;
  if (input.classList.contains('kit-name-input')
    || input.classList.contains('role-title-input')
    || input.classList.contains('role-bullets-input')) {
    // Debounced auto-save could go here; user clicks Save kit for now.
  }
}

function renderKitFileSlot(label, file, kind, kitId) {
  if (!file) {
    const action = kind === 'resume' ? 'upload-resume' : 'upload-cover';
    return `
      <div class="kit-file-slot empty">
        <span class="kit-file-label">${escapeHtml(label)}</span>
        <button class="btn small" type="button" data-action="${action}" data-kit-id="${escapeHtml(kitId)}">Upload</button>
      </div>
    `;
  }
  const ext = fileExtensionOf(file.name);
  const downloadAction = kind === 'resume' ? 'download-resume' : 'download-cover';
  const removeAction = kind === 'resume' ? 'remove-resume' : 'remove-cover';
  const uploadAction = kind === 'resume' ? 'upload-resume' : 'upload-cover';
  return `
    <div class="kit-file-slot">
      <div class="file-icon">${escapeHtml(fileBadge(ext))}</div>
      <div class="file-meta">
        <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(label)}: ${escapeHtml(file.name)}</div>
        <div class="file-sub">${escapeHtml(humanFileSize(file.size))}</div>
      </div>
      <div class="file-actions">
        <button class="btn small icon" type="button" data-action="${downloadAction}" data-kit-id="${escapeHtml(kitId)}" title="Download">↓</button>
        <button class="btn small" type="button" data-action="${uploadAction}" data-kit-id="${escapeHtml(kitId)}">Replace</button>
        <button class="btn small icon danger" type="button" data-action="${removeAction}" data-kit-id="${escapeHtml(kitId)}" title="Remove">✕</button>
      </div>
    </div>
  `;
}

function renderKitRoles(kit) {
  const roles = kit.workExperience || [];
  if (!roles.length) {
    return '<p class="hint-text">No roles yet. Add work experience that matches this resume.</p>';
  }
  return roles.map((role, index) => `
    <div class="kit-role" data-role-index="${index}">
      <label class="full">
        Role title
        <input class="role-title-input" type="text" value="${escapeHtml(role.role_title)}" placeholder="e.g. Senior Software Engineer — Acme Corp">
      </label>
      <div class="kit-role-details">
        <label>Employer <input class="role-employer-input" type="text" value="${escapeHtml(role.employer_name || '')}" placeholder="Company name"></label>
        <label>Start <input class="role-start-input" type="text" value="${escapeHtml(role.start_date || '')}" placeholder="MM/YYYY"></label>
        <label>End <input class="role-end-input" type="text" value="${escapeHtml(role.end_date || '')}" placeholder="MM/YYYY or Present"></label>
        <label class="kit-role-check"><input class="role-current-input" type="checkbox"${role.is_current ? ' checked' : ''}> Current role</label>
      </div>
      <label class="full">
        Location / phone <span class="muted small">(optional)</span>
        <input class="role-location-input" type="text" value="${escapeHtml(role.employer_location || '')}" placeholder="City, State">
        <input class="role-phone-input" type="text" value="${escapeHtml(role.employer_phone || '')}" placeholder="Employer phone">
      </label>
      <label class="full">
        Bullets <span class="muted small">(one per line — used for “responsibilities” on Lever employment cards)</span>
        <textarea class="role-bullets-input" rows="4" placeholder="Led migration to React…&#10;Reduced API latency by 40%…">${escapeHtml((role.role_bullets || []).join('\n'))}</textarea>
      </label>
      <label class="full">
        Reason for leaving
        <input class="role-reason-input" type="text" value="${escapeHtml(role.reason_for_leaving || '')}" placeholder="N/A if still employed">
      </label>
      <button class="btn small danger" type="button" data-action="remove-role" data-kit-id="${escapeHtml(kit.id)}" data-role-index="${index}">Remove role</button>
    </div>
  `).join('');
}

function renderApplicationKits() {
  const container = document.getElementById('kitsContainer');
  if (!container) return;

  if (!applicationKits.length) {
    container.className = 'kits-list empty';
    container.textContent = 'No application kits yet. Add one to upload a resume and optional cover letter.';
    return;
  }

  container.className = 'kits-list';
  container.innerHTML = applicationKits.map((kit) => {
    const expanded = expandedKitId === kit.id;
    const resumeLabel = kit.resume ? kit.resume.name : 'No resume';
    const coverLabel = kit.coverLetter ? kit.coverLetter.name : 'No cover letter';
    const roleCount = (kit.workExperience || []).length;
    return `
      <article class="kit-card ${kit.isDefault ? 'is-default' : ''} ${expanded ? 'is-expanded' : ''}" data-kit-id="${escapeHtml(kit.id)}">
        <header class="kit-header" data-kit-id="${escapeHtml(kit.id)}" role="button" tabindex="0" title="Expand or collapse">
          <div class="kit-header-main">
            <div class="kit-title-row">
              <span class="kit-chevron">${expanded ? '▼' : '▶'}</span>
              <strong class="kit-summary-name">${escapeHtml(kit.name)}</strong>
              ${kit.isDefault ? '<span class="default-pill">Default</span>' : ''}
            </div>
            <div class="kit-summary-meta muted small">${escapeHtml(resumeLabel)} · ${escapeHtml(coverLabel)}${roleCount ? ` · ${roleCount} role${roleCount === 1 ? '' : 's'}` : ''}</div>
          </div>
          <button class="btn small icon" type="button" data-action="toggle" data-kit-id="${escapeHtml(kit.id)}" title="${expanded ? 'Collapse' : 'Expand'}">${expanded ? '−' : '+'}</button>
        </header>
        <div class="kit-body ${expanded ? '' : 'hidden'}">
          <label class="full">
            Kit name
            <input class="kit-name-input" type="text" value="${escapeHtml(kit.name)}" placeholder="e.g. Frontend SWE">
          </label>
          ${renderKitFileSlot('Resume', kit.resume, 'resume', kit.id)}
          ${renderKitFileSlot('Cover letter', kit.coverLetter, 'coverLetter', kit.id)}
          <div class="kit-work-section">
            <div class="kit-section-head">
              <h3>Work experience</h3>
              <button class="btn small" type="button" data-action="add-role" data-kit-id="${escapeHtml(kit.id)}">+ Add role</button>
            </div>
            <div class="kit-roles">${renderKitRoles(kit)}</div>
          </div>
          <div class="button-row wrap kit-actions">
            ${kit.isDefault ? '' : `<button class="btn small" type="button" data-action="default" data-kit-id="${escapeHtml(kit.id)}">★ Set default</button>`}
            <button class="btn small primary" type="button" data-action="save-kit" data-kit-id="${escapeHtml(kit.id)}">Save kit</button>
            <button class="btn small danger" type="button" data-action="delete-kit" data-kit-id="${escapeHtml(kit.id)}">Delete kit</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function fileExtensionOf(name) {
  const m = String(name || '').match(/\.[a-z0-9]+$/i);
  return m ? m[0].toLowerCase() : '';
}

function isAcceptedFile(file, allowedExts) {
  const ext = fileExtensionOf(file.name);
  return allowedExts.includes(ext);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('File read failed.'));
    reader.readAsDataURL(file);
  });
}

function humanFileSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function fileBadge(ext) {
  return (ext || '').replace('.', '').toUpperCase() || 'FILE';
}

function downloadUploadedFile(entry) {
  if (!entry || !entry.dataUrl) return;
  const a = document.createElement('a');
  a.href = entry.dataUrl;
  a.download = entry.name || 'file';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function scrapeJobInfoToAllForms({ showSuccess = true } = {}) {
  const { response, tab } = await sendToActiveTab({ action: 'getJobFields' });
  if (!response?.success && !response?.job_title && !response?.company_name) {
    throw new Error(response?.error || 'Could not read job info from this page.');
  }

  const jobTitle = response.job_title || '';
  const company = response.company_name || '';
  const jobLink = response.job_link || tab.url || '';
  const jobDescription = response.job_description || '';
  const preferResumeJson = Boolean(
    window.SmartJobRegisterResumeDb?.hasActiveResumeJsonOverride?.()
  );

  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };

  setValue('jobCompany', company);
  setValue('jobTitle', jobTitle);
  setValue('jobLink', jobLink);

  // Job link always comes from the tab. Title/company/note prefer built resume JSON when active.
  setValue('regJobLink', jobLink);
  if (!preferResumeJson) {
    setValue('regJobTitle', jobTitle);
    setValue('regCompany', company);
    setValue('regNote', jobDescription);
  }

  const urlEl = document.getElementById('currentUrl');
  if (urlEl) urlEl.textContent = jobLink;

  const regStatus = document.getElementById('registerStatus');
  if (regStatus) {
    regStatus.textContent = preferResumeJson
      ? 'Job link refreshed from tab. Title/company/note kept from resume JSON.'
      : 'Job info loaded from current tab.';
    regStatus.className = 'register-status is-success';
    regStatus.hidden = false;
  }

  window.SmartJobTabSession?.sync();

  if (showSuccess) {
    showStatus(
      preferResumeJson
        ? 'Job link refreshed. Register title/company/note kept from resume JSON.'
        : 'Job info refreshed from current tab.',
      'success'
    );
  }
  return { jobTitle, company, jobLink };
}

async function scrapeCurrentJob(showSuccess = true) {
  try {
    await scrapeJobInfoToAllForms({ showSuccess });
  } catch (error) {
    const msg = error.message || String(error);
    const friendly = /receiving end does not exist/i.test(msg)
      ? 'Cannot read this tab. Reload the job page, then use Refresh in the header.'
      : msg;
    if (showSuccess) showStatus(friendly, 'error');
  }
}

async function globalRefreshCurrentTab() {
  const btn = document.getElementById('globalRefreshBtn');
  if (btn?.disabled) return;

  try {
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-spinning');
    }
    showStatus('Refreshing current tab…', 'info', 0);

    const tab = await getActiveTab();
    if (!tab?.url || !/^https?:\/\//.test(tab.url)) {
      throw new Error('Open a normal web page first.');
    }

    // Refresh is the only thing that re-binds a tab. Landing on a different
    // page means a different job, so the previous draft must not carry over.
    const TS = window.SmartJobTabSession;
    TS?.captureActive();
    if (TS?.isPinnedElsewhere(tab.id, tab.url)) {
      if (TS.hasWork(tab.id)) {
        const proceed = window.confirm(
          'This tab has moved to a different page.\n\n' +
            'Refreshing will clear the resume JSON and generated files saved for the previous job. Continue?'
        );
        if (!proceed) {
          showStatus('Refresh cancelled — previous job draft kept.', 'info', 3000);
          return;
        }
      }
      TS.resetSession(tab.id);
    }
    TS?.bindUrl(tab.id, tab.url);
    renderPinnedJobBar(tab.id, tab.url);

    try {
      await sendToActiveTab({ action: 'prepareForScan' });
    } catch (_) {
      // optional scroll-to-top before scan
    }

    await scrapeJobInfoToAllForms({ showSuccess: false });
    await scanCurrentPage({ silent: true });

    const fieldCount = currentFields.length;
    const adapter = lastAdapterDebug?.adapter;
    const adapterNote = adapter ? ` · ${adapter}` : '';
    showStatus(
      `Refreshed · ${fieldCount} field${fieldCount === 1 ? '' : 's'} detected${adapterNote}.`,
      'success',
      3500
    );
  } catch (error) {
    const msg = error.message || String(error);
    const friendly = /receiving end does not exist/i.test(msg)
      ? 'Cannot refresh this tab. Reload the page, then try again.'
      : msg;
    showStatus(friendly, 'error');
    const regStatus = document.getElementById('registerStatus');
    if (regStatus) {
      regStatus.textContent = friendly;
      regStatus.className = 'register-status is-error';
      regStatus.hidden = false;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('is-spinning');
    }
  }
}

function currentHost() {
  try {
    const u = currentScanUrl ? new URL(currentScanUrl) : null;
    return u ? u.hostname : '';
  } catch (_) { return ''; }
}

function fieldDismissalKey(field) {
  if (!field) return '';
  const sig = field.signature || {};
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
  return [
    sig.tagName || field.tagName || '',
    sig.inputType || field.inputType || '',
    norm(sig.idAttr || field.idAttr),
    norm(sig.name || field.name),
    norm(sig.ariaLabel || field.ariaLabel),
    norm(field.questionText || field.labelText || field.placeholder)
  ].join('|');
}

function isFieldDismissed(field, host) {
  const h = host || currentHost();
  if (!h) return false;
  const list = dismissedFieldsByHost[h];
  if (!Array.isArray(list) || !list.length) return false;
  return list.includes(fieldDismissalKey(field));
}

function persistDismissed(cb) {
  chrome.storage.local.set({ [DISMISSED_FIELDS_KEY]: dismissedFieldsByHost }, () => {
    if (typeof cb === 'function') cb();
  });
}

function dismissField(index) {
  const row = currentPlan[index];
  if (!row) return;
  const host = currentHost();
  if (!host) {
    showStatus('Cannot dismiss field: scan URL unknown.', 'error');
    return;
  }
  const key = fieldDismissalKey(row.field);
  if (!key) return;

  const list = Array.isArray(dismissedFieldsByHost[host]) ? dismissedFieldsByHost[host].slice() : [];
  if (!list.includes(key)) list.push(key);
  dismissedFieldsByHost[host] = list;

  const fieldId = row.field.id;
  currentPlan = currentPlan.filter((r) => r.field.id !== fieldId);
  currentFields = currentFields.filter((f) => f.id !== fieldId);
  lastDismissedCount += 1;

  persistDismissed(() => {
    saveScanState();
    renderFieldPlan();
    showStatus('Field hidden. Use "Restore dismissed" to bring it back.', 'info', 3000);
  });
}

function renderAdapterDebug(debug) {
  lastAdapterDebug = debug || null;
  const panel = document.getElementById('adapterDebugPanel');
  const summary = document.getElementById('adapterDebugSummary');
  if (!panel) return;

  if (!debug || !debug.adapter) {
    panel.className = 'adapter-debug-panel empty';
    panel.textContent = 'Run autofill or refresh detection to see adapter scores.';
    if (summary) summary.textContent = 'Not scanned';
    return;
  }

  const threshold = Number.isFinite(debug.adapterThreshold) ? debug.adapterThreshold : 25;
  const activeScore = Number.isFinite(debug.adapterScore) ? debug.adapterScore : 0;
  const rankings = Array.isArray(debug.adapterRankings) ? debug.adapterRankings : [];
  const scanRoot = debug.scanRoot || 'document';
  const scoped = Boolean(debug.scopedScan);
  const skippedOutside = Number(debug.skippedOutsideRoot) || 0;
  const fieldCount = Number.isFinite(debug.fieldCount) ? debug.fieldCount : null;

  if (summary) {
    summary.textContent = `${debug.adapter} (${activeScore})`;
  }

  panel.className = 'adapter-debug-panel';
  const rows = rankings.map((row) => {
    const score = Number(row.score) || 0;
    const isActive = row.name === debug.adapter;
    const met = score >= threshold;
    return `
      <tr class="${isActive ? 'is-active' : ''}">
        <td>${escapeHtml(row.name)}${isActive ? ' <span class="default-pill">active</span>' : ''}</td>
        <td class="mono">${score}</td>
        <td>${met ? 'yes' : 'no'}</td>
      </tr>
    `;
  }).join('');

  const stats = [];
  if (fieldCount != null) stats.push(`<li><strong>Fields detected:</strong> ${fieldCount}</li>`);
  if (Number.isFinite(debug.skipped)) stats.push(`<li><strong>Noisy fields skipped:</strong> ${debug.skipped}</li>`);
  if (skippedOutside) stats.push(`<li><strong>Outside scan root:</strong> ${skippedOutside}</li>`);

  panel.innerHTML = `
    <dl class="adapter-debug-meta">
      <div><dt>Active adapter</dt><dd><strong>${escapeHtml(debug.adapter)}</strong> (score ${activeScore}, threshold ${threshold})</dd></div>
      <div><dt>Scan root</dt><dd><code>${escapeHtml(scanRoot)}</code>${scoped ? ' <span class="muted">(scoped)</span>' : ' <span class="muted">(full page)</span>'}</dd></div>
    </dl>
    ${stats.length ? `<ul class="adapter-debug-stats">${stats.join('')}</ul>` : ''}
    <table class="adapter-score-table">
      <thead><tr><th>Adapter</th><th>Score</th><th>≥ threshold</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3">No rankings</td></tr>'}</tbody>
    </table>
  `;
}

async function refreshAdapterDebug() {
  try {
    showStatus('Detecting ATS adapter...', 'info', 0);
    const { response } = await sendToActiveTab({ action: 'getAdapterDebug' });
    if (!response || !response.success) throw new Error(response?.error || 'Detection failed.');
    renderAdapterDebug(response);
    showStatus(`Adapter: ${response.adapter} (score ${response.adapterScore}).`, 'success', 3000);
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

function restoreDismissedForHost() {
  const host = currentHost();
  if (!host) return;
  const list = dismissedFieldsByHost[host];
  if (!list || !list.length) {
    showStatus('Nothing to restore on this host.', 'info', 2500);
    return;
  }
  if (!window.confirm(`Restore ${list.length} dismissed field${list.length === 1 ? '' : 's'} for ${host}? You'll need to rescan to see them again.`)) return;
  delete dismissedFieldsByHost[host];
  lastDismissedCount = 0;
  persistDismissed(() => {
    showStatus('Dismissed list cleared. Click "Autofill this page" to rescan.', 'success', 4500);
    updateFieldsFilterMeta(currentPlan.length, 0);
  });
}

async function scanCurrentPage({ silent = false } = {}) {
  try {
    if (!silent) showStatus('Scanning current page...', 'info', 0);
    const { response, tab } = await sendToActiveTab({ action: 'scanApplicationForm' });
    if (!response || !response.success) throw new Error(response?.error || 'Scan failed.');

    currentScanUrl = response.url || tab.url || '';
    lastSkippedCount = Number.isFinite(response.skipped) ? response.skipped : 0;

    const rawFields = response.fields || [];
    const host = currentHost();
    const dismissed = [];
    const kept = [];
    for (const f of rawFields) {
      if (isFieldDismissed(f, host)) dismissed.push(f);
      else kept.push(f);
    }
    currentFields = kept;
    lastDismissedCount = dismissed.length;
    clearFieldsSearch();

    const urlEl = document.getElementById('currentUrl');
    if (urlEl) urlEl.textContent = currentScanUrl;
    const detectedCount = document.getElementById('detectedCount');
    if (detectedCount) detectedCount.textContent = currentFields.length;
    renderAdapterDebug({
      adapter: response.adapter,
      adapterScore: response.adapterScore,
      adapterRankings: response.adapterRankings,
      adapterThreshold: response.adapterThreshold,
      scanRoot: response.scanRoot,
      scopedScan: response.scopedScan,
      skipped: response.skipped,
      skippedOutsideRoot: response.skippedOutsideRoot,
      fieldCount: currentFields.length
    });
    regeneratePlan();
    openPreviewSection();
    if (!silent) {
      const adapterInfo = response.adapter ? ` (${response.adapter} adapter)` : '';
      const noiseInfo = lastSkippedCount > 0
        ? ` (${lastSkippedCount} noisy field${lastSkippedCount === 1 ? '' : 's'} hidden)`
        : '';
      const dismissedInfo = lastDismissedCount > 0
        ? ` (${lastDismissedCount} dismissed by you)`
        : '';
      showStatus(`Scan complete. Found ${currentFields.length} fields${adapterInfo}${noiseInfo}${dismissedInfo}.`, 'success');
    }
    return response;
  } catch (error) {
    if (!silent) showStatus(error.message, 'error');
    throw error;
  }
}

async function autofillThisPage({ useAi = false } = {}) {
  const fillBtn = document.getElementById(useAi ? 'fillSelectedAiBtn' : 'regAutofillBtn')
    || document.getElementById(useAi ? 'fillSelectedAiBtn' : 'fillSelectedBtn');
  const otherBtn = document.getElementById(useAi ? 'regAutofillBtn' : 'fillSelectedAiBtn')
    || document.getElementById(useAi ? 'fillSelectedBtn' : 'fillSelectedAiBtn');
  if (fillBtn) {
    fillBtn.disabled = true;
    fillBtn.classList.add('is-loading');
    const spinner = fillBtn.querySelector('.rb-spinner');
    if (spinner) spinner.hidden = false;
  }
  if (otherBtn) otherBtn.disabled = true;
  if (useAi && !requireOpenAiApiKey('Add your OpenAI API key in Settings before using Autofill with AI.')) {
    if (fillBtn) {
      fillBtn.disabled = false;
      fillBtn.classList.remove('is-loading');
      const spinner = fillBtn.querySelector('.rb-spinner');
      if (spinner) spinner.hidden = true;
    }
    if (otherBtn) otherBtn.disabled = false;
    return;
  }
  try {
    const loaded = await loadWebsiteProfileForAutofill();
    if (!loaded) return;

    showStatus('Scrolling to top to detect all fields...', 'info', 0);
    try {
      await sendToActiveTab({ action: 'prepareForScan' });
    } catch (_) {
      // Non-critical: continue even if scroll prep fails (e.g. tab can't be reached)
    }

    showStatus('Scanning application fields...', 'info', 0);
    const scanResponse = await scanCurrentPage({ silent: true });
    const adapterInfo = scanResponse && scanResponse.adapter ? ` (${scanResponse.adapter} adapter)` : '';
    const skippedInfo = lastSkippedCount > 0
      ? ` (${lastSkippedCount} noisy field${lastSkippedCount === 1 ? '' : 's'} hidden)`
      : '';

    if (!currentFields.length) {
      showStatus(`No application fields detected on this page${adapterInfo}${skippedInfo}.`, 'error', 5000);
      return;
    }

    if (useAi) {
      await fillSelectedFieldsWithAi();
      return;
    }

    const fillable = currentPlan.filter(isRowFillable);
    if (!fillable.length) {
      showStatus(`Detected ${currentFields.length} field${currentFields.length === 1 ? '' : 's'}${adapterInfo}${skippedInfo}, but none have suggested values yet. Add values below and click again.`, 'info', 7000);
      return;
    }

    await fillSelectedFields({ useAi: false });
  } catch (error) {
    showStatus(error.message || String(error), 'error');
  } finally {
    if (fillBtn) {
      fillBtn.classList.remove('is-loading');
      const spinner = fillBtn.querySelector('.rb-spinner');
      if (spinner) spinner.hidden = true;
    }
    if (otherBtn) otherBtn.disabled = false;
    window.SmartJobRegisterResumeDb?.syncResumeBuilderActionButtons?.();
    updateReadyCountHint();
  }
}

function regeneratePlan() {
  if (!Array.isArray(currentFields)) currentFields = [];
  currentPlan = currentFields.map((field) => createPlanRow(field));
  invalidateAiContextCache();
  renderFieldPlan();
  saveScanState();
}

function createPlanRow(field) {
  const category = field.fieldCategory || 'unknown';
  const profileKey = categoryToProfileKey[category];
  const profileValue = profileKey ? (currentProfile[profileKey] || '') : '';

  if (category === 'acknowledgment') {
    const ackValue = (field.options && field.options[0]) || 'I have read this';
    return {
      field,
      suggestedValue: ackValue,
      source: 'acknowledgment',
      status: 'Ready — acknowledgment',
      fillOutcome: null,
      fillError: '',
      confidence: field.confidence || 0.96,
      customQuestionId: ''
    };
  }

  if (category === 'employment_kit') {
    const kit = getDefaultKit();
    const slot = typeof field.employmentSlot === 'number' ? field.employmentSlot : 0;
    const role = kit?.workExperience?.[slot];
    const value = getEmploymentKitValue(role, field.employmentKey, currentProfile);
    const roleNum = slot + 1;
    if (value) {
      return {
        field,
        suggestedValue: value,
        source: 'kit',
        status: `Ready — employment role ${roleNum} (default kit)`,
        fillOutcome: null,
        fillError: '',
        confidence: field.confidence || 0.92,
        customQuestionId: ''
      };
    }
    const fallback = field.employmentKey === 'reason_for_leaving' ? 'N/A' : '';
    return {
      field,
      suggestedValue: fallback,
      source: kit?.workExperience?.length ? 'kit' : 'manual',
      status: kit?.workExperience?.length
        ? `Add role ${roleNum} details in Application kits`
        : 'Add work experience roles in Application kits',
      fillOutcome: null,
      fillError: '',
      confidence: field.confidence || 0.5,
      customQuestionId: ''
    };
  }

  if (field.voluntary) {
    if (profileValue) {
      return {
        field,
        suggestedValue: profileValue,
        source: 'profile',
        status: 'Ready — demographic default (profile)',
        fillOutcome: null,
        fillError: '',
        confidence: field.confidence || 0.9,
        customQuestionId: ''
      };
    }
    return {
      field,
      suggestedValue: '',
      source: 'voluntary',
      status: 'Optional section — add answer manually',
      fillOutcome: null,
      fillError: '',
      confidence: field.confidence || 0,
      customQuestionId: ''
    };
  }

  if (PROFILE_LINK_CATEGORIES.has(category)) {
    if (isUsableProfileLinkValue(profileValue)) {
      return {
        field,
        suggestedValue: String(profileValue).trim(),
        source: 'profile',
        status: 'Ready',
        fillOutcome: null,
        fillError: '',
        confidence: field.confidence || 0.9,
        customQuestionId: ''
      };
    }
    return {
      field,
      suggestedValue: '',
      source: 'missing',
      status: 'Missing value — add in Profile → Links',
      fillOutcome: null,
      fillError: '',
      confidence: field.confidence || 0,
      customQuestionId: ''
    };
  }

  if (category === 'resume_upload' || category === 'cover_letter_upload') {
    const uploadFile = getKitUploadForCategory(category);
    if (uploadFile) {
      const label = category === 'resume_upload' ? 'Resume' : 'Cover letter';
      return {
        field,
        suggestedValue: uploadFile.name,
        source: 'kit',
        status: `Ready — ${label} from default kit`,
        fillOutcome: null,
        fillError: '',
        confidence: field.confidence || 0.95,
        customQuestionId: '',
        uploadFile
      };
    }
    if (field.optional) {
      return {
        field,
        suggestedValue: '',
        source: 'optional',
        status: category === 'resume_upload'
          ? 'Optional — add a resume in Application kits to autofill'
          : 'Optional — add a cover letter in Application kits to autofill',
        fillOutcome: null,
        fillError: '',
        confidence: field.confidence || 0,
        customQuestionId: ''
      };
    }
    return {
      field,
      suggestedValue: '',
      source: 'manual',
      status: category === 'resume_upload'
        ? 'Upload a resume in Profile → Application kits (default kit)'
        : 'Upload a cover letter in Profile → Application kits (default kit)',
      fillOutcome: null,
      fillError: '',
      confidence: field.confidence || 0,
      customQuestionId: ''
    };
  }

  if (field.optional && !profileValue) {
    return {
      field,
      suggestedValue: '',
      source: 'optional',
      status: 'Optional on this form — add to profile or skip',
      fillOutcome: null,
      fillError: '',
      confidence: field.confidence || 0,
      customQuestionId: ''
    };
  }

  if (profileValue) {
    return {
      field,
      suggestedValue: profileValue,
      source: 'profile',
      status: 'Ready',
      fillOutcome: null,
      fillError: '',
      confidence: field.confidence || 0.8,
      customQuestionId: ''
    };
  }

  const adapterDefault = String(field.suggestedDefault || '').trim();
  if (adapterDefault) {
    return {
      field,
      suggestedValue: adapterDefault,
      source: 'suggested',
      status: category === 'custom_question'
        ? 'Suggested answer — verify before submit'
        : 'Suggested default — verify before submit',
      fillOutcome: null,
      fillError: '',
      confidence: field.confidence || 0.85,
      customQuestionId: ''
    };
  }

  const customMatch = matchCustomQuestion(field.questionText || field.labelText || field.nearbyText || '', currentQuestions);
  if (customMatch) {
    return {
      field,
      suggestedValue: customMatch.question.answer || '',
      source: 'custom',
      status: customMatch.question.requireReview ? 'Needs review' : 'Ready',
      fillOutcome: null,
      fillError: '',
      confidence: customMatch.confidence,
      customQuestionId: customMatch.question.id
    };
  }

  return {
    field,
    suggestedValue: '',
    source: category === 'custom_question' ? 'missing custom answer' : 'missing',
    status: category === 'custom_question' ? 'Needs custom answer' : 'Missing value',
    fillOutcome: null,
    fillError: '',
    confidence: field.confidence || 0,
    customQuestionId: ''
  };
}

function matchCustomQuestion(questionText, bank) {
  let best = null;
  for (const item of bank || []) {
    const patterns = Array.isArray(item.questionPatterns) ? item.questionPatterns : [];
    for (const pattern of patterns) {
      const score = tokenSimilarity(questionText, pattern);
      if (!best || score > best.confidence) best = { question: item, confidence: score, pattern };
    }
    if (item.title) {
      const score = tokenSimilarity(questionText, item.title);
      if (!best || score > best.confidence) best = { question: item, confidence: score, pattern: item.title };
    }
  }
  const threshold = currentSettings.customQuestionMatchThreshold ?? defaultSettings.customQuestionMatchThreshold;
  return best && best.confidence >= threshold ? best : null;
}

function isRowFillable(row) {
  if (!row || row.source === 'voluntary') return false;
  if (row.source === 'optional' || row.source === 'manual') return false;
  if (row.source === 'acknowledgment') return Boolean(row.suggestedValue);
  if (row.uploadFile && row.uploadFile.dataUrl) return true;
  return Boolean(row.suggestedValue);
}

function getRowStatusClasses(row) {
  const classes = ['field-row'];
  if (row.fillOutcome === 'filled') classes.push('status-filled');
  else if (row.fillOutcome === 'failed') classes.push('status-failed');
  else if (row.fillOutcome === 'skipped') classes.push('status-skipped');
  else if (row.source === 'voluntary' || row.source === 'optional') classes.push('status-optional');
  else if (isRowFillable(row)) classes.push('status-ready', 'has-value');
  else classes.push('status-missing', 'missing');
  return classes;
}

function getRowStatusTone(row) {
  if (row.fillOutcome) return row.fillOutcome;
  if (row.source === 'voluntary' || row.source === 'optional') return 'optional';
  return isRowFillable(row) ? 'ready' : 'missing';
}

function getRowStatusDisplay(row) {
  if (row.fillOutcome === 'filled') return 'Filled';
  if (row.fillOutcome === 'failed') return 'Failed';
  if (row.fillOutcome === 'skipped') return 'Skipped';
  return row.status || '';
}

function applyFillResultToPlanRow(row, result, { usedAi = false } = {}) {
  if (result && result.success) {
    row.fillOutcome = 'filled';
    row.fillError = '';
    row.status = usedAi || row.source === 'ai' ? 'Filled (AI)' : 'Filled';
  } else {
    row.fillOutcome = 'failed';
    row.fillError = (result && result.error) ? String(result.error) : 'Fill failed';
    row.status = 'Failed';
  }
}

function isAiBlockedField(row) {
  if (!row || !row.field) return true;
  const cat = row.field.fieldCategory;
  const type = row.field.fieldType;
  if (cat === 'resume_upload' || cat === 'cover_letter_upload' || type === 'file') {
    return !(row.uploadFile && row.uploadFile.dataUrl);
  }
  return false;
}

function renderSaveAnswerButtonHtml(row) {
  const saved = Boolean(row.customQuestionId);
  const label = saved ? 'Saved' : 'Save';
  const title = saved ? 'Saved to question bank — click to update' : 'Save answer to question bank';
  return `<button class="btn small save-as-question${saved ? ' saved' : ''}" type="button" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><span class="btn-icon">${SAVE_ANSWER_ICON}</span><span class="save-answer-label">${label}</span></button>`;
}

function renderFillButtonsHtml(row) {
  const fillable = isRowFillable(row);
  const aiDisabled = isAiFillButtonDisabled(row);
  const aiTitle = escapeHtml(getAiFillButtonTitle(row));
  const aiNeedsKey = isAiToggleEnabled() && !getOpenAiApiKey();
  const regular = `<button class="btn small primary fill-one" type="button" ${fillable ? '' : 'disabled'} title="Fill using profile, kits, and saved answers">Fill</button>`;
  const ai = `<button class="btn small fill-ai${aiNeedsKey ? ' fill-ai-needs-key' : ''}" type="button" ${aiDisabled ? 'disabled' : ''} title="${aiTitle}" aria-disabled="${aiDisabled ? 'true' : 'false'}">
    <span class="btn-icon">${AI_MAGIC_ICON}</span>
    <span class="fill-ai-label">Fill</span>
  </button>`;
  return `<div class="fill-btn-group">${regular}${ai}</div>`;
}

async function getJobContextForAi() {
  try {
    const { response } = await sendToActiveTab({ action: 'getJobFields' });
    if (response && response.success) {
      return {
        job_title: response.job_title || '',
        company_name: response.company_name || '',
        job_description: response.job_description || ''
      };
    }
  } catch (_) {}
  return {};
}

let cachedAiContextBlock = null;
let cachedAiContextAt = 0;

async function getAiContextBlock() {
  const now = Date.now();
  if (cachedAiContextBlock && now - cachedAiContextAt < 60000) return cachedAiContextBlock;
  const jobInfo = await getJobContextForAi();
  const kit = getDefaultKit();
  if (!window.SmartJobAiFill) throw new Error('AI module failed to load. Reload the extension.');
  cachedAiContextBlock = window.SmartJobAiFill.buildCandidateContext(
    currentProfile,
    currentQuestions,
    kit,
    jobInfo
  );
  cachedAiContextAt = now;
  return cachedAiContextBlock;
}

function invalidateAiContextCache() {
  cachedAiContextBlock = null;
  cachedAiContextAt = 0;
}

async function generateAiValueForRow(row) {
  const apiKey = getOpenAiApiKey() || String(document.getElementById('openaiApiKeySetting')?.value || '').trim();
  if (!apiKey) {
    throw new Error('OpenAI API key is not set.');
  }
  if (isAiBlockedField(row)) {
    throw new Error('Upload the file in Profile → Application kits, then use regular Fill.');
  }
  const contextBlock = await getAiContextBlock();
  const value = await window.SmartJobAiFill.suggestFieldValue(
    apiKey,
    currentSettings.openaiModel,
    row.field,
    row,
    contextBlock
  );
  if (!value) throw new Error('AI returned an empty value for this field.');
  return value;
}

function applyAiValueToRow(row, value, rowEl) {
  row.suggestedValue = value;
  row.source = 'ai';
  row.status = 'Ready (AI)';
  row.fillOutcome = null;
  row.fillError = '';
  const textarea = rowEl?.querySelector('.suggested-value');
  if (textarea) textarea.value = value;
  updateFieldRowAppearance(rowEl, row);
}

function syncRowStatusClasses(rowEl, row) {
  if (!rowEl || !row) return;
  const tokens = [
    'status-filled', 'status-failed', 'status-skipped', 'status-ready',
    'status-missing', 'status-optional', 'has-value', 'missing', 'row-filled'
  ];
  rowEl.classList.remove(...tokens);
  getRowStatusClasses(row).forEach((token) => {
    if (token !== 'field-row') rowEl.classList.add(token);
  });
}

function updateFieldRowAppearance(rowEl, row) {
  if (!rowEl || !row) return;
  syncRowStatusClasses(rowEl, row);
  const label = rowEl.querySelector('.status-label');
  if (label) {
    label.textContent = getRowStatusDisplay(row);
    label.className = `status-label tone-${getRowStatusTone(row)}`;
    if (row.fillOutcome === 'failed' && row.fillError) {
      label.title = row.fillError;
    } else {
      label.removeAttribute('title');
    }
  }
  const fillBtn = rowEl.querySelector('.fill-one');
  if (fillBtn) {
    if (row.fillOutcome === 'filled') {
      fillBtn.textContent = 'Filled ✓';
      fillBtn.classList.add('done');
      fillBtn.disabled = false;
    } else {
      fillBtn.textContent = 'Fill';
      fillBtn.classList.remove('done');
      fillBtn.disabled = !isRowFillable(row);
    }
  }
  const aiBtn = rowEl.querySelector('.fill-ai');
  if (aiBtn) {
    if (row.fillOutcome === 'filled' && row.source === 'ai') {
      aiBtn.classList.add('done');
      const aiLabel = aiBtn.querySelector('.fill-ai-label');
      if (aiLabel) aiLabel.textContent = 'Filled ✓';
      aiBtn.disabled = false;
      aiBtn.setAttribute('aria-disabled', 'false');
    } else {
      aiBtn.classList.remove('done');
      const label = aiBtn.querySelector('.fill-ai-label');
      if (label) label.textContent = 'Fill';
      const aiDisabled = isAiFillButtonDisabled(row);
      aiBtn.disabled = aiDisabled;
      aiBtn.setAttribute('aria-disabled', aiDisabled ? 'true' : 'false');
      aiBtn.title = getAiFillButtonTitle(row);
      aiBtn.classList.toggle('fill-ai-needs-key', isAiToggleEnabled() && !getOpenAiApiKey());
    }
  }
}

function kitUploadKindForRow(row) {
  const cat = row.field?.fieldCategory;
  if (cat === 'resume_upload') return 'resume';
  if (cat === 'cover_letter_upload') return 'coverLetter';
  return null;
}

function buildFillPayloadFromRow(row) {
  const uploadKitKind = kitUploadKindForRow(row);
  const hasKitFile = Boolean(row.uploadFile && row.uploadFile.dataUrl)
    || (uploadKitKind && getKitUploadForCategory(row.field.fieldCategory));
  return {
    id: row.field.id,
    elementPath: row.field.elementPath,
    signature: row.field.signature,
    value: row.suggestedValue,
    fieldCategory: row.field.fieldCategory,
    fieldType: row.field.fieldType,
    uploadKitKind: hasKitFile ? uploadKitKind : null,
    uploadFileMeta: row.uploadFile
      ? { name: row.uploadFile.name, type: row.uploadFile.type, size: row.uploadFile.size }
      : null,
    options: Array.isArray(row.field.options) ? row.field.options : []
  };
}

const FIELD_CATEGORY_OPTIONS = [
  ['unknown', 'unknown'],
  ['first_name', 'first name'],
  ['last_name', 'last name'],
  ['full_name', 'full name'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['address', 'address'],
  ['city', 'city'],
  ['state', 'state'],
  ['zip', 'zip / postal'],
  ['country', 'country'],
  ['linkedin', 'LinkedIn'],
  ['github', 'GitHub'],
  ['portfolio', 'portfolio'],
  ['work_authorization', 'work authorization'],
  ['work_authorization_us', 'work authorization (US)'],
  ['work_authorization_ca', 'work authorization (Canada)'],
  ['work_authorization_uk', 'work authorization (UK)'],
  ['sponsorship', 'sponsorship'],
  ['lgbtq_identity', 'LGBTQ+'],
  ['salary', 'desired salary'],
  ['relocation', 'relocation'],
  ['notice_period', 'notice period'],
  ['education', 'education'],
  ['experience_years', 'years experience'],
  ['resume_upload', 'resume upload'],
  ['cover_letter_upload', 'cover letter upload'],
  ['acknowledgment', 'acknowledgment (I have read)'],
  ['employment_kit', 'employment (from kit)'],
  ['custom_question', 'custom question'],
  ['gender', 'gender (EEO)'],
  ['gender_identity', 'gender identity'],
  ['sexual_orientation', 'sexual orientation'],
  ['race', 'race / ethnicity'],
  ['hispanic_latino', 'Hispanic / Latino'],
  ['transgender', 'transgender'],
  ['veteran_status', 'veteran status'],
  ['disability_status', 'disability status']
];

const FIELD_TYPE_LABELS = {
  'text': 'text',
  'textarea': 'long text',
  'rich-text': 'rich text',
  'email': 'email',
  'phone': 'phone',
  'url': 'url',
  'number': 'number',
  'date': 'date',
  'datetime': 'datetime',
  'month': 'month',
  'week': 'week',
  'time': 'time',
  'slider': 'slider',
  'color': 'color',
  'password': 'password',
  'search': 'search',
  'search-autocomplete': 'search & pick',
  'dropdown': 'dropdown',
  'multi-select': 'multi-select',
  'combobox': 'combobox',
  'multi-combobox': 'multi-combobox',
  'checkbox': 'checkbox',
  'checkbox-group': 'checkbox group',
  'radio-group': 'radio group',
  'yes-no': 'yes / no',
  'file': 'file upload'
};

const FIELD_TYPE_FAMILY = {
  'dropdown': 'select',
  'multi-select': 'select',
  'combobox': 'select',
  'multi-combobox': 'select',
  'search-autocomplete': 'autocomplete',
  'checkbox': 'choice',
  'checkbox-group': 'choice',
  'radio-group': 'choice',
  'yes-no': 'choice',
  'file': 'upload',
  'rich-text': 'text',
  'textarea': 'text',
  'slider': 'numeric',
  'number': 'numeric',
  'date': 'numeric',
  'datetime': 'numeric',
  'month': 'numeric',
  'week': 'numeric',
  'time': 'numeric'
};

function renderTypeBadge(field) {
  const type = field?.fieldType || 'text';
  const label = FIELD_TYPE_LABELS[type] || type;
  const family = FIELD_TYPE_FAMILY[type] || 'text';
  const tooltip = type === 'combobox' || type === 'multi-combobox'
    ? `Custom dropdown - menu will open at fill time${field.optionsResolvedAtFill ? ' (options not pre-rendered)' : ''}. Click to override.`
    : type === 'yes-no'
      ? 'Yes/No choice. Click to override.'
      : type === 'search-autocomplete'
        ? 'Server-side autocomplete - extension will type, wait up to ~4.5s per attempt, and click the best matching result (with retries). Click to override.'
        : `Widget type: ${label}. Click to override.`;
  return `<span class="badge type-${family} type-${type} editable-badge" data-kind="type" tabindex="0" title="${escapeHtml(tooltip)}">${escapeHtml(label)}</span>`;
}

function renderCategoryBadge(field) {
  const category = field?.fieldCategory || 'unknown';
  return `<span class="badge editable-badge" data-kind="category" tabindex="0" title="Detected category: ${escapeHtml(category)}. Click to override.">${escapeHtml(category)}</span>`;
}

function openBadgeEditor(badgeEl, index, kind) {
  const row = currentPlan[index];
  if (!row) return;
  const isType = kind === 'type';
  const current = isType ? (row.field.fieldType || 'text') : (row.field.fieldCategory || 'unknown');
  const options = isType ? Object.entries(FIELD_TYPE_LABELS) : FIELD_CATEGORY_OPTIONS;

  const select = document.createElement('select');
  select.className = 'badge-editor';
  options.forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === current) opt.selected = true;
    select.appendChild(opt);
  });

  badgeEl.replaceWith(select);
  select.focus();
  try { select.size = Math.min(8, options.length); } catch (_) {}

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const newValue = select.value;
    const currentRow = currentPlan[index];
    if (!currentRow) return;
    if (isType) {
      currentRow.field.fieldType = newValue;
    } else if (newValue !== currentRow.field.fieldCategory) {
      currentRow.field.fieldCategory = newValue;
      const fresh = createPlanRow(currentRow.field);
      currentPlan[index] = fresh;
    }
    saveScanState();
    renderFieldPlan();
  };

  select.addEventListener('change', commit);
  select.addEventListener('blur', commit);
  select.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      committed = true;
      renderFieldPlan();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  });
}

function clearFieldsSearch() {
  const input = document.getElementById('fieldsSearch');
  if (input) input.value = '';
}

function getFieldsSearchQuery() {
  const input = document.getElementById('fieldsSearch');
  return input ? String(input.value || '').trim() : '';
}

function filterPlanRowsForSearch(entries, rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return entries;
  const tokens = q.split(/\s+/).filter(Boolean);
  return (entries || []).filter(({ row }) => {
    const field = row.field || {};
    const haystack = [
      field.questionText,
      field.labelText,
      field.nearbyText,
      field.name,
      field.placeholder,
      field.fieldCategory,
      field.fieldType,
      field.ariaLabel,
      row.suggestedValue,
      row.source,
      row.status,
      ...(field.options || [])
    ].join(' ').toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

function updateFieldsFilterMeta(visibleCount, hiddenFillableCount, searchHiddenCount = 0, searchQuery = '') {
  const meta = document.getElementById('fieldsFilterMeta');
  if (!meta) return;
  const dismissedSuffix = lastDismissedCount > 0
    ? ` · <button class="link-button" type="button" id="restoreDismissedBtn">${lastDismissedCount} dismissed — restore</button>`
    : '';
  if (!currentPlan.length && !dismissedSuffix) {
    meta.textContent = '';
    return;
  }
  let baseHtml;
  if (!currentPlan.length) {
    baseHtml = '0 fields';
  } else if (searchQuery) {
    baseHtml = `${visibleCount} match${visibleCount === 1 ? '' : 'es'}`;
    if (searchHiddenCount > 0) baseHtml += ` · ${searchHiddenCount} hidden by search`;
    if (hideFilledFields && hiddenFillableCount > 0) baseHtml += ` · ${hiddenFillableCount} ready hidden`;
  } else if (hideFilledFields && hiddenFillableCount > 0) {
    baseHtml = `${visibleCount} need attention · ${hiddenFillableCount} hidden`;
  } else if (hideFilledFields) {
    baseHtml = `${visibleCount} need attention`;
  } else {
    baseHtml = `Showing all ${currentPlan.length}`;
  }
  meta.innerHTML = `${baseHtml}${dismissedSuffix}`;

  const restoreBtn = document.getElementById('restoreDismissedBtn');
  if (restoreBtn) restoreBtn.addEventListener('click', restoreDismissedForHost);
}

function updateReadyCountHint() {
  const ready = currentPlan.filter(isRowFillable).length;
  const total = currentPlan.length;
  const hint = document.getElementById('readyCountHint');
  if (hint) {
    const base = total ? `${ready} of ${total} ready to fill` : '0 ready to fill';
    const suffix = lastSkippedCount > 0 ? ` · ${lastSkippedCount} hidden as noise` : '';
    hint.textContent = `${base}${suffix}`;
  }
  const labelEl = document.getElementById('autofillCtaLabel');
  if (labelEl) {
    if (ready > 0) {
      labelEl.textContent = `Autofill ${ready.toLocaleString()} field${ready === 1 ? '' : 's'}`;
    } else {
      labelEl.textContent = 'Autofill this page';
    }
  }
}

function renderFieldPlan() {
  const container = document.getElementById('fieldsContainer');
  updateReadyCountHint();
  if (!container) return;

  if (!currentPlan.length) {
    container.className = 'fields-list empty';
    container.textContent = 'No scanned fields yet.';
    updateFieldsFilterMeta(0, 0);
    return;
  }

  const searchQuery = getFieldsSearchQuery();
  const afterFillableFilter = currentPlan
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => (hideFilledFields ? !isRowFillable(row) : true));
  const hiddenFillableCount = currentPlan.length - afterFillableFilter.length;
  const visibleRows = filterPlanRowsForSearch(afterFillableFilter, searchQuery);
  const searchHiddenCount = afterFillableFilter.length - visibleRows.length;
  updateFieldsFilterMeta(visibleRows.length, hiddenFillableCount, searchHiddenCount, searchQuery);

  if (!visibleRows.length) {
    container.className = 'fields-list empty';
    if (searchQuery) {
      container.innerHTML = `
        <div class="filter-empty-state">
          <strong>No fields match your search.</strong>
          <span class="muted">Try different keywords or clear the search box.</span>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="filter-empty-state">
          <strong>Nothing left to review.</strong>
          <span class="muted">All ${currentPlan.length} detected field${currentPlan.length === 1 ? '' : 's'} already ${currentPlan.length === 1 ? 'has' : 'have'} a value. Uncheck "Hide already-fillable fields" to see them.</span>
        </div>
      `;
    }
    return;
  }

  container.className = 'fields-list';
  container.innerHTML = visibleRows.map(({ row, index }) => {
    const field = row.field;
    const question = field.questionText || field.labelText || field.name || field.placeholder || '(unlabeled field)';
    const confidence = Math.round((row.confidence || 0) * 100);
    const typeBadge = renderTypeBadge(field);
    const optionsPreview = Array.isArray(field.options) && field.options.length
      ? `<div class="field-options muted">Options: ${escapeHtml(field.options.slice(0, 8).join(' • '))}${field.options.length > 8 ? '…' : ''}</div>`
      : (field.isCombobox && field.optionsResolvedAtFill
          ? '<div class="field-options muted">Options resolved when menu opens at fill time.</div>'
          : '');
    const fillable = isRowFillable(row);
    const rowClasses = getRowStatusClasses(row).join(' ');
    const statusTone = getRowStatusTone(row);
    const categoryBadge = renderCategoryBadge(field);
    const statusTitle = row.fillOutcome === 'failed' && row.fillError
      ? ` title="${escapeHtml(row.fillError)}"`
      : '';
    return `
      <article class="${rowClasses}" data-index="${index}">
        <button class="dismiss-card" type="button" title="Hide this field on this site" aria-label="Dismiss this field">×</button>
        <div class="field-row-top">
          ${categoryBadge}
          ${typeBadge}
          <span class="confidence">${confidence}%</span>
        </div>
        <div class="question-text">${escapeHtml(question)}</div>
        ${optionsPreview}
        <textarea class="suggested-value" rows="3" placeholder="Enter value to fill, or leave empty to skip">${escapeHtml(row.suggestedValue)}</textarea>
        <div class="field-row-actions">
          <span class="source">Source: ${escapeHtml(row.source)}</span>
          <span class="status-label tone-${statusTone}"${statusTitle}>${escapeHtml(getRowStatusDisplay(row))}</span>
          ${renderFillButtonsHtml(row)}
          ${renderSaveAnswerButtonHtml(row)}
        </div>
      </article>
    `;
  }).join('');

  container.querySelectorAll('.field-row').forEach((rowEl) => {
    const index = Number(rowEl.dataset.index);
    const textarea = rowEl.querySelector('.suggested-value');
    const saveBtn = rowEl.querySelector('.save-as-question');
    const fillBtn = rowEl.querySelector('.fill-one');
    const fillAiBtn = rowEl.querySelector('.fill-ai');
    const dismissBtn = rowEl.querySelector('.dismiss-card');

    rowEl.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('textarea, input, button, .editable-badge, a, label, select')) return;
      focusFieldOnPage(index);
    });

    if (dismissBtn) {
      dismissBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        dismissField(index);
      });
    }

    rowEl.querySelectorAll('.editable-badge').forEach((badge) => {
      const trigger = () => openBadgeEditor(badge, index, badge.dataset.kind);
      badge.addEventListener('click', trigger);
      badge.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          trigger();
        }
      });
    });

    textarea.addEventListener('input', () => {
      const planRow = currentPlan[index];
      planRow.suggestedValue = textarea.value;
      const hasValue = Boolean(textarea.value.trim());
      planRow.fillError = '';
      if (hasValue) {
        planRow.status = 'Ready';
        planRow.fillOutcome = null;
      } else {
        planRow.status = 'Skipped';
        planRow.fillOutcome = 'skipped';
      }
      updateFieldRowAppearance(rowEl, planRow);
      updateReadyCountHint();
      saveScanState();
    });

    if (fillBtn) {
      fillBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        fillSingleField(index, { triggerBtn: fillBtn, rowEl, useAi: false });
      });
    }
    if (fillAiBtn) {
      fillAiBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        fillSingleField(index, { triggerBtn: fillAiBtn, rowEl, useAi: true });
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        savePlanRowAsCustomQuestion(index, { triggerBtn: saveBtn, rowEl });
      });
    }
  });
}

async function focusFieldOnPage(index) {
  const row = currentPlan[index];
  if (!row) return;
  const payload = {
    id: row.field.id,
    elementPath: row.field.elementPath,
    signature: row.field.signature,
    fieldCategory: row.field.fieldCategory,
    fieldType: row.field.fieldType
  };
  try {
    const { response } = await sendToActiveTab({ action: 'focusField', field: payload });
    if (!response || !response.success) {
      showStatus(response?.error || 'Could not locate this field on the page.', 'error', 4000);
    }
  } catch (error) {
    showStatus(error.message || String(error), 'error', 4000);
  }
}

async function fillSingleField(index, { triggerBtn, rowEl, useAi = false } = {}) {
  const row = currentPlan[index];
  if (!row) return;

  if (useAi && !isAiToggleEnabled()) {
    showStatus('Enable AI fill in Settings to use this button.', 'info', 4000);
    return;
  }
  if (useAi && !requireOpenAiApiKey()) {
    return;
  }

  if (!useAi && !isRowFillable(row)) {
    showStatus('Enter a value before filling this field.', 'error');
    return;
  }

  const fillBtn = triggerBtn || rowEl?.querySelector(useAi ? '.fill-ai' : '.fill-one');
  const labelEl = fillBtn?.querySelector('.fill-ai-label');
  const originalLabel = labelEl ? labelEl.textContent : (fillBtn ? fillBtn.textContent : 'Fill');

  const setBusy = (busy) => {
    if (!fillBtn) return;
    fillBtn.disabled = busy;
    if (labelEl) labelEl.textContent = busy ? (useAi ? 'Thinking…' : 'Filling…') : originalLabel;
    else fillBtn.textContent = busy ? (useAi ? 'Thinking…' : 'Filling…') : originalLabel;
    if (!busy) fillBtn.classList.remove('done');
  };

  setBusy(true);

  try {
    if (useAi) {
      if (isAiBlockedField(row) && !(row.uploadFile && row.uploadFile.dataUrl)) {
        throw new Error('Upload the file in Application kits, then use regular Fill.');
      }
      if (!isRowFillable(row) || row.source !== 'ai') {
        const aiValue = await generateAiValueForRow(row);
        applyAiValueToRow(row, aiValue, rowEl);
      }
    }

    if (!isRowFillable(row)) {
      throw new Error('No value available to fill this field.');
    }

    const payload = [buildFillPayloadFromRow(row)];
    const thresholds = {
      selectMatchThreshold: currentSettings.selectMatchThreshold ?? defaultSettings.selectMatchThreshold,
      radioMatchThreshold: currentSettings.radioMatchThreshold ?? defaultSettings.radioMatchThreshold
    };

    if (!useAi) setBusy(true);

    const { response } = await sendToActiveTab({ action: 'fillApplicationFields', fields: payload, thresholds });
    if (!response || !response.success) throw new Error(response?.error || 'Fill failed.');
    const result = (response.results || [])[0] || { success: false, error: 'No result returned.' };
    applyFillResultToPlanRow(row, result, { usedAi: useAi });
    if (rowEl) updateFieldRowAppearance(rowEl, row);
    saveScanState();
    if (result.success) {
      bumpLifetimeFilled(1);
      showStatus(useAi ? 'AI answer filled on the page. Review before submitting.' : 'Filled. Edit the textarea to refill, or move on.', 'success', 3000);
    } else {
      showStatus(result.error || 'Could not fill this field on the page.', 'error');
    }
  } catch (error) {
    setBusy(false);
    if (fillBtn) fillBtn.disabled = useAi ? isAiBlockedField(row) : !isRowFillable(row);
    const errMsg = error.message || String(error);
    if (/api key is not set|invalid openai api key/i.test(errMsg)) {
      showOpenAiKeyRequired(errMsg);
      return;
    }
    showStatus(errMsg, 'error');
  }
}

async function fillSelectedFields({ useAi = false } = {}) {
  const fillableEntries = currentPlan
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => isRowFillable(row));
  const payload = fillableEntries.map(({ row }) => buildFillPayloadFromRow(row));

  const thresholds = {
    selectMatchThreshold: currentSettings.selectMatchThreshold ?? defaultSettings.selectMatchThreshold,
    radioMatchThreshold: currentSettings.radioMatchThreshold ?? defaultSettings.radioMatchThreshold
  };

  if (!payload.length) {
    showStatus('No fields are ready to fill. Add values in the textareas first.', 'error');
    return;
  }

  try {
    showStatus(`Auto-filling ${payload.length} field${payload.length === 1 ? '' : 's'}...`, 'info', 0);
    const { response } = await sendToActiveTab({ action: 'fillApplicationFields', fields: payload, thresholds });
    if (!response || !response.success) throw new Error(response?.error || 'Fill failed.');
    const results = response.results || [];
    fillableEntries.forEach(({ row, index }, i) => {
      applyFillResultToPlanRow(row, results[i] || { success: false, error: 'No result returned.' }, { usedAi: useAi });
      const rowEl = document.querySelector(`.field-row[data-index="${index}"]`);
      updateFieldRowAppearance(rowEl, row);
    });
    saveScanState();
    const failed = results.filter((item) => !item.success);
    const succeeded = payload.length - failed.length;
    if (succeeded > 0) bumpLifetimeFilled(succeeded);
    if (failed.length) {
      showStatus(`Filled ${succeeded} of ${payload.length} fields (${failed.length} failed). Review highlighted fields.`, 'error', 6000);
    } else {
      showStatus(`Filled ${payload.length} field${payload.length === 1 ? '' : 's'}. Review before submitting.`, 'success', 6000);
    }
  } catch (error) {
    showStatus(error.message, 'error');
  }
}

async function fillSelectedFieldsWithAi() {
  if (!requireOpenAiApiKey()) return;

  invalidateAiContextCache();
  const targets = currentPlan
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.source !== 'voluntary' && row.source !== 'optional' && !row.field?.voluntary && !row.field?.optional);

  if (!targets.length) {
    showStatus('No fields to process.', 'info');
    return;
  }

  let generated = 0;
  let filled = 0;
  let failed = 0;

  try {
    showStatus(`AI: preparing answers for ${targets.length} field${targets.length === 1 ? '' : 's'}…`, 'info', 0);

    for (const { row, index } of targets) {
      const rowEl = document.querySelector(`.field-row[data-index="${index}"]`);

      if (isAiBlockedField(row)) {
        if (isRowFillable(row)) {
          const payload = [buildFillPayloadFromRow(row)];
          const thresholds = {
            selectMatchThreshold: currentSettings.selectMatchThreshold ?? defaultSettings.selectMatchThreshold,
            radioMatchThreshold: currentSettings.radioMatchThreshold ?? defaultSettings.radioMatchThreshold
          };
          const { response } = await sendToActiveTab({ action: 'fillApplicationFields', fields: payload, thresholds });
          const result = (response?.results || [])[0];
          applyFillResultToPlanRow(row, result || { success: false }, { usedAi: false });
          updateFieldRowAppearance(rowEl, row);
          if (result?.success) filled += 1;
          else failed += 1;
        }
        continue;
      }

      if (!isRowFillable(row) || row.source !== 'ai') {
        try {
          const aiValue = await generateAiValueForRow(row);
          applyAiValueToRow(row, aiValue, rowEl);
          generated += 1;
        } catch (error) {
          const errMsg = error.message || String(error);
          if (/api key is not set|invalid openai api key/i.test(errMsg)) {
            showOpenAiKeyRequired(errMsg);
            return;
          }
          row.fillOutcome = 'failed';
          row.fillError = errMsg;
          row.status = 'Failed';
          updateFieldRowAppearance(rowEl, row);
          failed += 1;
          await delay(AI_FILL_BATCH_DELAY_MS);
          continue;
        }
        await delay(AI_FILL_BATCH_DELAY_MS);
      }

      if (!isRowFillable(row)) continue;

      const payload = [buildFillPayloadFromRow(row)];
      const thresholds = {
        selectMatchThreshold: currentSettings.selectMatchThreshold ?? defaultSettings.selectMatchThreshold,
        radioMatchThreshold: currentSettings.radioMatchThreshold ?? defaultSettings.radioMatchThreshold
      };
      const { response } = await sendToActiveTab({ action: 'fillApplicationFields', fields: payload, thresholds });
      const result = (response?.results || [])[0] || { success: false, error: 'No result returned.' };
      applyFillResultToPlanRow(row, result, { usedAi: true });
      updateFieldRowAppearance(rowEl, row);
      if (result.success) filled += 1;
      else failed += 1;
      await delay(200);
    }

    saveScanState();
    if (filled > 0) bumpLifetimeFilled(filled);

    if (failed > 0) {
      showStatus(`AI: filled ${filled}, generated ${generated}, ${failed} failed. Review highlighted fields.`, 'error', 7000);
    } else {
      showStatus(`AI filled ${filled} field${filled === 1 ? '' : 's'}${generated ? ` (${generated} new answers)` : ''}. Review before submitting.`, 'success', 7000);
    }
  } catch (error) {
    showStatus(error.message || String(error), 'error');
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getQuestionsSearchQuery() {
  const input = document.getElementById('questionsSearch');
  return input ? String(input.value || '').trim() : '';
}

function filterQuestionsForSearch(questions, rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return questions;
  const tokens = q.split(/\s+/).filter(Boolean);
  return (questions || []).filter((item) => {
    const haystack = [
      item.title,
      ...(item.questionPatterns || []),
      item.answer,
      ...(item.tags || [])
    ].join(' ').toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

function buildCustomQuestionItem({
  id,
  title,
  patterns,
  answer,
  tags,
  requireReview,
  autoFill,
  createdAt
}) {
  const now = new Date().toISOString();
  return {
    id: id || `cq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: String(title || '').trim(),
    questionPatterns: (patterns || []).map((p) => String(p).trim()).filter(Boolean),
    answer: String(answer || '').trim(),
    tags: (tags || []).map((t) => String(t).trim()).filter(Boolean),
    autoFill: Boolean(autoFill),
    requireReview: requireReview !== false,
    createdAt: createdAt || now,
    updatedAt: now
  };
}

function upsertCustomQuestionInList(list, item) {
  const next = Array.isArray(list) ? list.slice() : [];
  const index = next.findIndex((q) => q.id === item.id);
  if (index >= 0) {
    item.createdAt = next[index].createdAt || item.createdAt;
    next[index] = item;
  } else {
    next.push(item);
  }
  return next;
}

function commitCustomQuestions(next, statusMessage) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [CUSTOM_QUESTIONS_KEY]: next }, () => {
      currentQuestions = next;
      renderQuestionsList();
      regeneratePlan();
      if (statusMessage) showStatus(statusMessage, 'success', 2800);
      resolve();
    });
  });
}

function savePlanRowAsCustomQuestion(index, { triggerBtn, rowEl } = {}) {
  const row = currentPlan[index];
  if (!row) return;

  const question = (row.field.questionText || row.field.labelText || row.field.nearbyText || '').trim();
  const answer = (row.suggestedValue || '').trim();
  if (!question) {
    showStatus('This field has no question text to save.', 'error', 4000);
    return;
  }
  if (!answer) {
    showStatus('Enter an answer in the field first, then save.', 'error', 4000);
    return;
  }

  const existingId = row.customQuestionId || '';
  const existing = existingId ? currentQuestions.find((q) => q.id === existingId) : null;
  const patterns = existing?.questionPatterns?.length ? [...existing.questionPatterns] : [];
  if (!patterns.some((p) => normalizeText(p) === normalizeText(question))) {
    patterns.unshift(question);
  }

  const item = buildCustomQuestionItem({
    id: existingId || undefined,
    title: question.slice(0, 120),
    patterns,
    answer,
    tags: existing?.tags?.length ? existing.tags : ['application'],
    requireReview: false,
    autoFill: true,
    createdAt: existing?.createdAt
  });

  const next = upsertCustomQuestionInList(currentQuestions, item);
  commitCustomQuestions(next, 'Answer saved to question bank.').then(() => {
    row.customQuestionId = item.id;
    row.source = 'custom';
    row.status = 'Ready';
    row.confidence = Math.max(row.confidence || 0, 0.92);
    if (rowEl) updateFieldRowAppearance(rowEl, row);
    if (triggerBtn) {
      triggerBtn.classList.add('saved');
      const label = triggerBtn.querySelector('.save-answer-label');
      if (label) label.textContent = 'Saved';
      triggerBtn.title = 'Saved to question bank — click to update';
      triggerBtn.setAttribute('aria-label', triggerBtn.title);
    }
    saveScanState();
  });
}

function getActiveEditingQuestionId() {
  const fromInput = document.getElementById('questionId')?.value.trim();
  return fromInput || editingQuestionId || null;
}

function updateQuestionEditorChrome() {
  const id = getActiveEditingQuestionId();
  const isEdit = Boolean(id);
  const item = isEdit ? currentQuestions.find((q) => q.id === id) : null;
  const heading = document.getElementById('questionEditorHeading');
  const kicker = document.getElementById('questionEditorKicker');
  const submitBtn = document.getElementById('questionFormSubmitBtn');
  const wrap = document.getElementById('questionEditorWrap');
  if (heading) {
    heading.textContent = isEdit
      ? (item?.title || 'Edit custom Q&A')
      : 'New custom Q&A';
  }
  if (kicker) kicker.textContent = isEdit ? 'Editing' : 'New';
  if (submitBtn) submitBtn.textContent = isEdit ? 'Update' : 'Save';
  if (wrap) {
    wrap.classList.toggle('is-editing', isEdit);
    wrap.classList.toggle('is-new', !isEdit);
  }
}

function openQuestionEditor({ id = null, scroll = true } = {}) {
  editingQuestionId = id;
  const wrap = document.getElementById('questionEditorWrap');
  if (!wrap) return;
  wrap.classList.remove('is-collapsed');
  wrap.setAttribute('aria-hidden', 'false');
  updateQuestionEditorChrome();
  renderQuestionsList();
  if (scroll) {
    try { wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
  }
}

function closeQuestionEditor() {
  editingQuestionId = null;
  document.getElementById('questionId').value = '';
  document.getElementById('questionTitle').value = '';
  document.getElementById('questionPatterns').value = '';
  document.getElementById('questionAnswer').value = '';
  document.getElementById('questionTags').value = '';
  document.getElementById('questionRequireReview').checked = true;
  document.getElementById('questionAutoFill').checked = false;
  const wrap = document.getElementById('questionEditorWrap');
  if (wrap) {
    wrap.classList.add('is-collapsed');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.classList.remove('is-editing', 'is-new');
  }
  renderQuestionsList();
}

function startNewQuestion() {
  editingQuestionId = null;
  document.getElementById('questionId').value = '';
  document.getElementById('questionTitle').value = '';
  document.getElementById('questionPatterns').value = '';
  document.getElementById('questionAnswer').value = '';
  document.getElementById('questionTags').value = '';
  document.getElementById('questionRequireReview').checked = true;
  document.getElementById('questionAutoFill').checked = false;
  openQuestionEditor({ id: null });
  const titleInput = document.getElementById('questionTitle');
  if (titleInput) titleInput.focus();
}

function resetQuestionForm() {
  closeQuestionEditor();
}

function saveCustomQuestion(event) {
  event.preventDefault();
  const idInput = document.getElementById('questionId');
  const title = document.getElementById('questionTitle').value.trim();
  const patterns = document.getElementById('questionPatterns').value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
  const answer = document.getElementById('questionAnswer').value.trim();
  const tags = document.getElementById('questionTags').value.split(',').map((item) => item.trim()).filter(Boolean);
  const requireReview = document.getElementById('questionRequireReview').checked;
  const autoFill = document.getElementById('questionAutoFill').checked;

  if (!title || !answer || !patterns.length) {
    showStatus('Please provide title, at least one pattern, and answer.', 'error');
    return;
  }

  const existingId = idInput.value.trim();
  const existing = existingId ? currentQuestions.find((q) => q.id === existingId) : null;
  const item = buildCustomQuestionItem({
    id: existingId || undefined,
    title,
    patterns,
    answer,
    tags,
    requireReview,
    autoFill,
    createdAt: existing?.createdAt
  });

  const next = upsertCustomQuestionInList(currentQuestions, item);
  commitCustomQuestions(next, 'Custom Q&A saved.').then(() => {
    closeQuestionEditor();
  });
}

function truncateQuestionPreview(text, maxLen = 140) {
  const t = String(text || '').trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function renderQuestionCardBadges(item) {
  const badges = [];
  if (item.autoFill) badges.push('<span class="question-pill pill-autofill">Autofill</span>');
  if (item.requireReview) badges.push('<span class="question-pill pill-review">Review</span>');
  else badges.push('<span class="question-pill pill-ready">Auto-ready</span>');
  return badges.length ? `<div class="question-card-badges">${badges.join('')}</div>` : '';
}

function updateQuestionsCountBadge(count) {
  const badge = document.getElementById('questionsCountBadge');
  if (badge) badge.textContent = String(count);
}

function renderQuestionsList() {
  const container = document.getElementById('questionsList');
  if (!container) return;
  const searchQuery = getQuestionsSearchQuery();
  const filtered = filterQuestionsForSearch(currentQuestions, searchQuery);
  const activeId = getActiveEditingQuestionId();
  const editorOpen = !document.getElementById('questionEditorWrap')?.classList.contains('is-collapsed');

  updateQuestionsCountBadge(currentQuestions.length);

  if (!currentQuestions.length) {
    container.className = 'questions-list empty';
    container.innerHTML = '<p>No custom Q&amp;A saved yet.</p><p class="muted">Click <strong>+</strong> to add your first answer.</p>';
    return;
  }

  if (!filtered.length) {
    container.className = 'questions-list empty';
    container.textContent = searchQuery
      ? `No Q&A matches “${searchQuery}”.`
      : 'No custom Q&A saved yet.';
    return;
  }

  container.className = 'questions-list';
  container.innerHTML = filtered.map((item) => {
    const isActive = editorOpen && activeId === item.id;
    const patternPreview = truncateQuestionPreview((item.questionPatterns || [])[0] || '', 120);
    const answerPreview = truncateQuestionPreview(item.answer || '', 160);
    const tags = (item.tags || []).join(', ') || 'no tags';
    return `
    <article class="question-card${isActive ? ' is-active' : ''}" data-id="${escapeHtml(item.id)}" tabindex="0" role="button" aria-label="Edit ${escapeHtml(item.title)}">
      <div class="question-card-top">
        <div class="question-card-title">${escapeHtml(item.title)}</div>
        <div class="question-card-actions">
          <button class="btn small edit-question" type="button" title="Edit">Edit</button>
          <button class="btn small danger delete-question" type="button" title="Delete">Delete</button>
        </div>
      </div>
      ${renderQuestionCardBadges(item)}
      ${patternPreview ? `<div class="question-card-pattern muted">${escapeHtml(patternPreview)}</div>` : ''}
      <div class="question-card-answer">${escapeHtml(answerPreview)}</div>
      <div class="question-card-meta">${escapeHtml(tags)}</div>
    </article>
  `;
  }).join('');

  container.querySelectorAll('.question-card').forEach((card) => {
    const id = card.dataset.id;
    const openEdit = (event) => {
      if (event) event.stopPropagation();
      editQuestion(id);
    };
    card.addEventListener('click', (event) => {
      if (event.target.closest('.delete-question, .edit-question')) return;
      editQuestion(id);
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        editQuestion(id);
      }
    });
    card.querySelector('.edit-question').addEventListener('click', openEdit);
    card.querySelector('.delete-question').addEventListener('click', (event) => {
      event.stopPropagation();
      deleteQuestion(id);
    });
  });
}

function editQuestion(id) {
  const item = currentQuestions.find((q) => q.id === id);
  if (!item) return;
  editingQuestionId = id;
  document.getElementById('questionId').value = item.id;
  document.getElementById('questionTitle').value = item.title || '';
  document.getElementById('questionPatterns').value = (item.questionPatterns || []).join('\n');
  document.getElementById('questionAnswer').value = item.answer || '';
  document.getElementById('questionTags').value = (item.tags || []).join(', ');
  document.getElementById('questionRequireReview').checked = item.requireReview !== false;
  document.getElementById('questionAutoFill').checked = Boolean(item.autoFill);
  openQuestionEditor({ id, scroll: true });
  const titleInput = document.getElementById('questionTitle');
  if (titleInput) titleInput.focus();
}

function deleteQuestion(id) {
  if (getActiveEditingQuestionId() === id) {
    closeQuestionEditor();
  }
  const next = currentQuestions.filter((q) => q.id !== id);
  commitCustomQuestions(next, 'Custom Q&A deleted.');
}

function updateDailyStats() {
  const today = getTodayKey();
  chrome.storage.local.get([DAILY_DATE_KEY, DAILY_COUNT_KEY], (result) => {
    let count = result[DAILY_COUNT_KEY] || 0;
    if ((result[DAILY_DATE_KEY] || '') !== today) {
      count = 0;
      chrome.storage.local.set({ [DAILY_DATE_KEY]: today, [DAILY_COUNT_KEY]: 0 });
    }
    document.getElementById('dailyCount').textContent = count;
  });
}

function toJobEntry(job) {
  return {
    name: job.name || job.user_name || '',
    title: job.title || job.job_title || '',
    company_name: job.company_name || job.company || '',
    job_link: job.job_link || job.job_url || '',
    note: job.note || ''
  };
}

async function quickSaveCurrentJob() {
  try {
    await scrapeCurrentJob(false);
  } catch (_) {}

  const title = document.getElementById('jobTitle').value.trim();
  const company = document.getElementById('jobCompany').value.trim();
  const link = document.getElementById('jobLink').value.trim();

  if (!title || !company) {
    const saveSection = document.getElementById('jobForm');
    if (saveSection) {
      const wrapper = saveSection.closest('.collapsible-card');
      if (wrapper) wrapper.open = true;
      saveSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    showStatus('Job title or company missing. Fill them in the Save section.', 'error');
    return;
  }

  saveJobFromForm(new Event('submit', { cancelable: true }));
}

function saveJobFromForm(event) {
  event.preventDefault();
  const job = {
    name: document.getElementById('jobName').value.trim() || currentProfile.fullName || '',
    title: document.getElementById('jobTitle').value.trim(),
    company_name: document.getElementById('jobCompany').value.trim(),
    job_link: document.getElementById('jobLink').value.trim(),
    note: document.getElementById('jobNote').value.trim()
  };

  if (!job.title || !job.company_name) {
    showStatus('Job title and company are required.', 'error');
    return;
  }

  chrome.storage.local.get([STORAGE_KEY, DAILY_DATE_KEY, DAILY_COUNT_KEY, DAILY_LIMIT_KEY], (result) => {
    let jobs = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY].map(toJobEntry) : [];
    const existingIndex = job.job_link ? jobs.findIndex((item) => item.job_link === job.job_link) : -1;
    const today = getTodayKey();
    let dailyCount = result[DAILY_COUNT_KEY] || 0;
    const limit = Math.max(1, parseInt(result[DAILY_LIMIT_KEY], 10) || DEFAULT_DAILY_LIMIT);
    if ((result[DAILY_DATE_KEY] || '') !== today) dailyCount = 0;

    if (existingIndex >= 0) {
      jobs[existingIndex] = job;
    } else {
      if (dailyCount >= limit) {
        showStatus(`Daily limit of ${limit} reached.`, 'error');
        return;
      }
      jobs.push(job);
      dailyCount += 1;
    }

    chrome.storage.local.set({
      [STORAGE_KEY]: jobs,
      [DAILY_DATE_KEY]: today,
      [DAILY_COUNT_KEY]: dailyCount,
      [USER_NAME_KEY]: job.name
    }, () => {
      renderSavedJobs();
      updateDailyStats();
      showStatus(existingIndex >= 0 ? 'Job updated.' : 'Job saved.', 'success');
    });
  });
}

function renderSavedJobs() {
  const container = document.getElementById('savedJobsList');
  if (!container) return;
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const jobs = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY].map(toJobEntry) : [];
    if (!jobs.length) {
      container.className = 'saved-list empty';
      container.textContent = 'No saved applications yet.';
      return;
    }
    container.className = 'saved-list';
    container.innerHTML = jobs.slice().reverse().map((job, reverseIndex) => {
      const index = jobs.length - 1 - reverseIndex;
      return `
        <article class="saved-job" data-index="${index}">
          <div>
            <div class="saved-title">${escapeHtml(job.title || 'Untitled')}</div>
            <div class="saved-company">${escapeHtml(job.company_name || '')}</div>
            <a href="${escapeHtml(job.job_link || '#')}" target="_blank" rel="noreferrer">${escapeHtml(job.job_link || '')}</a>
          </div>
          <button class="btn small danger remove-job" type="button">Remove</button>
        </article>
      `;
    }).join('');
    container.querySelectorAll('.remove-job').forEach((button) => {
      button.addEventListener('click', () => removeJob(Number(button.closest('.saved-job').dataset.index)));
    });
  });
}

function removeJob(index) {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    let jobs = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY].map(toJobEntry) : [];
    jobs = jobs.filter((_, i) => i !== index);
    chrome.storage.local.set({ [STORAGE_KEY]: jobs }, () => {
      renderSavedJobs();
      showStatus('Job removed.', 'success');
    });
  });
}

function resetJobs() {
  chrome.storage.local.set({ [STORAGE_KEY]: [], [DAILY_COUNT_KEY]: 0, [DAILY_DATE_KEY]: getTodayKey() }, () => {
    renderSavedJobs();
    updateDailyStats();
    showStatus('Saved jobs cleared.', 'success');
  });
}

function downloadJobsJson() {
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const jobs = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY].map(toJobEntry) : [];
    const d = new Date();
    const filename = `jobs_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    const blob = new Blob([JSON.stringify(jobs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({ url, filename, saveAs: true }, () => {
      URL.revokeObjectURL(url);
      showStatus('JSON download started.', 'success');
    });
  });
}

const OPTIMIZED_UI_KEY = 'rwh_optimized_ui_v1';
const EXPANDED_HOST_KEY = 'rwh_expanded_host_v1';
const IS_ASSISTANT_DIALOG =
  typeof document !== 'undefined' &&
  (document.documentElement.classList.contains('assistant-dialog') ||
    /[?&]dialog=1(?:&|$)/.test(location.search || ''));

function notifyParentOptimizedUi(enabled) {
  const payload = {
    source: 'remote-helper-sidepanel',
    action: 'setOptimizedUi',
    enabled: Boolean(enabled),
    railOnly: false
  };
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, '*');
      return;
    }
  } catch (_) {
    /* ignore */
  }
  try {
    chrome.runtime.sendMessage(
      {
        action: 'setOptimizedUiOnActiveTab',
        enabled: Boolean(enabled),
        railOnly: false
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  } catch (_) {
    /* ignore */
  }
}

function collectOptUiState() {
  const buttonMap = {
    buildCopyPrompt: 'regBuildCopyPromptBtn',
    generateFiles: 'regGenerateFilesBtn',
    register: 'registerJobBtn',
    autofill: 'regAutofillBtn'
  };
  const buttons = {};
  Object.entries(buttonMap).forEach(([key, id]) => {
    const el = document.getElementById(id);
    buttons[key] = {
      disabled: Boolean(el?.disabled),
      title: el?.title || '',
      loading: Boolean(el?.classList.contains('is-loading'))
    };
  });
  const dotInfo = (id) => {
    const el = document.getElementById(id);
    if (!el) return { className: '', title: '' };
    return {
      className: Array.from(el.classList)
        .filter((c) => c !== 'backend-connection-dot')
        .join(' '),
      title: el.title || ''
    };
  };
  let progress = null;
  try {
    const full = window.SmartJobRegisterResumeDb?.computeApplyProgress?.();
    if (full) {
      progress = {
        currentIndex: full.currentIndex,
        doneCount: full.doneCount,
        total: full.total,
        complete: full.complete,
        steps: full.steps.map((step) => ({
          key: step.key,
          label: step.label,
          number: step.number,
          state: step.state,
          reason: step.reason
        }))
      };
    }
  } catch (_) {
    /* ignore */
  }

  return {
    buttons,
    progress,
    dots: {
      website: dotInfo('backendConnectionDot'),
      drive: dotInfo('driveConnectionDot'),
      json2docx: dotInfo('json2docxConnectionDot')
    }
  };
}

function publishOptUiState() {
  const state = collectOptUiState();
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        { source: 'remote-helper-sidepanel', action: 'optUiState', state },
        '*'
      );
    }
  } catch (_) {
    /* ignore */
  }
  try {
    chrome.runtime.sendMessage({ action: 'broadcastOptUiState', state }, () => {
      void chrome.runtime.lastError;
    });
  } catch (_) {
    /* ignore */
  }
}

async function applyJdText(text) {
  const note = document.getElementById('regNote');
  if (!note) throw new Error('Note field not found.');
  note.value = String(text ?? '');
  note.dispatchEvent(new Event('input', { bubbles: true }));
  note.dispatchEvent(new Event('change', { bubbles: true }));
  showStatus('Job description updated.', 'success');
}

async function applyResumeJsonText(text) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('Resume JSON is empty.');
  const ta = document.getElementById('regResumeJson');
  if (!ta) throw new Error('Resume JSON field not found.');
  ta.value = raw;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.dispatchEvent(new Event('change', { bubbles: true }));
  const api = window.SmartJobRegisterResumeDb;
  if (api?.applyResumeJsonToRegisterForm) {
    api.applyResumeJsonToRegisterForm(raw, { silent: false, showStatus });
  }
  try {
    await scrapeJobInfoToAllForms({ showSuccess: false });
  } catch (err) {
    showStatus(
      'Resume JSON applied. Scrape warning: ' + (err?.message || String(err)),
      'error'
    );
    return;
  }
  showStatus('Resume JSON applied; register details refreshed from page.', 'success');
}

function replyOptFieldValue(field, id) {
  const map = { note: 'regNote', resumeJson: 'regResumeJson' };
  const el = document.getElementById(map[field] || '');
  const value = el ? String(el.value || '') : '';
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          source: 'remote-helper-sidepanel',
          action: 'optFieldValue',
          id,
          field,
          value
        },
        '*'
      );
    }
  } catch (_) {
    /* ignore */
  }
}

function notifyOptActionFeedback(message, type = 'info', timeout = 4000) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          source: 'remote-helper-sidepanel',
          action: 'optActionFeedback',
          message: String(message || ''),
          type: type || 'info',
          timeout
        },
        '*'
      );
    }
  } catch (_) {
    /* ignore */
  }
}

async function runBuildCopyPromptAction() {
  const btn = document.getElementById('regBuildCopyPromptBtn');
  if (!btn) throw new Error('Build & Copy Prompt button not found.');
  if (btn.disabled) throw new Error(btn.title || 'Select a profile first.');

  const api = window.SmartJobRegisterResumeDb;
  if (!api?.buildAndCopyPromptFromKit) {
    throw new Error('Prompt kit module not ready — reload the extension.');
  }

  btn.classList.add('is-loading');
  publishOptUiState();
  try {
    await api.buildAndCopyPromptFromKit(showStatus);
  } finally {
    btn.classList.remove('is-loading');
    publishOptUiState();
  }
}

async function runOptimizedAction(name) {
  switch (name) {
    case 'pasteJd':
      await pasteJobDescriptionFromClipboard();
      break;
    case 'buildCopyPrompt':
      await runBuildCopyPromptAction();
      break;
    case 'pasteResumeJson':
      await pasteResumeJsonFromClipboard();
      break;
    case 'generateFiles':
      clickPanelBtn('regGenerateFilesBtn');
      break;
    case 'register':
      clickPanelBtn('registerJobBtn');
      break;
    case 'autofill':
      clickIfEnabled('regAutofillBtn');
      break;
    default:
      throw new Error('Unknown optimized action.');
  }
}

function setOptimizedUiMode(enabled, { persist = true, notifyParent = true } = {}) {
  const on = Boolean(enabled);
  // Page overlay owns the compact floating rail — keep full UI ready in this frame.
  document.body.classList.remove('ui-optimized');
  const rail = document.getElementById('optimizedUiRail');
  if (rail) {
    rail.hidden = true;
    rail.setAttribute('aria-hidden', 'true');
  }
  const toggle = document.getElementById('headerOptimizedUiBtn');
  if (toggle) {
    toggle.classList.toggle('is-active', on);
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    toggle.title = on
      ? 'Exit Initial UI (return to side panel)'
      : 'Initial UI (floating toolbar on page)';
    toggle.dataset.optimizedOn = on ? '1' : '0';
  }
  // Always push state to the page: Initial => hide rail, Optimized => show rail only.
  if (notifyParent) notifyParentOptimizedUi(on);
  if (persist) {
    try {
      const payload = { [OPTIMIZED_UI_KEY]: on };
      if (on) {
        payload[EXPANDED_HOST_KEY] = IS_ASSISTANT_DIALOG ? 'overlay' : 'panel';
      }
      chrome.storage.local.set(payload);
    } catch (_) {
      /* ignore */
    }
  }
  window.SmartJobRegisterResumeDb?.syncResumeBuilderActionButtons?.();
  publishOptUiState();
}

window.publishOptUiState = publishOptUiState;

async function readClipboardTextSafe() {
  if (typeof readTextFromClipboard === 'function') {
    return readTextFromClipboard();
  }
  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }
  throw new Error('Clipboard read is not available.');
}

async function pasteJobDescriptionFromClipboard() {
  const text = String(await readClipboardTextSafe() || '').trim();
  if (!text) throw new Error('Clipboard is empty.');
  const note = document.getElementById('regNote');
  if (!note) throw new Error('Note field not found.');
  note.value = text;
  note.dispatchEvent(new Event('input', { bubbles: true }));
  note.dispatchEvent(new Event('change', { bubbles: true }));
  showStatus('Job description pasted into Note.', 'success');
}

async function pasteResumeJsonFromClipboard() {
  const text = String(await readClipboardTextSafe() || '').trim();
  if (!text) throw new Error('Clipboard is empty.');
  const ta = document.getElementById('regResumeJson');
  if (!ta) throw new Error('Resume JSON field not found.');
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.dispatchEvent(new Event('change', { bubbles: true }));
  const api = window.SmartJobRegisterResumeDb;
  if (api?.applyResumeJsonToRegisterForm) {
    api.applyResumeJsonToRegisterForm(text, { silent: false, showStatus });
  }
  showStatus('Resume JSON pasted for this tab.', 'success');
}

function clickPanelBtn(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error('Action button not found.');
  el.click();
}

function clickIfEnabled(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error('Action button not found.');
  if (el.disabled) throw new Error(el.title || 'Action is disabled.');
  el.click();
}

function wireOptimizedUi() {
  const toggle = document.getElementById('headerOptimizedUiBtn');
  if (toggle && toggle.dataset.wired !== '1') {
    toggle.dataset.wired = '1';
    toggle.addEventListener('click', () => {
      const on = toggle.dataset.optimizedOn === '1';
      setOptimizedUiMode(!on);
    });
  }

  const expand = document.getElementById('optExpandFullUiBtn');
  if (expand && expand.dataset.wired !== '1') {
    expand.dataset.wired = '1';
    expand.addEventListener('click', () => setOptimizedUiMode(false));
  }

  const bind = (id, handler) => {
    const btn = document.getElementById(id);
    if (!btn || btn.dataset.wired === '1') return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      try {
        await handler();
      } catch (err) {
        showStatus(err?.message || String(err), 'error');
      }
    });
  };

  bind('optPasteJdBtn', pasteJobDescriptionFromClipboard);
  bind('optBuildCopyPromptBtn', () => runBuildCopyPromptAction());
  bind('optPasteResumeJsonBtn', pasteResumeJsonFromClipboard);
  bind('optGenerateFilesBtn', () => clickPanelBtn('regGenerateFilesBtn'));
  bind('optRegisterBtn', () => clickPanelBtn('registerJobBtn'));
  bind('optAutofillBtn', () => clickIfEnabled('regAutofillBtn'));

  if (!window.__rwhOptMsgWired) {
    window.__rwhOptMsgWired = true;
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.source !== 'remote-helper-assistant') return;
      if (data.action === 'optRunAction') {
        runOptimizedAction(data.name).catch((err) => {
          showStatus(err?.message || String(err), 'error');
        });
        return;
      }
      if (data.action === 'setOptimizedUiMode') {
        setOptimizedUiMode(Boolean(data.enabled), {
          notifyParent: data.skipNotifyParent !== true
        });
        return;
      }
      if (data.action === 'requestOptUiState') {
        publishOptUiState();
        return;
      }
      if (data.action === 'optGetField') {
        replyOptFieldValue(data.field, data.id);
        return;
      }
      if (data.action === 'optApplyJd') {
        applyJdText(data.text).catch((err) => {
          showStatus(err?.message || String(err), 'error');
        });
        return;
      }
      if (data.action === 'optApplyResumeJson') {
        applyResumeJsonText(data.text).catch((err) => {
          showStatus(err?.message || String(err), 'error');
        });
      }
    });

    try {
      chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
        if (!request || !request.action) return false;
        if (request.action === 'optRunAction') {
          runOptimizedAction(request.name)
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
          return true;
        }
        if (request.action === 'setOptimizedUiMode') {
          setOptimizedUiMode(Boolean(request.enabled), {
            notifyParent: request.skipNotifyParent !== true
          });
          sendResponse({ success: true });
          return true;
        }
        if (request.action === 'requestOptUiState') {
          publishOptUiState();
          sendResponse({ success: true, state: collectOptUiState() });
          return true;
        }
        if (request.action === 'optGetField') {
          replyOptFieldValue(request.field, request.id);
          sendResponse({ success: true });
          return true;
        }
        if (request.action === 'optApplyJd') {
          applyJdText(request.text)
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
          return true;
        }
        if (request.action === 'optApplyResumeJson') {
          applyResumeJsonText(request.text)
            .then(() => sendResponse({ success: true }))
            .catch((err) => sendResponse({ success: false, error: err?.message || String(err) }));
          return true;
        }
        return false;
      });
    } catch (_) {
      /* ignore */
    }
  }

    // Sync header from storage. Never broadcast false on load — that would kill an
  // already-visible Initial rail when the hidden dialog iframe mounts.
  try {
    chrome.storage.local.get([OPTIMIZED_UI_KEY], (result) => {
      const on = Boolean(result?.[OPTIMIZED_UI_KEY]);
      const toggleBtn = document.getElementById('headerOptimizedUiBtn');
      if (toggleBtn) {
        toggleBtn.classList.toggle('is-active', on);
        toggleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        toggleBtn.dataset.optimizedOn = on ? '1' : '0';
        toggleBtn.title = on
          ? 'Exit Initial UI (return to side panel)'
          : 'Initial UI (floating toolbar on page)';
      }
      if (on && !IS_ASSISTANT_DIALOG) {
        try {
          chrome.storage.local.set({ [EXPANDED_HOST_KEY]: 'panel' });
        } catch (_) {
          /* ignore */
        }
        notifyParentOptimizedUi(true);
      }
    });
  } catch (_) {
    /* ignore */
  }
}
