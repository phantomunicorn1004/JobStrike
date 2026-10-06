/**
 * Remote / geo heuristics for scrape listing signals and Bid JD preflight.
 * Profile city/state is per active profile — never hardcoded to one location.
 */
(function (global) {
  'use strict';

  const US_STATE_NAMES = {
    AL: 'alabama',
    AK: 'alaska',
    AZ: 'arizona',
    AR: 'arkansas',
    CA: 'california',
    CO: 'colorado',
    CT: 'connecticut',
    DE: 'delaware',
    FL: 'florida',
    GA: 'georgia',
    HI: 'hawaii',
    ID: 'idaho',
    IL: 'illinois',
    IN: 'indiana',
    IA: 'iowa',
    KS: 'kansas',
    KY: 'kentucky',
    LA: 'louisiana',
    ME: 'maine',
    MD: 'maryland',
    MA: 'massachusetts',
    MI: 'michigan',
    MN: 'minnesota',
    MS: 'mississippi',
    MO: 'missouri',
    MT: 'montana',
    NE: 'nebraska',
    NV: 'nevada',
    NH: 'new hampshire',
    NJ: 'new jersey',
    NM: 'new mexico',
    NY: 'new york',
    NC: 'north carolina',
    ND: 'north dakota',
    OH: 'ohio',
    OK: 'oklahoma',
    OR: 'oregon',
    PA: 'pennsylvania',
    RI: 'rhode island',
    SC: 'south carolina',
    SD: 'south dakota',
    TN: 'tennessee',
    TX: 'texas',
    UT: 'utah',
    VT: 'vermont',
    VA: 'virginia',
    WA: 'washington',
    WV: 'west virginia',
    WI: 'wisconsin',
    WY: 'wyoming',
    DC: 'district of columbia',
  };

  const STRONG_REMOTE =
    /\b(100\s*%\s*remote|fully remote|remote[\s-]first|work from anywhere|anywhere in (the )?(us|u\.s\.|united states)|nationwide remote|all 50 states|anywhere in the country|no physical office|location independent)\b/i;

  const LISTING_HYBRID = /\b(hybrid|on[\s-]?site|in[\s-]?office|office hub|core market|headquarters)\b/i;
  const LISTING_REMOTE_POS =
    /\b(100\s*%\s*remote|fully remote|remote[\s-]first|work from anywhere|anywhere in (the )?(us|u\.s\.)|distributed team)\b/i;

  const ONSITE_ONLY =
    /\b(on[\s-]?site only|onsite only|in[\s-]?office only|must (be|work) (on[\s-]?site|in[\s-]?office)|no remote|not remote)\b/i;
  const HYBRID = /\b(hybrid position|hybrid role|\bhybrid\b)/i;
  const RESIDENCY_RADIUS =
    /\b(residency within|within a?\s*\d{2,3}[\s-]?mile|must (live|reside) (within|near|in)|commutable distance|radius of .{0,40}office)\b/i;
  const BAIT_REMOTE =
    /\b(remote to start|hybrid potential|post[\s-]?covid|return to office|occasional travel to (the )?hq|days (a|per) week in (?:the )?office)\b/i;

  const STATE_LIST_INTRO =
    /(?:must (?:reside|live|be located)|only accepting applications from|eligible only in|open to candidates in|must be located in|employees must reside in)[^.:\n]{0,120}/i;

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeProfileState(state) {
    const raw = String(state || '').trim();
    if (!raw) return '';
    const upper = raw.toUpperCase();
    if (US_STATE_NAMES[upper]) return upper;
    const lower = raw.toLowerCase();
    for (const [abbr, name] of Object.entries(US_STATE_NAMES)) {
      if (name === lower || lower === name.replace(/\s+/g, '')) return abbr;
    }
    return upper.slice(0, 2);
  }

  function listingText(job) {
    return [
      job?.title,
      job?.requirements_summary,
      job?.role_activities,
      job?.company_tagline,
      job?.core_job_title,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Soft signal from title + HC summaries (no full JD).
   * @returns {{ level: 'ok'|'risky'|'unknown', score: number, hint: string }}
   */
  function scoreListingSignal(job) {
    const text = normalizeText(listingText(job));
    if (!text) {
      return { level: 'unknown', score: 50, hint: 'No listing text' };
    }

    let score = 55;
    if (STRONG_REMOTE.test(text)) score += 35;
    else if (LISTING_REMOTE_POS.test(text)) score += 22;
    if (LISTING_HYBRID.test(text)) score -= 28;
    if (/\bhybrid\b/i.test(text) && !STRONG_REMOTE.test(text)) score -= 12;
    if (/\bon[\s-]?site\b/i.test(text) && !/\bremote\b/i.test(text)) score -= 20;

    score = Math.max(0, Math.min(100, score));

    if (score >= 72) {
      return { level: 'ok', score, hint: 'Remote-friendly listing' };
    }
    if (score <= 38) {
      return { level: 'risky', score, hint: 'Hybrid / onsite signals in listing' };
    }
    return { level: 'unknown', score, hint: 'Check JD in Bid' };
  }

  function extractStateTokens(fragment) {
    const found = new Set();
    const chunk = normalizeText(fragment);
    if (!chunk) return found;

    for (const [abbr, name] of Object.entries(US_STATE_NAMES)) {
      const reAbbr = new RegExp(`\\b${abbr.toLowerCase()}\\b`, 'i');
      const reName = new RegExp(`\\b${name.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (reAbbr.test(chunk) || reName.test(chunk)) found.add(abbr);
    }
    return found;
  }

  /**
   * JD + profile location → geo criterion for Bid preflight.
   * @returns {{ status: 'pass'|'warn'|'fail'|'skip', message: string, weight: number }}
   */
  function evaluateProfileGeo(jd, profileCity, profileState) {
    const weight = 18;
    const text = String(jd || '').trim();
    const profileAbbr = normalizeProfileState(profileState);

    if (!text) {
      return { status: 'skip', message: 'Geo: add JD to check location rules.', weight: 0 };
    }
    if (!profileAbbr) {
      return {
        status: 'skip',
        message: 'Geo: set profile state in Settings to check state lists.',
        weight: 0,
      };
    }

    if (STRONG_REMOTE.test(text)) {
      return {
        status: 'pass',
        message: `Geo: strong US-remote language; OK for ${profileAbbr}.`,
        weight,
      };
    }

    if (ONSITE_ONLY.test(text)) {
      return {
        status: 'fail',
        message: 'Geo: JD looks onsite-only — likely reject for remote profile.',
        weight,
      };
    }

    const listMatch = text.match(STATE_LIST_INTRO);
    if (listMatch) {
      const allowed = extractStateTokens(listMatch[0]);
      if (allowed.size > 0 && allowed.size <= 20 && !allowed.has(profileAbbr)) {
        const sample = [...allowed].slice(0, 6).join(', ');
        return {
          status: 'fail',
          message: `Geo: JD limits states (${sample}${allowed.size > 6 ? '…' : ''}); profile is ${profileAbbr}.`,
          weight,
        };
      }
      if (allowed.size > 0 && allowed.has(profileAbbr)) {
        return {
          status: 'pass',
          message: `Geo: profile state ${profileAbbr} is in the JD allowlist.`,
          weight,
        };
      }
    }

    if (RESIDENCY_RADIUS.test(text) && !STRONG_REMOTE.test(text)) {
      const city = String(profileCity || '').trim();
      return {
        status: 'warn',
        message: city
          ? `Geo: office radius / residency rule — verify ${city}, ${profileAbbr} qualifies.`
          : `Geo: office radius / residency rule — verify ${profileAbbr} qualifies.`,
        weight,
      };
    }

    if (HYBRID.test(text) && BAIT_REMOTE.test(text)) {
      return {
        status: 'warn',
        message: 'Geo: hybrid or return-to-office language — may not stay remote.',
        weight,
      };
    }

    if (HYBRID.test(text) && !STRONG_REMOTE.test(text)) {
      return {
        status: 'warn',
        message: 'Geo: hybrid role — confirm it is not hub-locked for your state.',
        weight,
      };
    }

    return {
      status: 'pass',
      message: 'Geo: no explicit state block found for this profile.',
      weight,
    };
  }

  function signalRank(level) {
    if (level === 'ok') return 0;
    if (level === 'unknown') return 1;
    if (level === 'risky') return 2;
    return 1;
  }

  global.SmartJobRemoteGeo = {
    scoreListingSignal,
    evaluateProfileGeo,
    signalRank,
    normalizeProfileState,
    STRONG_REMOTE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
