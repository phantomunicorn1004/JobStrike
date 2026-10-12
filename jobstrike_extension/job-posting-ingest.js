/**
 * Score job posting candidates, compose full JD (details + body),
 * and split for resume prompt vs compatibility.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.SmartJobPostingIngest = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MIN_JD_CHARS = 80;
  const MIN_JD_QUALITY_CHARS = 300;
  const TRIM_MIN_RATIO = 0.35;

  const NOISE_RE =
    /\b(cookie|consent|sign in|log in|subscribe|newsletter|similar jobs|you may also|apply now)\b/i;
  const APPLY_URL_RE = /\/apply\b|application\/|candidate\/apply/i;

  const RESUME_SECTION_RE =
    /^(responsibilities|requirements|qualifications|what you.?ll do|what we.?re looking|role overview|about the role|key skills|must have|nice to have|experience required)/i;
  const SKIP_SECTION_RE =
    /^(benefits|perks|compensation|salary|eeo|equal opportunity|diversity|about us|about the company|who we are|our culture|what we offer|disclaimer)/i;

  const POLICY_LINE_RE =
    /\b(must (be|have|reside|live)|required to (work|be)|security clearance|active clearance|ts\/sci|secret clearance|sponsorship|visa sponsorship|cannot sponsor|legally authorized|work authorization|hybrid|on-?site|in-?office|remote only|relocation required|travel required|\d+%\s*travel|location:|work arrangement:|employment type:)\b/i;

  const DETAILS_SIGNAL_RE =
    /\b(location|remote|hybrid|on-?site|employment type|full-?time|part-?time|work arrangement|job type)\b/i;

  function trim(value) {
    return String(value == null ? '' : value).trim();
  }

  function normLower(value) {
    return trim(value).toLowerCase();
  }

  /** @param {string} value @param {string} source @param {number} weight */
  function cand(value, source, weight) {
    const v = trim(value);
    if (!v) return null;
    return { value: v, source, weight: Number(weight) || 0.5 };
  }

  /** One entry per value, carrying the strongest source that gave it. */
  function dedupeCandidates(list) {
    const out = [];
    const index = new Map();
    for (const item of list || []) {
      if (!item || !item.value) continue;
      const key = normLower(item.value).slice(0, 200);
      const at = index.get(key);
      if (at == null) {
        index.set(key, out.length);
        out.push(item);
      } else if ((item.weight || 0) > (out[at].weight || 0)) {
        out[at] = item;
      }
    }
    return out;
  }

  function scoreDescription(text, item) {
    const t = trim(text);
    if (!t) return 0;
    let score = (item.weight || 0.5) * 100;
    const len = t.length;
    if (len < MIN_JD_CHARS) score -= 50;
    else if (len < MIN_JD_QUALITY_CHARS) score -= 15;
    else if (len >= 800) score += 12;
    else if (len >= 500) score += 6;
    if (NOISE_RE.test(t.slice(0, 400))) score -= 25;
    if (/\b(responsibilit|qualification|requirement|experience)\b/i.test(t)) score += 8;
    return score;
  }

  /** A copy must be this much longer before it replaces a same-start duplicate. */
  const LONGER_COPY_RATIO = 1.15;
  /** A fuller candidate must beat the pick by this ratio and this many chars. */
  const FULLER_RATIO = 1.5;
  const FULLER_MIN_EXTRA_CHARS = 300;
  /** Share of the pick's words the fuller candidate must also contain. */
  const SUPERSET_MIN_COVERAGE = 0.6;
  /** Below this length a pick may be a teaser rather than the posting. */
  const TEASER_MAX_CHARS = 800;
  const TEASER_RATIO = 2;
  const JD_KEYWORD_RE = /\b(responsibilit|qualification|requirement|experience)/i;

  /**
   * Same-start descriptions are one posting seen through two sources (JSON-LD
   * and the DOM, say). Keep the meaningfully longer copy: the shorter one is
   * usually truncated.
   */
  function dedupeDescriptions(list) {
    const out = [];
    const byKey = new Map();
    for (const item of list || []) {
      if (!item || !item.value) continue;
      const key = normLower(item.value).replace(/\s+/g, ' ').slice(0, 200);
      const at = byKey.get(key);
      if (at == null) {
        byKey.set(key, out.length);
        out.push(item);
        continue;
      }
      const kept = out[at];
      const merged = { ...item, weight: Math.max(item.weight || 0, kept.weight || 0) };
      const flatItem = isFlatCopy(item.value);
      const flatKept = isFlatCopy(kept.value);
      if (flatKept && !flatItem && item.value.length * FLAT_COPY_RATIO >= kept.value.length) {
        // The laid-out copy of the same text: take it over the unbroken one.
        out[at] = merged;
      } else if (item.value.length >= kept.value.length * LONGER_COPY_RATIO) {
        // A flat copy replaces a laid-out one only when it is plainly the fuller
        // text, not the same posting padded with page boilerplate.
        const losesLayout = flatItem && !flatKept && item.value.length < kept.value.length * FLAT_COPY_RATIO;
        if (!losesLayout) out[at] = merged;
      }
    }
    return out;
  }

  /** How much longer an unbroken copy must be before it counts as the fuller text. */
  const FLAT_COPY_RATIO = 1.6;

  /**
   * One unbroken block: a posting that lost its paragraphs and lists on the way
   * (Workday's JSON-LD description, for one). Hard to read in the Note and worse
   * as a prompt than the page's own layout.
   */
  function isFlatCopy(text) {
    const value = String(text || '');
    return value.length >= 600 && value.split(/\n+/).filter((line) => line.trim()).length <= 2;
  }

  function wordSet(text, limit) {
    const words = normLower(text).match(/[a-z0-9][a-z0-9'+#-]{3,}/g) || [];
    return new Set(limit ? words.slice(0, limit) : words);
  }

  /** Share of `part`'s leading words that also appear anywhere in `whole`. */
  function wordCoverage(part, whole) {
    const sample = wordSet(part, 400);
    if (!sample.size) return 0;
    const pool = wordSet(whole);
    let hits = 0;
    sample.forEach((word) => {
      if (pool.has(word)) hits += 1;
    });
    return hits / sample.size;
  }

  /**
   * Source weight ranks candidates first, but a trusted source can still hold
   * only part of the posting (a JSON-LD summary, one tab of a tabbed layout).
   * A much longer candidate wins when it contains the pick, or when the pick
   * is short enough to be a teaser and the longer text reads like a posting.
   */
  function pickBestDescription(candidates) {
    const list = dedupeDescriptions(candidates);
    if (!list.length) return { value: '', source: '', score: 0 };
    let best = list[0];
    let bestScore = scoreDescription(best.value, best);
    for (let i = 1; i < list.length; i += 1) {
      const s = scoreDescription(list[i].value, list[i]);
      if (s > bestScore) {
        best = list[i];
        bestScore = s;
      }
    }

    const byLength = list.slice().sort((a, b) => b.value.length - a.value.length);
    for (const item of byLength) {
      if (item === best) break;
      const len = item.value.length;
      const bestLen = best.value.length;
      if (len < bestLen * FULLER_RATIO || len - bestLen < FULLER_MIN_EXTRA_CHARS) break;
      const superset = wordCoverage(best.value, item.value) >= SUPERSET_MIN_COVERAGE;
      const teaser =
        bestLen < TEASER_MAX_CHARS && len >= bestLen * TEASER_RATIO && JD_KEYWORD_RE.test(item.value);
      if (superset || teaser) {
        return {
          value: item.value,
          source: item.source,
          score: scoreDescription(item.value, item),
          replaced: best.source,
        };
      }
    }
    return { value: best.value, source: best.source, score: bestScore };
  }

  /** True when `needle` occurs in `haystack` bounded by non-letters and non-digits. */
  function containsWholeWords(haystack, needle) {
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) return false;
      const before = at === 0 ? '' : haystack[at - 1];
      const after = haystack[at + needle.length] || '';
      if (!/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after)) return true;
      from = at + 1;
    }
  }

  function pickAlignedField(candidates, description, kind) {
    const list = dedupeCandidates(candidates);
    const desc = normLower(description);
    let best = null;
    let bestScore = -1;
    for (const item of list) {
      const v = item.value;
      const lower = normLower(v);
      let score = (item.weight || 0.5) * 100;
      // Whole words only: "Central Ban" is not named by "Central Bank of the Ozarks".
      if (desc && lower.length >= 3 && containsWholeWords(desc, lower)) score += 20;
      if (kind === 'title' && lower.length > 120) score -= 30;
      if (kind === 'company' && /^(greenhouse|lever|workday|oracle|linkedin)$/i.test(lower)) score -= 40;
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return best ? { value: best.value, source: best.source } : { value: '', source: '' };
  }

  function pickBestUrl(candidates, tabUrl) {
    const list = dedupeCandidates(candidates);
    const tab = trim(tabUrl);
    if (!list.length) return { value: tab, source: 'tab' };
    let best = cand(tab, 'tab', 0.7);
    for (const item of list) {
      const w = item.weight || 0.5;
      if (w >= 0.85 && trim(item.value)) {
        return { value: trim(item.value), source: item.source };
      }
    }
    for (const item of list) {
      if ((item.weight || 0) > (best.weight || 0)) best = item;
    }
    return { value: trim(best.value) || tab, source: best.source || 'tab' };
  }

  /**
   * Compose Note text: job details first (compat / AI cap), then description body.
   * @param {string} detailsBlock
   * @param {string} bodyText
   */
  function composeRawFullText(detailsBlock, bodyText) {
    const details = trim(detailsBlock);
    const body = trim(bodyText);
    if (details && body) {
      return `## Job details\n${details}\n\n## Description\n${body}`;
    }
    if (details) return `## Job details\n${details}`;
    return body;
  }

  function extractDescriptionBody(raw) {
    const text = trim(raw);
    if (!text) return '';
    const m = text.match(/##\s*Description\s*\n([\s\S]*)/i);
    if (m) return trim(m[1]);
    if (/^##\s*Job details\b/i.test(text)) {
      return '';
    }
    return text;
  }

  function extractDetailsBlock(raw) {
    const text = trim(raw);
    if (!text) return '';
    const m = text.match(/##\s*Job details\s*\n([\s\S]*?)(?=\n##\s*Description\b|$)/i);
    if (m) return trim(m[1]);
    return '';
  }

  const DETAILS_META_ONLY_RE =
    /^(location|work arrangement|employment type|applicant location|schedule|travel|remote type|posted|requisition|job id|req(uisition)?( id)?|department|team|salary|compensation|pay range|time type):/i;
  const DETAILS_REQUIREMENT_RE =
    /\b(must |required|qualification|years? of|experience|clearance|degree|bachelor|master|skill|certification|proficien|responsibilit)\b/i;

  /**
   * Headings that open role content under any wording ("Your Impact",
   * "Minimum Qualifications", "Who You Are"). Used to leave a skipped section:
   * relying only on RESUME_SECTION_RE dropped everything after "Benefits" or
   * "About us" whenever the next heading was phrased differently.
   */
  const ROLE_HEADING_RE =
    /\b(role|responsib|requirement|qualif|skills?|experience|you|your|impact|opportunit|position|duties|profile|bring|looking|expect|mission|team|what|who|why|how|day|job|work|tech|stack|must|nice|preferred|minimum|basic|key)\b/i;

  /** A short standalone line that titles a section, not a sentence, bullet, or "Label: value". */
  function isHeadingLine(line) {
    const t = trim(line);
    if (!t || t.length > 70) return false;
    if (/^[-•*·]\s/.test(t)) return false;
    if (/[.;,!]$/.test(t)) return false;
    if (/^[^:]{2,40}:\s+\S/.test(t)) return false;
    return true;
  }

  function splitJobDescription(rawFullText) {
    const raw = trim(rawFullText);
    if (!raw) {
      return { resumePromptText: '', compatExcerptText: '', usedFullForResume: true };
    }

    const detailsBlock = extractDetailsBlock(raw);
    const body = extractDescriptionBody(raw) || (!detailsBlock ? raw : '');

    const policyLines = [];
    const detailsRequirementLines = [];
    if (detailsBlock) {
      detailsBlock.split(/\n+/).forEach((line) => {
        const t = trim(line);
        if (!t) return;
        policyLines.push(t);
        // Requirements that live only in the details panel still feed Copy Prompt.
        if (!DETAILS_META_ONLY_RE.test(t) && DETAILS_REQUIREMENT_RE.test(t)) {
          detailsRequirementLines.push(t);
        }
      });
    }

    const resumeParts = [];
    const resumeSeen = new Set();
    const pushResume = (line) => {
      const t = trim(line);
      if (!t) return;
      const key = t.toLowerCase();
      if (resumeSeen.has(key)) return;
      resumeSeen.add(key);
      resumeParts.push(t);
    };

    const lines = body.split(/\n+/);
    let inResumeSection = false;
    let inSkipSection = false;

    for (const line of lines) {
      const t = trim(line);
      if (!t) continue;
      if (/^##\s/.test(t)) continue;
      const heading = isHeadingLine(t);
      if (RESUME_SECTION_RE.test(t) || (heading && ROLE_HEADING_RE.test(t) && !SKIP_SECTION_RE.test(t))) {
        inResumeSection = true;
        inSkipSection = false;
        pushResume(t);
        continue;
      }
      if (SKIP_SECTION_RE.test(t)) {
        // "Compensation: $150K" is one fact, not the start of a section; only a
        // heading opens a skipped section that swallows the lines after it.
        if (heading) {
          inSkipSection = true;
          inResumeSection = false;
        }
        continue;
      }
      if (POLICY_LINE_RE.test(t)) {
        policyLines.push(t);
        // Structured detail headers stay out of the resume prompt slice.
        if (DETAILS_META_ONLY_RE.test(t)) {
          continue;
        }
        // Narrative requirements ("must have…") still go into the resume slice.
      }
      if (inSkipSection) continue;
      if (inResumeSection || !SKIP_SECTION_RE.test(t)) {
        pushResume(t);
      }
    }

    detailsRequirementLines.forEach(pushResume);

    let resumePromptText = resumeParts.join('\n').trim();
    const bodyLen = body.length || raw.length;
    if (!resumePromptText || resumePromptText.length < bodyLen * TRIM_MIN_RATIO) {
      resumePromptText = body || raw;
      if (detailsRequirementLines.length) {
        const extra = detailsRequirementLines.join('\n');
        if (extra && !resumePromptText.includes(extra.slice(0, Math.min(80, extra.length)))) {
          resumePromptText = `${resumePromptText}\n\n${extra}`.trim();
        }
      }
    }

    const compatExcerptText = policyLines.join('\n').trim();

    return {
      resumePromptText,
      compatExcerptText,
      usedFullForResume: resumePromptText === raw || resumePromptText === body,
    };
  }

  function confidenceLabel(score) {
    if (score >= 75) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
  }

  function hasDetailsSignals(detailsBlock) {
    const t = trim(detailsBlock);
    if (!t) return false;
    if (DETAILS_SIGNAL_RE.test(t)) return true;
    // Full details panel text (many Label: value rows) counts even without classic keywords
    const labeled = (t.match(/^[^:\n]{2,40}:\s+\S+/gm) || []).length;
    return labeled >= 2 || t.length >= 120;
  }

  /**
   * @param {{
   *   titles: Array<{value:string,source:string,weight:number}>,
   *   companies: Array<{value:string,source:string,weight:number}>,
   *   descriptions: Array<{value:string,source:string,weight:number}>,
   *   urls: Array<{value:string,source:string,weight:number}>,
   *   detailsBlock?: string,
   *   detailsSource?: string,
   *   tabUrl: string
   * }} input
   */
  function assembleJobPosting(input) {
    const tabUrl = trim(input.tabUrl);
    const descPick = pickBestDescription(input.descriptions || []);
    const bodyText = descPick.value;
    const detailsBlock = trim(input.detailsBlock || '');
    const detailsSource = trim(input.detailsSource || '') || (detailsBlock ? 'mixed' : 'none');
    const rawFullText = composeRawFullText(detailsBlock, bodyText);

    const titlePick = pickAlignedField(input.titles || [], rawFullText, 'title');
    const companyPick = pickAlignedField(input.companies || [], rawFullText, 'company');
    const urlPick = pickBestUrl(input.urls || [], tabUrl);

    const split = splitJobDescription(rawFullText);
    const warnings = [];
    if (!rawFullText) warnings.push('empty_jd');
    else if (rawFullText.length < MIN_JD_CHARS) warnings.push('short_jd');
    else if (bodyText.length < MIN_JD_QUALITY_CHARS && rawFullText.length < MIN_JD_QUALITY_CHARS) {
      warnings.push('weak_jd');
    }
    if (!bodyText && detailsBlock) warnings.push('missing_body');
    if (bodyText && !hasDetailsSignals(detailsBlock) && !DETAILS_SIGNAL_RE.test(bodyText.slice(0, 1500))) {
      warnings.push('missing_details');
    }
    if (APPLY_URL_RE.test(tabUrl) && rawFullText.length < MIN_JD_QUALITY_CHARS) {
      warnings.push('apply_only');
    }
    if (descPick.score < 50 && bodyText) warnings.push('low_confidence');
    if (detailsBlock && detailsSource === 'chips') warnings.push('chips_only_details');

    let score = descPick.score;
    if (detailsBlock && hasDetailsSignals(detailsBlock)) score += 10;
    if (detailsSource === 'panel' || detailsSource === 'panel+structured') score += 6;
    if (warnings.includes('missing_details')) score -= 8;

    const confidence = Math.max(0, Math.min(1, score / 100));

    return {
      jobLink: urlPick.value || tabUrl,
      tabUrl,
      jobTitle: titlePick.value,
      companyName: companyPick.value,
      rawFullText,
      resumePromptText: split.resumePromptText,
      compatExcerptText: split.compatExcerptText,
      detailsBlock,
      bodyText,
      meta: {
        source: descPick.source || (detailsBlock ? 'details-only' : 'none'),
        titleSource: titlePick.source,
        companySource: companyPick.source,
        urlSource: urlPick.source,
        detailsSource,
        hasDetails: Boolean(detailsBlock && hasDetailsSignals(detailsBlock)),
        confidence,
        confidenceLabel: confidenceLabel(score),
        warnings,
        usedFullForResume: split.usedFullForResume,
      },
    };
  }

  function postingToLegacyFields(posting) {
    const p = posting || {};
    return {
      job_link: p.jobLink || p.tabUrl || '',
      job_title: p.jobTitle || '',
      company_name: p.companyName || '',
      job_description: p.rawFullText || '',
    };
  }

  return {
    MIN_JD_CHARS,
    cand,
    dedupeCandidates,
    pickBestDescription,
    assembleJobPosting,
    splitJobDescription,
    composeRawFullText,
    postingToLegacyFields,
  };
});
