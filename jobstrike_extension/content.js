// Content script for JobStrike.
// Scans application forms, scrapes basic job info, and safely fills selected fields.

(function () {
  'use strict';

  if (window.smartJobAutofillInitialized) return;
  window.smartJobAutofillInitialized = true;

  const SKIP_INPUT_TYPES = new Set(['hidden', 'button', 'submit', 'reset', 'image']);
  const NOISE_SELECTOR = 'script, style, noscript, svg, canvas, iframe, footer, header, nav, [aria-hidden="true"]';
  const KIT_STORAGE_KEY = 'autofill_application_kits';

  const ADAPTER_SCORE_THRESHOLD = 25;

  function fieldRegistry() {
    return typeof SmartJobFieldRegistry !== 'undefined' ? SmartJobFieldRegistry : null;
  }

  const defaultAdapter = {
    name: 'default',
    score() { return 0; },
    detect() { return true; },
    resolveFieldCategory(el, questionText) {
      const fr = fieldRegistry();
      if (!fr) return null;
      return fr.resolveFieldCategory({
        labelText: questionText,
        nameAttr: el && el.getAttribute('name'),
        idAttr: el && el.getAttribute('id')
      });
    },
    getScanRoot() {
      const forms = Array.from(document.querySelectorAll('form'));
      let best = null;
      let bestCount = 0;
      for (const form of forms) {
        const count = form.querySelectorAll(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'
        ).length;
        if (count > bestCount) {
          bestCount = count;
          best = form;
        }
      }
      return bestCount >= 3 ? best : null;
    },
    getQuestionContainer(el) { return null; },
    getJobInfo() { return null; },
    mapNameToCategory(nameAttr) { return null; }
  };

  function countNamedFields(matcher, root) {
    const scope = root || document;
    return Array.from(scope.querySelectorAll('input[name], select[name], textarea[name]'))
      .filter((el) => matcher(el.getAttribute('name') || '')).length;
  }

  const greenhouseAdapter = {
    name: 'greenhouse',
    score() {
      let score = 0;
      const host = location.hostname.toLowerCase();
      if (/(^|\.)greenhouse\.io$/.test(host) || host.endsWith('job-boards.greenhouse.io')) score += 45;
      if (document.querySelector('#application_form, #application-form, [data-source="greenhouse"]')) score += 30;
      if (document.querySelector('.job__description, main.job-post, .job-post-container')) score += 28;
      const ghFieldCount = countNamedFields((n) => /^job_application\[/i.test(n));
      if (ghFieldCount) score += Math.min(25, 5 + ghFieldCount * 2);
      if (isLeverHost() && !ghFieldCount) score -= 40;
      if (countNamedFields((n) => /_systemfield_/i.test(n)) && !ghFieldCount) score -= 30;
      return Math.max(0, score);
    },
    detect() { return greenhouseAdapter.score() >= ADAPTER_SCORE_THRESHOLD; },
    getScanRoot() {
      return document.querySelector(
        '#application_form, #application-form, form.application--form, form#application-form, form[data-source="greenhouse"], [data-source="greenhouse"] form, form#application'
      ) || document.querySelector('form[action*="application"], form[action*="apply"]');
    },
    getQuestionContainer(el) {
      return el.closest(
        '.field-wrapper, .field, .file-upload, .file-upload__wrapper, .application-question, .question, [class*="application-field"], [role="group"]'
      );
    },
    getQuestionLabel(container, el) {
      if (!container) return null;
      const uploadLabel = container.querySelector(
        '.upload-label, [class*="upload-label"], [id^="upload-label"]'
      );
      if (uploadLabel && !uploadLabel.classList.contains('visually-hidden')) return uploadLabel;
      const group = (el && el.closest('[role="group"]')) || container.closest('[role="group"]');
      if (group) {
        const labelId = group.getAttribute('aria-labelledby');
        if (labelId) {
          const byId = document.getElementById(labelId);
          if (byId) return byId;
        }
      }
      const labels = container.querySelectorAll('label, legend, .label');
      for (const label of labels) {
        if (label.classList.contains('visually-hidden')) continue;
        const text = trim(label.textContent || '');
        if (!text || /^attach$/i.test(text)) continue;
        if (label.querySelector('input[type="file"], button')) continue;
        return label;
      }
      return null;
    },
    getJobInfo() {
      const postingInfo = getGreenhouseJobPostingInfo();
      if (postingInfo.job_title || postingInfo.job_description) return postingInfo;
      const titleEl = document.querySelector(
        '.job__title h1, .job__header h1, .app-title, .posting-headline h2, h1.app-title, h1'
      );
      return {
        job_title: titleEl ? cleanTitle(trim(titleEl.textContent || '')) : '',
        company_name: resolveGreenhouseCompanyName()
      };
    },
    mapNameToCategory(nameAttr) {
      const match = /^job_application\[(.+?)\]/.exec(nameAttr || '');
      if (!match) return null;
      const key = match[1].toLowerCase();
      const table = {
        first_name: 'first_name',
        last_name: 'last_name',
        email: 'email',
        phone: 'phone',
        location: 'city',
        resume: 'resume_upload',
        cover_letter: 'cover_letter_upload',
        urls_linkedin: 'linkedin',
        urls_github: 'github',
        urls_portfolio: 'portfolio',
        urls_website: 'portfolio'
      };
      return table[key] || null;
    },
    mapIdToCategory(idAttr) {
      const fr = fieldRegistry();
      if (fr) {
        const fromRegistry = fr.matchByPlatformId('greenhouse', idAttr);
        if (fromRegistry) return fromRegistry.category;
      }
      if (!idAttr) return null;
      const id = String(idAttr).toLowerCase().replace(/-/g, '_');
      const table = {
        first_name: 'first_name',
        last_name: 'last_name',
        preferred_name: 'first_name',
        email: 'email',
        phone: 'phone',
        candidate_location: 'city',
        job_application_location: 'city',
        resume: 'resume_upload',
        cover_letter: 'cover_letter_upload'
      };
      return table[id] || null;
    },
    resolveFieldCategory(el, questionText) {
      return classifyGreenhouseField(el, questionText);
    }
  };

  function isWorkdayHost() {
    const host = location.hostname.toLowerCase();
    return /\.workday\.com$/i.test(host) || host.includes('myworkdayjobs.com') || isWorkdayPageContext();
  }

  function isUnreliableWorkdayCompanyName(name) {
    const text = trim(name);
    if (!text) return true;
    if (/^wd\d+$/i.test(text)) return true;
    if (/^workday$/i.test(text)) return true;
    if (/^(careers|jobs|apply|home)$/i.test(text)) return true;
    if (/myworkdayjobs/i.test(text)) return true;
    return false;
  }

  function formatWorkdayCompanySlug(slug) {
    const raw = trim(slug).replace(/-/g, ' ');
    if (!raw) return '';
    return raw.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function parseWorkdayCompanyFromHost() {
    const host = location.hostname.toLowerCase();
    const wdTenant = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i.exec(host);
    if (wdTenant?.[1]) {
      return formatWorkdayCompanySlug(wdTenant[1]);
    }
    const legacy = /^(?:[a-z0-9-]+\.)?([a-z0-9-]+)\.(?:myworkdayjobs\.com|wd\d+\.myworkdayjobs\.com)/i.exec(host);
    if (legacy?.[1] && !/^wd\d+$/i.test(legacy[1])) {
      return formatWorkdayCompanySlug(legacy[1]);
    }
    return '';
  }

  function parseWorkdayCompanyFromTitle(title) {
    const text = trim(title);
    if (!text) return '';
    const parts = text.split(/\s+[|–—-]\s+/).map(trim).filter(Boolean);
    for (const part of parts) {
      const careersMatch = /^(.+?)\s+careers$/i.exec(part);
      if (careersMatch?.[1]) return trim(careersMatch[1]);
      const atMatch = /at\s+([^|–—-]+)/i.exec(part);
      if (atMatch?.[1]) return trim(atMatch[1]);
    }
    return '';
  }

  function parseWorkdayCompanyFromLogo() {
    const logoImg = document.querySelector(
      '[data-automation-id="imageSection"] img[alt], [data-automation-id="image"][alt], img[data-automation-id="image"][alt]'
    );
    const alt = trim(logoImg?.getAttribute('alt') || '');
    if (!alt) return '';
    const logoMatch = /^(.+?)\s+logo$/i.exec(alt);
    return trim(logoMatch?.[1] || alt);
  }

  function parseWorkdayCompanyFromSidebar() {
    const headings = document.querySelectorAll(
      '[data-automation-id="jobSidebar"] h3, [data-automation-id="sidebar"] h3, [data-automation-id="textSection"] h3'
    );
    for (const h3 of headings) {
      const text = trim(h3.textContent || '');
      const aboutMatch = /^about\s+(.+)$/i.exec(text);
      if (aboutMatch?.[1]) return trim(aboutMatch[1]);
    }
    return '';
  }

  function parseWorkdayCompanyFromJobDescription() {
    const desc = document.querySelector(
      '[data-automation-id="jobPostingPage"] [data-automation-id="jobPostingDescription"], [data-automation-id="jobPostingDescription"]'
    );
    if (!desc) return '';
    for (const node of desc.querySelectorAll('b, strong, h2, h3, p')) {
      const text = trim(node.textContent || '');
      const aboutMatch = /^about\s+(.+)$/i.exec(text);
      if (aboutMatch?.[1] && aboutMatch[1].length < 80) return trim(aboutMatch[1]);
    }
    return '';
  }

  function cleanWorkdayCompanyLabel(value) {
    let name = cleanCompany(value);
    if (!name) return '';
    name = name.replace(/\s+careers?\s*$/i, '').trim();
    return cleanCompany(name);
  }

  function resolveWorkdayCompanyName() {
    const candidates = [
      parseWorkdayCompanyFromSidebar(),
      parseWorkdayCompanyFromJobDescription(),
      parseWorkdayCompanyFromLogo(),
      parseWorkdayCompanyFromHost(),
      parseWorkdayCompanyFromTitle(document.querySelector('meta[property="og:title"]')?.content || ''),
      parseWorkdayCompanyFromTitle(document.title),
      document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || '',
      document.querySelector('meta[name="application-name"]')?.getAttribute('content') || ''
    ];

    try {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      for (const script of scripts) {
        const parsed = JSON.parse(script.textContent || '{}');
        const items = Array.isArray(parsed) ? parsed : [parsed, ...(parsed['@graph'] || [])];
        for (const item of items) {
          if (!item || (item['@type'] !== 'JobPosting' && !(Array.isArray(item['@type']) && item['@type'].includes('JobPosting')))) {
            continue;
          }
          const org = item.hiringOrganization?.name || item.hiringOrganization;
          if (typeof org === 'string') candidates.push(org);
          else if (org?.name) candidates.push(org.name);
        }
      }
    } catch (_) {}

    for (const candidate of candidates) {
      const cleaned = cleanWorkdayCompanyLabel(candidate);
      if (cleaned && !isUnreliableWorkdayCompanyName(cleaned)) return cleaned;
    }

    const fallback = formatWorkdayCompanySlug(parseWorkdayCompanyFromHost());
    return fallback || '';
  }

  function isWorkdayPageContext() {
    return Boolean(
      document.querySelector('[data-automation-id="jobPostingPage"], [data-automation-id="jobPostingDescription"], [data-automation-id="job-posting-details"]')
    );
  }

  function getWorkdayPostingDetailsRoot(page) {
    const scope = page || document.querySelector('[data-automation-id="jobPostingPage"]') || document;
    return scope.querySelector('[data-automation-id="job-posting-details"]') || scope;
  }

  function getWorkdayDetailValue(detailsRoot, automationId) {
    const block = detailsRoot.querySelector(`[data-automation-id="${automationId}"]`);
    if (!block) return '';
    const dd = block.querySelector('dd');
    return trim(dd?.textContent || block.textContent || '');
  }

  function findWorkdayPostingTitle(page) {
    const scope = page || document.querySelector('[data-automation-id="jobPostingPage"]') || document;
    const titleEl = scope.querySelector(
      '[data-automation-id="jobPostingHeader"], [data-automation-id="jobTitleHeading"], h2[data-automation-id="jobPostingHeader"]'
    );
    if (titleEl) {
      const fromHeader = cleanTitle(trim(titleEl.textContent || ''));
      if (fromHeader) return fromHeader;
    }
    const alertTitle = scope.querySelector('[role="alert"]');
    if (alertTitle) {
      const alertText = trim(alertTitle.textContent || '');
      const m = /^(.+?)\s+page is loaded$/i.exec(alertText);
      if (m?.[1]) return cleanTitle(trim(m[1]));
    }
    const jsonLd = readJobPostingJsonLd();
    if (jsonLd?.title) {
      const fromJson = cleanTitle(trim(jsonLd.title));
      if (fromJson) return fromJson;
    }
    return '';
  }

  function getWorkdayPostingMetaParts(page) {
    const detailsRoot = getWorkdayPostingDetailsRoot(page);
    const parts = [];
    const remote = getWorkdayDetailValue(detailsRoot, 'remoteType');
    const location = getWorkdayDetailValue(detailsRoot, 'locations');
    const timeType = getWorkdayDetailValue(detailsRoot, 'time');
    const postedOn = getWorkdayDetailValue(detailsRoot, 'postedOn');
    const requisition = getWorkdayDetailValue(detailsRoot, 'requisitionId');
    if (remote) parts.push(`Remote type: ${remote}`);
    if (location) parts.push(`Location: ${location}`);
    if (timeType) parts.push(`Employment type: ${timeType}`);
    if (postedOn) parts.push(`Posted: ${postedOn}`);
    if (requisition) parts.push(`Requisition: ${requisition}`);
    return parts.slice(0, 5);
  }

  function normalizeJobDescription(text) {
    const cleaned = trim(text).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    if (cleaned.length <= 50000) return cleaned;
    return `${cleaned.slice(0, 49997)}...`;
  }

  function htmlDescriptionToText(html) {
    const raw = trim(html);
    if (!raw) return '';
    if (!/[<>]/.test(raw)) return normalizeJobDescription(raw);
    const el = document.createElement('div');
    el.innerHTML = raw;
    return normalizeJobDescription(el.innerText || el.textContent || '');
  }

  function normalizeJobDescriptionCandidate(value) {
    if (!value) return '';
    if (typeof value === 'string' && /[<>]/.test(value)) return htmlDescriptionToText(value);
    return normalizeJobDescription(String(value));
  }

  function extractLeverJobDescription(root) {
    const scope = root || document;
    const content = scope.querySelector('.content-wrapper.posting-page .content, .posting-page .content');
    const page = content || scope.querySelector('.content-wrapper.posting-page, .posting-page');
    if (!page) return '';
    const clone = page.cloneNode(true);
    clone.querySelectorAll(
      'script, style, template, meta, .simplify-jobs-shadow-root, [class*="simplify-banner"], .accent-section, .postings-btn-wrapper, .postings-btn, a.postings-btn, a.template-btn-submit, [data-qa="btn-apply-bottom"], [data-qa="show-page-apply"], [data-qa="ai-disclaimer"], .last-section-apply, .main-footer, .main-header, .main-header-content, .cc-window, .cc-banner'
    ).forEach((node) => node.remove());
    return normalizeJobDescription(clone.innerText || clone.textContent || '');
  }

  function resolveLeverCompanyName() {
    const logoAlt = document.querySelector('.main-header-logo img[alt], a.main-header-logo img[alt]')?.getAttribute('alt') || '';
    if (logoAlt) {
      const fromAlt = cleanCompany(trim(logoAlt.replace(/\s*logo\s*$/i, '')));
      if (fromAlt) return fromAlt;
    }
    const headerLink = document.querySelector('a.main-header-logo[href]');
    if (headerLink) {
      const href = headerLink.getAttribute('href') || '';
      const linkMatch = /jobs\.lever\.co\/([^/?#]+)/i.exec(href);
      if (linkMatch?.[1]) {
        const fromLink = cleanCompany(
          decodeURIComponent(linkMatch[1]).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        );
        if (fromLink) return fromLink;
      }
    }
    const jsonLd = readJobPostingJsonLd();
    const fromJson = cleanCompany(jsonLd?.hiringOrganization?.name || jsonLd?.hiringOrganization);
    if (fromJson) return fromJson;
    const fromTitle = cleanCompany(parseCompanyFromTitle(document.title));
    if (fromTitle) return fromTitle;
    const m = /jobs\.lever\.co\/([^/?#]+)/i.exec(location.href);
    if (m) {
      return decodeURIComponent(m[1]).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return '';
  }

  function findLeverPostingTitle() {
    const titleEl = document.querySelector(
      '.posting-headline h2, .posting-header h2, [data-qa="posting-name"], .application-page .posting-headline h2'
    );
    if (titleEl && !titleEl.closest('form, .application-page form, .application-form')) {
      const fromHeadline = cleanTitle(trim(titleEl.textContent || ''));
      if (fromHeadline) return fromHeadline;
    }
    const jsonLd = readJobPostingJsonLd();
    if (jsonLd?.title) {
      const fromJson = cleanTitle(trim(jsonLd.title));
      if (fromJson) return fromJson;
    }
    return '';
  }

  function getLeverPostingMetaParts() {
    const parts = [];
    const categoryLabels = {
      location: 'Location',
      department: 'Department',
      commitment: 'Employment Type',
      workplaceTypes: 'Workplace'
    };
    document.querySelectorAll('.posting-categories .posting-category').forEach((el) => {
      const className = Array.from(el.classList).find((name) => categoryLabels[name]);
      if (!className) return;
      const value = trim((el.textContent || '').replace(/\/\s*$/, ''));
      if (!value || value.length > 120) return;
      const line = `${categoryLabels[className]}: ${value}`;
      if (!parts.includes(line)) parts.push(line);
    });
    return parts;
  }

  function getLeverJobPostingInfo() {
    if (!document.querySelector('.content-wrapper.posting-page, .posting-page, [data-qa="job-description"]')) return {};
    const job_title = findLeverPostingTitle();
    const company_name = resolveLeverCompanyName();
    let job_description = extractLeverJobDescription(document);
    if (!job_description) {
      const jsonLd = readJobPostingJsonLd();
      if (jsonLd?.description) job_description = htmlDescriptionToText(jsonLd.description);
    }
    const metaParts = getLeverPostingMetaParts();
    if (metaParts.length && job_description) {
      job_description = `${metaParts.join('\n')}\n\n${job_description}`;
    } else if (metaParts.length) {
      job_description = metaParts.join('\n');
    }
    return { job_title, company_name, job_description };
  }

  function isWorkableHost() {
    const host = location.hostname.toLowerCase();
    return host.includes('workable.com') || isWorkablePageContext();
  }

  function isWorkablePageContext() {
    return Boolean(
      document.querySelector(
        '[data-ui="overview-title"], [data-ui="job-breakdown-description-parsed-html"], [class*="jobBreakdown__job-breakdown"]'
      )
    );
  }

  function extractWorkableJobDescription(root) {
    const scope = root || document;
    const breakdown = scope.querySelector('[class*="jobBreakdown__job-breakdown"], .jobBreakdown__job-breakdown');
    if (breakdown) {
      const clone = breakdown.cloneNode(true);
      clone.querySelectorAll('script, style, template, meta, button').forEach((node) => node.remove());
      return normalizeJobDescription(clone.innerText || clone.textContent || '');
    }
    const sections = scope.querySelectorAll(
      '[data-ui="job-breakdown-description-parsed-html"], [data-ui="job-breakdown-requirements-parsed-html"], [data-ui="job-breakdown-benefits-parsed-html"], [data-ui^="job-breakdown-"][data-ui$="-parsed-html"]'
    );
    if (!sections.length) return '';
    const wrapper = document.createElement('div');
    sections.forEach((section) => wrapper.appendChild(section.cloneNode(true)));
    wrapper.querySelectorAll('script, style, template, meta, button').forEach((node) => node.remove());
    return normalizeJobDescription(wrapper.innerText || wrapper.textContent || '');
  }

  function resolveWorkableCompanyName() {
    const companyLink = document.querySelector(
      '[data-ui="overview-company"] a, [class*="jobOverview__company"] a, [class*="companyName__link"]'
    );
    if (companyLink) {
      const fromLink = cleanCompany(trim(companyLink.textContent || ''));
      if (fromLink) return fromLink;
    }
    const logoSelectors = [
      '.companyLogo__logo[alt]',
      'img[class*="companyLogo"][alt]',
      '[class*="companyDescription__company-logo"] img[alt]'
    ];
    for (const selector of logoSelectors) {
      const logoImg = document.querySelector(selector);
      if (!logoImg) continue;
      const fromAlt = cleanCompany(trim((logoImg.getAttribute('alt') || '').replace(/\s*logo\s*$/i, '')));
      if (fromAlt) return fromAlt;
    }
    const jsonLd = readJobPostingJsonLd();
    const fromJson = cleanCompany(jsonLd?.hiringOrganization?.name || jsonLd?.hiringOrganization);
    if (fromJson) return fromJson;
    const jobsAtMatch = /jobs-at-([a-z0-9-]+)/i.exec(location.pathname);
    if (jobsAtMatch?.[1]) {
      return cleanCompany(
        decodeURIComponent(jobsAtMatch[1]).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      );
    }
    const fromTitle = cleanCompany(parseCompanyFromTitle(document.title));
    if (fromTitle) return fromTitle;
    return '';
  }

  function findWorkablePostingTitle() {
    const titleEl = document.querySelector(
      '[data-ui="overview-title"], h1[class*="jobOverview__job-title"], [class*="jobOverview__job-title"]'
    );
    if (titleEl) {
      const strong = titleEl.querySelector('strong');
      const text = strong ? trim(strong.textContent || '') : trim(titleEl.textContent || '');
      const title = cleanTitle(text);
      if (title) return title;
    }
    const jsonLd = readJobPostingJsonLd();
    if (jsonLd?.title) {
      const fromJson = cleanTitle(trim(jsonLd.title));
      if (fromJson) return fromJson;
    }
    return '';
  }

  function getWorkablePostingMetaParts() {
    const parts = [];
    const metaMap = {
      'overview-workplace': 'Workplace',
      'overview-location': 'Location',
      'overview-department': 'Department',
      'overview-employment-type': 'Employment Type'
    };
    for (const [ui, label] of Object.entries(metaMap)) {
      const el = document.querySelector(`[data-ui="${ui}"]`);
      if (!el) continue;
      const value = trim(el.textContent || '');
      if (!value || value.length > 120) continue;
      const line = `${label}: ${value}`;
      if (!parts.includes(line)) parts.push(line);
    }
    return parts;
  }

  function appendWorkableCompanyDescription(description) {
    const companyDescEl = document.querySelector('[data-ui="company-description-parsed-html"]');
    if (!companyDescEl) return description;
    const clone = companyDescEl.cloneNode(true);
    clone.querySelectorAll('script, style, template, meta, button').forEach((node) => node.remove());
    const companyText = normalizeJobDescription(clone.innerText || clone.textContent || '');
    if (!companyText) return description;
    if (description) return `${description}\n\nAbout the company\n${companyText}`;
    return `About the company\n${companyText}`;
  }

  function getWorkableJobPostingInfo() {
    if (!isWorkablePageContext()) return {};
    const job_title = findWorkablePostingTitle();
    const company_name = resolveWorkableCompanyName();
    let job_description = extractWorkableJobDescription(document);
    if (!job_description) {
      const jsonLd = readJobPostingJsonLd();
      if (jsonLd?.description) job_description = htmlDescriptionToText(jsonLd.description);
    }
    job_description = appendWorkableCompanyDescription(job_description);
    const metaParts = getWorkablePostingMetaParts();
    if (metaParts.length && job_description) {
      job_description = `${metaParts.join('\n')}\n\n${job_description}`;
    } else if (metaParts.length) {
      job_description = metaParts.join('\n');
    }
    return { job_title, company_name, job_description };
  }

  function isDoverHost() {
    const host = location.hostname.toLowerCase();
    return host.includes('dover.com') || isDoverPageContext();
  }

  function isDoverPageContext() {
    return Boolean(
      document.querySelector(
        '[class*="InboundApplication__ApplicationPortalContainer"], [class*="InboundApplication__JobDescriptionWrapper"], [class*="JobDescriptionWrapper"]'
      )
    );
  }

  function parseDoverCompanyFromDescription(root) {
    const scope = root || document;
    const descEl = scope.querySelector(
      '[class*="InboundApplication__JobDescriptionWrapper"] [class*="StyledHtmlWrapper"], [class*="JobDescriptionWrapper"] [class*="StyledHtmlWrapper"], [class*="InboundApplication__JobDescriptionWrapper"]'
    );
    if (!descEl) return '';
    const text = descEl.innerText || descEl.textContent || '';
    const textMatch = /(?:^|\n)\s*Company:\s*([^\n]+)/i.exec(text);
    if (textMatch?.[1]) {
      const fromText = cleanCompany(trim(textMatch[1]));
      if (fromText) return fromText;
    }
    const html = descEl.innerHTML || '';
    const htmlMatch = /<strong>\s*Company:\s*<\/strong>\s*([^<\n]+)/i.exec(html);
    if (htmlMatch?.[1]) {
      const fromHtml = cleanCompany(trim(htmlMatch[1].replace(/<br\s*\/?>/gi, '')));
      if (fromHtml) return fromHtml;
    }
    return '';
  }

  function extractDoverJobDescription(root) {
    const scope = root || document;
    const wrapper = scope.querySelector(
      '[class*="InboundApplication__JobDescriptionWrapper"], [class*="JobDescriptionWrapper"]'
    );
    if (!wrapper) return '';
    const target = wrapper.querySelector('[class*="StyledHtmlWrapper"]') || wrapper;
    const clone = target.cloneNode(true);
    clone.querySelectorAll(
      'script, style, template, meta, button, iframe, [class*="FormWrapper"], form, [class*="RightColumn"]'
    ).forEach((node) => node.remove());
    return normalizeJobDescription(clone.innerText || clone.textContent || '');
  }

  function resolveDoverCompanyName() {
    const fromDescription = parseDoverCompanyFromDescription(document);
    if (fromDescription) return fromDescription;
    const jsonLd = readJobPostingJsonLd();
    const fromJson = cleanCompany(jsonLd?.hiringOrganization?.name || jsonLd?.hiringOrganization);
    if (fromJson) return fromJson;
    const logoLink = document.querySelector(
      '[class*="HeaderContent"] a[href], [class*="styles__Header"] a[href], [class*="InboundApplication"] a[href]'
    );
    if (logoLink) {
      try {
        const host = new URL(logoLink.href, location.href).hostname.replace(/^www\./i, '');
        const base = host.split('.')[0];
        if (base && !/^(app|apply|jobs|careers)$/i.test(base)) {
          const fromHost = cleanCompany(base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
          if (fromHost) return fromHost;
        }
      } catch (_) {
        /* ignore invalid logo href */
      }
    }
    const pathMatch = /\/([^/]+)\/careers\//i.exec(location.pathname);
    if (pathMatch?.[1]) {
      const fromPath = cleanCompany(
        decodeURIComponent(pathMatch[1]).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      );
      if (fromPath) return fromPath;
    }
    const fromTitle = cleanCompany(parseCompanyFromTitle(document.title));
    if (fromTitle) return fromTitle;
    return '';
  }

  function findDoverPostingTitle() {
    const titleEl = document.querySelector(
      '[class*="typography__TitleLarge"], [class*="InboundApplication__"] [class*="TitleLarge"]'
    );
    if (titleEl) {
      const title = cleanTitle(trim(titleEl.textContent || ''));
      if (title) return title;
    }
    const jsonLd = readJobPostingJsonLd();
    if (jsonLd?.title) {
      const fromJson = cleanTitle(trim(jsonLd.title));
      if (fromJson) return fromJson;
    }
    return '';
  }

  function readDoverMetaValue(container) {
    if (!container) return '';
    const directDivs = Array.from(container.children).filter((child) => child.tagName === 'DIV');
    if (directDivs.length) return trim(directDivs[directDivs.length - 1].textContent || '');
    return trim(container.textContent || '');
  }

  function getDoverPostingMetaParts() {
    const parts = [];
    const locationEl = document.querySelector('[aria-label="Job location"]');
    const employmentEl = document.querySelector('[aria-label="Employment Type"]');
    const location = readDoverMetaValue(locationEl);
    const employment = readDoverMetaValue(employmentEl);
    if (location) parts.push(`Location: ${location}`);
    if (employment) parts.push(`Employment Type: ${employment}`);
    return parts;
  }

  function getDoverJobPostingInfo() {
    if (!isDoverPageContext()) return {};
    const job_title = findDoverPostingTitle();
    const company_name = resolveDoverCompanyName();
    let job_description = extractDoverJobDescription(document);
    if (!job_description) {
      const jsonLd = readJobPostingJsonLd();
      if (jsonLd?.description) job_description = htmlDescriptionToText(jsonLd.description);
    }
    const metaParts = getDoverPostingMetaParts();
    if (metaParts.length && job_description) {
      job_description = `${metaParts.join('\n')}\n\n${job_description}`;
    } else if (metaParts.length) {
      job_description = metaParts.join('\n');
    }
    return { job_title, company_name, job_description };
  }

  function extractRipplingJobDescription(root) {
    const scope = root || document;
    const el = scope.querySelector('.ATS_htmlPreview');
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll(
      'script, style, meta, button, [data-testid="Apply now"], [data-testid="Apply"]'
    ).forEach((node) => node.remove());
    return normalizeJobDescription(clone.innerText || clone.textContent || '');
  }

  function isRipplingPageContext() {
    return Boolean(
      document.querySelector('.ATS_htmlPreview')
      || document.querySelector('[data-testid="breadcrumb"] a[data-value*="/jobs"], [data-testid="breadcrumb"] a[data-testid*="/jobs"]')
      || document.querySelector('img[src*="ripplingcdn" i]')
    );
  }

  function cleanRipplingCompanyLabel(value) {
    let name = cleanCompany(value);
    if (!name) return '';
    name = name.replace(/\s+careers?\s*$/i, '').trim();
    name = name.replace(/\s+jobs?\s*$/i, '').trim();
    return cleanCompany(name);
  }

  function findRipplingPostingRoot() {
    const titledHeading = document.querySelector('h2.css-of4wst');
    if (titledHeading && !titledHeading.closest('.ATS_htmlPreview, form')) {
      return titledHeading.parentElement;
    }
    const preview = document.querySelector('.ATS_htmlPreview');
    if (preview) {
      let node = preview.parentElement;
      for (let depth = 0; depth < 8 && node; depth += 1) {
        if (node.querySelector('img[alt]')) return node;
        node = node.parentElement;
      }
    }
    return document.querySelector('[data-testid="breadcrumb"]')?.closest('[class*="css-"]') || null;
  }

  function parseRipplingCompanyFromBreadcrumbPath() {
    const crumbLink = document.querySelector('[data-testid="breadcrumb"] li:first-child a');
    if (!crumbLink) return '';
    const pathHint = trim(
      crumbLink.getAttribute('data-testid') || crumbLink.getAttribute('data-value') || crumbLink.getAttribute('href') || ''
    );
    const m = /\/([^/]+)\/jobs/i.exec(pathHint);
    if (!m?.[1]) return '';
    const slug = decodeURIComponent(m[1]).replace(/[-_]+/g, ' ');
    return cleanRipplingCompanyLabel(slug.replace(/\b\w/g, (c) => c.toUpperCase()));
  }

  function isGreenhouseHost() {
    const host = location.hostname.toLowerCase();
    return host.includes('greenhouse.io');
  }

  function extractGreenhouseJobDescription(root) {
    const scope = root || document;
    const el = scope.querySelector(
      '.job__description, main.job-post .job__description, .job-post-container .job__description, #content .content.body, #content .body'
    );
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll(
      'script, style, template, meta, .simplify-jobs-shadow-root, [class*="simplify-banner"], .job-alert, button, .application--container, #application-form, footer, [class*="footer-logo"]'
    ).forEach((node) => node.remove());
    return normalizeJobDescription(clone.innerText || clone.textContent || '');
  }

  function extractSmartRecruitersJobDescription(root) {
    const scope = root || document;
    const descRoot = scope.querySelector(
      'main.jobad-main [itemprop="description"], main.job [itemprop="description"], .jobad-main [itemprop="description"], main.jobad-main .job-sections, .job-sections'
    );
    let clone;
    if (descRoot) {
      clone = descRoot.cloneNode(true);
    } else {
      const sections = scope.querySelectorAll('.job-section[id^="st-"]');
      if (!sections.length) return '';
      clone = document.createElement('div');
      sections.forEach((section) => clone.appendChild(section.cloneNode(true)));
    }
    clone.querySelectorAll(
      'script, style, template, meta, spl-job-location, spl-icon, .simplify-jobs-shadow-root, [class*="simplify-banner"], .googlejobs-paragraph--empty, .video-disclaimer, .job-apply, #st-videos, .js-others, .js-similar, .socials, .jobad-aside, .jobad-buttons, button, .widget, .video-items'
    ).forEach((node) => node.remove());
    return normalizeJobDescription(clone.innerText || clone.textContent || '');
  }

  function extractAshbyJobDescription(root) {
    const scope = root || document;
    const textEl = scope.querySelector(
      '.ashby-job-posting-description, #overview .ashby-job-posting-description, #overview [class*="descriptionText"], [role="tabpanel"][aria-labelledby="job-overview"] .ashby-job-posting-description, [role="tabpanel"][aria-labelledby="job-overview"] [class*="descriptionText"], [class*="descriptionText"]'
    );
    const panel = scope.querySelector(
      '#overview[role="tabpanel"], [role="tabpanel"][aria-labelledby="job-overview"], .ashby-job-posting-description-container'
    );
    const target = textEl || panel;
    if (!target) return '';
    const clone = target.cloneNode(true);
    clone.querySelectorAll(
      'script, style, template, meta, .simplify-jobs-shadow-root, [class*="simplify-banner"], a[href*="/application"], button, footer, [class*="powered" i][href*="ashbyhq.com"]'
    ).forEach((node) => node.remove());
    const postingTitle = findAshbyPostingTitle();
    if (postingTitle) {
      const firstHeading = clone.querySelector('h1, h2');
      if (firstHeading && cleanTitle(trim(firstHeading.textContent || '')) === postingTitle) {
        firstHeading.remove();
      }
    }
    return normalizeJobDescription(clone.innerText || clone.textContent || '');
  }

  function extractBamboohrJobDescription(root) {
    const scope = root || document;
    const el = scope.querySelector('.BambooRichText');
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script, style, template, meta').forEach((node) => node.remove());
    return normalizeJobDescription(clone.innerText || clone.textContent || '');
  }

  function extractWorkdayJobDescription(root) {
    const scope = root || document;
    const page = scope.querySelector('[data-automation-id="jobPostingPage"]') || scope;
    const el = page.querySelector('[data-automation-id="jobPostingDescription"]');
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll(
      'script, style, template, meta, button, [data-automation-id="similarJobsCard"], [data-automation-id="similar-jobs-heading"], [data-automation-id="toggle-all-jobs"], .simplify-jobs-shadow-root, [class*="simplify-banner"]'
    ).forEach((node) => node.remove());
    return normalizeJobDescription(clone.innerText || clone.textContent || '');
  }

  function getWorkdayJobPostingInfo() {
    const page = document.querySelector('[data-automation-id="jobPostingPage"]') || document;
    if (!page.querySelector('[data-automation-id="jobPostingDescription"], [data-automation-id="job-posting-details"]')) {
      return {};
    }
    const companyMeta = document.querySelector(
      'meta[property="og:site_name"], meta[name="application-name"]'
    );
    let company = resolveWorkdayCompanyName();
    if (!company && companyMeta) {
      const metaCompany = cleanWorkdayCompanyLabel(companyMeta.getAttribute('content') || '');
      if (metaCompany && !isUnreliableWorkdayCompanyName(metaCompany)) company = metaCompany;
    }

    const job_title = findWorkdayPostingTitle(page);
    const job_description = extractWorkdayJobDescription(page);
    const metaParts = getWorkdayPostingMetaParts(page);

    let description = job_description;
    if (metaParts.length) {
      const header = metaParts.join('\n');
      description = description ? `${header}\n\n${description}` : header;
    }

    return {
      job_title,
      company_name: company,
      job_description: description
    };
  }

  function resolveRipplingCompanyName() {
    const breadcrumbCompany = document.querySelector('[data-testid="breadcrumb"] li:first-child a');
    if (breadcrumbCompany) {
      const fromCrumb = cleanRipplingCompanyLabel(trim(breadcrumbCompany.textContent || ''));
      if (fromCrumb) return fromCrumb;
    }
    const postingRoot = findRipplingPostingRoot();
    const logoAlt = postingRoot?.querySelector('img[alt]')?.getAttribute('alt') || '';
    if (logoAlt) {
      const fromAlt = cleanRipplingCompanyLabel(trim(logoAlt));
      if (fromAlt && !/^(logo|company)$/i.test(fromAlt)) return fromAlt;
    }
    const fromPath = parseRipplingCompanyFromBreadcrumbPath();
    if (fromPath) return fromPath;
    const jsonLd = readJobPostingJsonLd();
    const fromJson = cleanRipplingCompanyLabel(jsonLd?.hiringOrganization?.name || jsonLd?.hiringOrganization);
    if (fromJson) return fromJson;
    const m = /\/([^/]+)\/jobs(?:\/|$)/i.exec(location.pathname);
    if (m) {
      return cleanRipplingCompanyLabel(
        decodeURIComponent(m[1]).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      );
    }
    return '';
  }

  function findRipplingPostingTitle() {
    const breadcrumbCurrent = document.querySelector(
      '[data-testid="breadcrumb"] a[aria-current="page"], [data-testid="breadcrumb"] li:last-child a'
    );
    if (breadcrumbCurrent) {
      const fromCrumb = cleanTitle(trim(breadcrumbCurrent.textContent || ''));
      if (fromCrumb) return fromCrumb;
    }
    const pageTitle = document.querySelector('h2.css-of4wst, .css-cssveg > h2, [data-testid="breadcrumb"] ~ div h2');
    if (pageTitle && !pageTitle.closest('.ATS_htmlPreview, form')) {
      const fromHeading = cleanTitle(trim(pageTitle.textContent || ''));
      if (fromHeading && fromHeading.length < 220) return fromHeading;
    }
    for (const h2 of document.querySelectorAll('h2')) {
      if (h2.closest('form, .ATS_htmlPreview')) continue;
      const t = cleanTitle(trim(h2.textContent || ''));
      if (t && t.length < 220) return t;
    }
    const jsonLd = readJobPostingJsonLd();
    if (jsonLd?.title) {
      const fromJson = cleanTitle(trim(jsonLd.title));
      if (fromJson) return fromJson;
    }
    return '';
  }

  function getRipplingPostingMetaParts() {
    const parts = [];
    document.querySelectorAll('[data-icon="DEPARTMENTS_OUTLINE"], [data-icon="LOCATION_OUTLINE"]').forEach((icon) => {
      const row = icon.closest('[class*="jugqli"]') || icon.parentElement;
      const value = trim(row?.querySelector('p')?.textContent || '');
      if (!value) return;
      const label = icon.getAttribute('data-icon') === 'DEPARTMENTS_OUTLINE' ? 'Department' : 'Location';
      parts.push(`${label}: ${value}`);
    });
    if (!parts.some((part) => /^location:/i.test(part))) {
      const preview = document.querySelector('.ATS_htmlPreview');
      if (preview) {
        const locationMatch = /\blocation:\s*([^\n]+)/i.exec(preview.innerText || preview.textContent || '');
        if (locationMatch) parts.unshift(`Location: ${trim(locationMatch[1])}`);
      }
    }
    return parts.slice(0, 4);
  }

  function getRipplingJobPostingInfo() {
    if (!document.querySelector('.ATS_htmlPreview')) return {};
    const job_title = findRipplingPostingTitle();
    const company_name = resolveRipplingCompanyName();
    let job_description = extractRipplingJobDescription(document);
    if (!job_description) {
      const jsonLd = readJobPostingJsonLd();
      if (jsonLd?.description) job_description = htmlDescriptionToText(jsonLd.description);
    }
    const metaParts = getRipplingPostingMetaParts();
    if (metaParts.length && job_description) {
      job_description = `${metaParts.join('\n')}\n\n${job_description}`;
    } else if (metaParts.length) {
      job_description = metaParts.join('\n');
    }
    return { job_title, company_name, job_description };
  }

  function resolveGreenhouseCompanyName() {
    const logoSelectors = [
      '.image-container img.logo[alt]',
      '.image-container img[alt]',
      'img.logo[alt]',
      '.job-post-container .logo img[alt]',
      '.image-container .logo img[alt]',
      'main.job-post .logo img[alt]',
      '.job-post-container img[alt]'
    ];
    for (const selector of logoSelectors) {
      const logoImg = document.querySelector(selector);
      if (!logoImg) continue;
      const logoAlt = trim(logoImg.getAttribute('alt') || '');
      if (!logoAlt) continue;
      const fromAlt = cleanCompany(trim(logoAlt.replace(/\s*logo\s*$/i, '')));
      if (fromAlt) return fromAlt;
    }
    const boardLink = document.querySelector(
      'a.link[href*="greenhouse.io/"], a[href*="job-boards.greenhouse.io/"]'
    );
    if (boardLink) {
      const href = boardLink.getAttribute('href') || '';
      const pathMatch = /greenhouse\.io\/([^/?#]+)/i.exec(href);
      if (pathMatch?.[1] && !/^(jobs|embed|users)$/i.test(pathMatch[1])) {
        const fromLink = cleanCompany(
          decodeURIComponent(pathMatch[1]).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        );
        if (fromLink) return fromLink;
      }
    }
    const ogSite = document.querySelector('meta[property="og:site_name"]');
    if (ogSite) {
      const fromOg = cleanCompany(trim(ogSite.getAttribute('content') || ''));
      if (fromOg && !/^greenhouse$/i.test(fromOg)) return fromOg;
    }
    const jsonLd = readJobPostingJsonLd();
    const fromJson = cleanCompany(jsonLd?.hiringOrganization?.name || jsonLd?.hiringOrganization);
    if (fromJson) return fromJson;
    const fromTitle = cleanCompany(parseCompanyFromTitle(document.title));
    if (fromTitle) return fromTitle;
    const m = /\/([^/]+)\/jobs(?:\/|$)/i.exec(location.pathname);
    if (m) {
      return decodeURIComponent(m[1]).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return '';
  }

  function findGreenhousePostingTitle() {
    const titleEl = document.querySelector(
      '.job__title h1, .job__header .job__title h1, .job__header h1.section-header, main.job-post .job__header h1'
    );
    if (titleEl && !titleEl.closest('form, .application--container, .eeoc__container, .demographic--container')) {
      const fromHeader = cleanTitle(trim(titleEl.textContent || ''));
      if (fromHeader && !/^apply for this job$/i.test(fromHeader)) return fromHeader;
    }
    const legacy = document.querySelector('.app-title, .posting-headline h2');
    if (legacy) {
      const fromLegacy = cleanTitle(trim(legacy.textContent || ''));
      if (fromLegacy) return fromLegacy;
    }
    return '';
  }

  function getGreenhousePostingMetaParts() {
    const parts = [];
    const locationWrap = document.querySelector('.job__location');
    if (locationWrap) {
      for (const div of locationWrap.querySelectorAll('div')) {
        const value = trim(div.textContent || '');
        if (value && value.length < 120) {
          parts.push(`Location: ${value}`);
          break;
        }
      }
    }
    const tagEl = document.querySelector('.job__tags .tag-text, .job__tags [class*="tag-text"]');
    if (tagEl) {
      const tag = trim(tagEl.textContent || '');
      if (tag && tag.length < 40) parts.push(`Tag: ${tag}`);
    }
    return parts;
  }

  function getGreenhouseJobPostingInfo() {
    if (!document.querySelector('.job__description, main.job-post, .job-post-container')) return {};
    const job_title = findGreenhousePostingTitle();
    const company_name = resolveGreenhouseCompanyName();
    let job_description = extractGreenhouseJobDescription(document);
    if (!job_description) {
      const jsonLd = readJobPostingJsonLd();
      if (jsonLd?.description) job_description = htmlDescriptionToText(jsonLd.description);
    }
    const metaParts = getGreenhousePostingMetaParts();
    if (metaParts.length && job_description) {
      job_description = `${metaParts.join('\n')}\n\n${job_description}`;
    } else if (metaParts.length) {
      job_description = metaParts.join('\n');
    }
    return { job_title, company_name, job_description };
  }

  function isSmartRecruitersHost() {
    const host = location.hostname.toLowerCase();
    return host.includes('smartrecruiters.com') || isSmartRecruitersPageContext();
  }

  function isSmartRecruitersPageContext() {
    return Boolean(
      document.querySelector('main.jobad-main, .jobad-container, h1.job-title[itemprop="title"], .job-section[id^="st-"]')
    );
  }

  function parseSmartRecruitersCompanyFromPath() {
    const pathMatch = /^\/([^/]+)\//i.exec(location.pathname);
    if (!pathMatch?.[1]) return '';
    let slug = decodeURIComponent(pathMatch[1]).replace(/[-_+]+/g, ' ');
    slug = slug.replace(/\d+$/i, '').trim();
    if (!slug) return '';
    return cleanCompany(slug.replace(/\b\w/g, (c) => c.toUpperCase()));
  }

  function resolveSmartRecruitersCompanyName() {
    const orgMeta = document.querySelector('[itemprop="hiringOrganization"] meta[itemprop="name"]');
    if (orgMeta) {
      const fromOrg = cleanCompany(trim(orgMeta.getAttribute('content') || ''));
      if (fromOrg) return fromOrg;
    }
    const logoAlt = document.querySelector(
      '.jobad-header .header-logo img[alt], .header-logo img[alt], .jobad-header img[alt]'
    )?.getAttribute('alt') || '';
    if (logoAlt) {
      const fromAlt = cleanCompany(trim(logoAlt.replace(/\s*logo\s*$/i, '')));
      if (fromAlt) return fromAlt;
    }
    const logoTitle = document.querySelector('.header-logo a[title], .jobad-header a[title]')?.getAttribute('title');
    if (logoTitle) {
      const fromTitle = cleanCompany(trim(logoTitle));
      if (fromTitle) return fromTitle;
    }
    const jsonLd = readJobPostingJsonLd();
    const fromJson = cleanCompany(jsonLd?.hiringOrganization?.name || jsonLd?.hiringOrganization);
    if (fromJson) return fromJson;
    const fromPath = parseSmartRecruitersCompanyFromPath();
    if (fromPath) return fromPath;
    const fromPageTitle = cleanCompany(parseCompanyFromTitle(document.title));
    if (fromPageTitle) return fromPageTitle;
    const m = /\/company\/([^/]+)/i.exec(location.pathname);
    if (m) {
      return decodeURIComponent(m[1]).replace(/[-_+]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return '';
  }

  function findSmartRecruitersPostingTitle() {
    const titleEl = document.querySelector(
      'h1.job-title[itemprop="title"], main.jobad-main h1.job-title, h1[itemprop="title"], h1.job-title'
    );
    if (titleEl) {
      const title = cleanTitle(trim(titleEl.textContent || ''));
      if (title) return title;
    }
    const jsonLd = readJobPostingJsonLd();
    if (jsonLd?.title) {
      const fromJson = cleanTitle(trim(jsonLd.title));
      if (fromJson) return fromJson;
    }
    return '';
  }

  function getSmartRecruitersPostingMetaParts() {
    const parts = [];
    const splLoc = document.querySelector('spl-job-location[formattedaddress], spl-job-location');
    if (splLoc) {
      const address = trim(splLoc.getAttribute('formattedaddress') || '');
      const workplaceType = trim(splLoc.getAttribute('workplacetype') || '');
      const workplaceDesc = trim(splLoc.getAttribute('workplacedescription') || '');
      if (address) {
        let locationLine = `Location: ${address}`;
        if (workplaceType === 'remote' || /remote/i.test(workplaceDesc)) {
          locationLine += workplaceDesc ? ` (${workplaceDesc})` : ' (Remote)';
        } else if (workplaceType) {
          locationLine += ` (${workplaceType})`;
        }
        parts.push(locationLine);
      } else if (workplaceType === 'remote' || workplaceDesc) {
        parts.push(`Workplace: ${workplaceDesc || 'Remote'}`);
      }
    }
    if (!parts.length) {
      const locality = document.querySelector('[itemprop="addressLocality"]')?.getAttribute('content') || '';
      const region = document.querySelector('[itemprop="addressRegion"]')?.getAttribute('content') || '';
      const country = document.querySelector('[itemprop="addressCountry"]')?.getAttribute('content') || '';
      const locationBits = [locality, region, country].map(trim).filter(Boolean);
      if (locationBits.length) parts.push(`Location: ${locationBits.join(', ')}`);
    }
    const employment = document.querySelector(
      '.job-details [itemprop="employmentType"], li[itemprop="employmentType"], .job-details .job-detail[itemprop="employmentType"]'
    );
    if (employment) {
      const value = trim(employment.textContent || employment.getAttribute('content') || '');
      if (value) parts.push(`Employment type: ${value}`);
    }
    document.querySelectorAll('.job-details > li, .job-details .job-detail').forEach((el) => {
      if (el.matches('[itemprop="jobLocation"], [itemprop="employmentType"]') || el.querySelector('[itemprop="jobLocation"]')) return;
      const value = trim(el.textContent || '');
      if (!value || value.length > 120) return;
      if (/^business unit/i.test(value)) {
        parts.push(`Department: ${value.replace(/^business unit\s*\(internal\):\s*/i, '').trim() || value}`);
      } else if (!parts.some((part) => part.includes(value))) {
        parts.push(`Detail: ${value}`);
      }
    });
    return parts.slice(0, 4);
  }

  function getSmartRecruitersJobPostingInfo() {
    if (!document.querySelector('main.jobad-main, .jobad-container, [itemprop="description"], .job-section[id^="st-"]')) {
      return {};
    }
    const job_title = findSmartRecruitersPostingTitle();
    const company_name = resolveSmartRecruitersCompanyName();
    let job_description = extractSmartRecruitersJobDescription(document);
    if (!job_description) {
      const jsonLd = readJobPostingJsonLd();
      if (jsonLd?.description) job_description = htmlDescriptionToText(jsonLd.description);
    }
    const metaParts = getSmartRecruitersPostingMetaParts();
    if (metaParts.length && job_description) {
      job_description = `${metaParts.join('\n')}\n\n${job_description}`;
    } else if (metaParts.length) {
      job_description = metaParts.join('\n');
    }
    return { job_title, company_name, job_description };
  }

  function resolveAshbyCompanyName() {
    const companySelectors = [
      '.ashby-job-posting-header [class*="navLogoText" i]',
      '.ashby-job-posting-header a[class*="navLogoLink" i]',
      '[class*="navLogoText" i]',
      'a[class*="navLogoLink" i] p',
      '[class*="company-name" i]',
      '[class*="CompanyName" i]',
      'header [class*="company" i] a',
      'header a[href*="ashbyhq.com"]'
    ];
    for (const selector of companySelectors) {
      const companyEl = document.querySelector(selector);
      if (!companyEl) continue;
      const fromEl = cleanCompany(trim(companyEl.textContent || companyEl.getAttribute('title') || ''));
      if (fromEl) return fromEl;
    }
    const ogSite = document.querySelector('meta[property="og:site_name"]');
    if (ogSite) {
      const fromOg = cleanCompany(trim(ogSite.getAttribute('content') || ''));
      if (fromOg && !/^ashby$/i.test(fromOg)) return fromOg;
    }
    const jsonLd = readJobPostingJsonLd();
    const fromJson = cleanCompany(jsonLd?.hiringOrganization?.name || jsonLd?.hiringOrganization);
    if (fromJson) return fromJson;
    const fromTitle = cleanCompany(parseCompanyFromTitle(document.title));
    if (fromTitle) return fromTitle;
    const m = /(?:jobs\.)?ashbyhq\.com\/([^/]+)/i.exec(location.href);
    if (m) {
      return decodeURIComponent(m[1]).replace(/[-_+]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return '';
  }

  function findAshbyPostingTitle() {
    const titleEl = document.querySelector(
      'h1.ashby-job-posting-heading, [class*="titles" i] h1.ashby-job-posting-heading, [class*="job-posting-heading" i], [class*="posting-title" i], [class*="JobPostingTitle" i]'
    );
    if (titleEl && !titleEl.closest('#overview, [role="tabpanel"], form, [class*="application-form" i], [class*="descriptionText" i], .ashby-job-posting-description')) {
      const fromHeading = cleanTitle(trim(titleEl.textContent || ''));
      if (fromHeading) return fromHeading;
    }
    for (const h1 of document.querySelectorAll('[class*="titles" i] h1, main h1, [role="main"] h1, h1')) {
      if (h1.closest('#overview, form, [class*="application-form" i], [class*="descriptionText" i], .ashby-job-posting-description')) continue;
      const title = cleanTitle(trim(h1.textContent || ''));
      if (title && title.length < 220) return title;
    }
    return '';
  }

  function getAshbyPostingMetaParts() {
    const parts = [];
    const leftPane = document.querySelector(
      '.ashby-job-posting-left-pane, [class*="ashby-job-posting-left-pane"], [class*="job-posting-left-pane" i]'
    );
    if (leftPane) {
      leftPane.querySelectorAll('[class*="_section_" i], [class*="section" i]').forEach((section) => {
        const heading = section.querySelector('h2, [class*="heading" i]');
        const valueEl = section.querySelector('p, dd, li:last-child');
        if (!heading || !valueEl) return;
        const label = trim(heading.textContent || '').replace(/:$/, '');
        const value = trim(valueEl.textContent || '');
        if (!label || !value || value.length > 120) return;
        const line = `${label}: ${value}`;
        if (!parts.includes(line)) parts.push(line);
      });
      if (parts.length) return parts;
    }
    document.querySelectorAll('.ashby-job-posting-left-pane [class*="heading" i]').forEach((heading) => {
      const label = trim(heading.textContent || '').replace(/:$/, '');
      const valueEl = heading.nextElementSibling;
      const value = trim(valueEl?.textContent || '');
      if (label && value && value.length < 120) {
        const line = `${label}: ${value}`;
        if (!parts.includes(line)) parts.push(line);
      }
    });
    if (parts.length) return parts;
    document.querySelectorAll('[class*="location" i], [class*="Location" i]').forEach((el) => {
      if (el.closest('#overview, form, [class*="application-form" i], [class*="descriptionText" i], .ashby-job-posting-description')) return;
      const value = trim(el.textContent || '');
      if (value && value.length < 120 && !parts.some((part) => part.includes(value))) {
        parts.push(`Location: ${value}`);
      }
    });
    return parts.slice(0, 4);
  }

  function getAshbyJobPostingInfo() {
    if (!document.querySelector(
      '#overview[role="tabpanel"], [role="tabpanel"][aria-labelledby="job-overview"], [class*="descriptionText"], .ashby-job-posting-description, .ashby-job-posting-heading'
    )) {
      return {};
    }
    const job_title = findAshbyPostingTitle();
    const company_name = resolveAshbyCompanyName();
    let job_description = extractAshbyJobDescription(document);
    if (!job_description) {
      const jsonLd = readJobPostingJsonLd();
      if (jsonLd?.description) job_description = htmlDescriptionToText(jsonLd.description);
    }
    const metaParts = getAshbyPostingMetaParts();
    if (metaParts.length && job_description) {
      job_description = `${metaParts.join('\n')}\n\n${job_description}`;
    } else if (metaParts.length) {
      job_description = metaParts.join('\n');
    }
    return { job_title, company_name, job_description };
  }

  function isBamboohrHost() {
    const host = location.hostname.toLowerCase();
    return host === 'bamboohr.com' || host.endsWith('.bamboohr.com');
  }

  function resolveBamboohrCompanyName() {
    const jsonLd = readJobPostingJsonLd();
    const fromJson = cleanCompany(jsonLd?.hiringOrganization?.name || jsonLd?.hiringOrganization);
    if (fromJson) return fromJson;
    const identifierName = cleanCompany(jsonLd?.identifier?.name);
    if (identifierName) return identifierName;
    const logoAlt = document.querySelector('img[alt][src*="bamboohr.com"]')?.getAttribute('alt') || '';
    if (logoAlt) {
      const fromAlt = cleanCompany(trim(logoAlt.replace(/\s*logo\s*$/i, '')));
      if (fromAlt) return fromAlt;
    }
    const fromTitle = cleanCompany(parseCompanyFromTitle(document.title));
    if (fromTitle) return fromTitle;
    const host = location.hostname.toLowerCase();
    const sub = host.endsWith('.bamboohr.com') ? host.slice(0, -'.bamboohr.com'.length) : '';
    if (sub && sub !== 'www') {
      return sub.replace(/[-_+]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return '';
  }

  function findBamboohrPostingTitle() {
    const titleEl = document.querySelector(
      'h3[data-fabric-component="Headline"], [data-fabric-component="Headline"]'
    );
    if (titleEl) {
      const title = cleanTitle(trim(titleEl.textContent || ''));
      if (title) return title;
    }
    const jsonLd = readJobPostingJsonLd();
    if (jsonLd?.title) {
      const fromJson = cleanTitle(trim(jsonLd.title));
      if (fromJson) return fromJson;
    }
    return '';
  }

  function getBamboohrPostingMetaParts() {
    const parts = [];
    const headline = document.querySelector('[data-fabric-component="Headline"]');
    const summaryEl = headline?.parentElement?.querySelector('[class*="-description"]');
    if (summaryEl && !summaryEl.closest('.BambooRichText')) {
      const summary = trim(summaryEl.textContent || '');
      if (summary) parts.push(`Details: ${summary}`);
    }
    document.querySelectorAll('[data-fabric-component="Flex"]').forEach((row) => {
      const boxes = row.querySelectorAll(':scope > [data-fabric-component="LayoutBox"]');
      if (boxes.length < 2) return;
      const label = trim(boxes[0].querySelector('[data-fabric-component="BodyText"]')?.textContent || '');
      const value = trim(boxes[1].querySelector('[data-fabric-component="BodyText"]')?.textContent || '');
      if (!label || !value || label.length > 50) return;
      if (/^(location|department|employment type|minimum experience|compensation)$/i.test(label)) {
        parts.push(`${label}: ${value}`);
      }
    });
    const jsonLd = readJobPostingJsonLd();
    if (jsonLd?.employmentType && !parts.some((part) => /employment type/i.test(part))) {
      parts.push(`Employment type: ${jsonLd.employmentType}`);
    }
    return [...new Set(parts)];
  }

  function getBamboohrJobPostingInfo() {
    if (!document.querySelector('.BambooRichText, [data-fabric-component="Headline"]')) {
      return {};
    }
    const job_title = findBamboohrPostingTitle();
    const company_name = resolveBamboohrCompanyName();
    let job_description = extractBamboohrJobDescription(document);
    if (!job_description) {
      const jsonLd = readJobPostingJsonLd();
      if (jsonLd?.description) job_description = htmlDescriptionToText(jsonLd.description);
    }
    const metaParts = getBamboohrPostingMetaParts();
    if (metaParts.length && job_description) {
      job_description = `${metaParts.join('\n')}\n\n${job_description}`;
    } else if (metaParts.length) {
      job_description = metaParts.join('\n');
    }
    return { job_title, company_name, job_description };
  }

  function isWorkdayFormContext() {
    if (activeAdapter?.name === 'workday') return true;
    if (isWorkdayHost()) return true;
    return Boolean(document.querySelector(
      '[data-automation-id="applyFlowPage"], [data-automation-id="applyFlowMyInfoPage"], [data-automation-id^="formField-"]'
    ));
  }

  function getWorkdayFormFieldRoot(el) {
    return el?.closest('[data-automation-id^="formField-"]');
  }

  function getWorkdayFieldToken(el) {
    const root = getWorkdayFormFieldRoot(el);
    if (!root) return '';
    const aid = root.getAttribute('data-automation-id') || '';
    const match = /^formField-(.+)$/i.exec(aid);
    return match ? match[1] : '';
  }

  function normalizeWorkdayKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  const WORKDAY_TOKEN_CATEGORY = {
    legalnamefirstname: 'first_name',
    legalnamelastname: 'last_name',
    addressline1: 'address',
    addressline2: 'address',
    city: 'city',
    countryregion: 'state',
    postalcode: 'zip',
    country: 'country',
    phonenumber: 'phone',
    phonetype: 'custom_question',
    extension: 'custom_question',
    source: 'custom_question',
    candidateispreviousworker: 'custom_question',
    countryphonecode: 'country'
  };

  function mapWorkdayTokenToCategory(tokenOrName, el) {
    const parts = [
      getWorkdayFieldToken(el),
      tokenOrName,
      el?.getAttribute('id'),
      el?.getAttribute('name')
    ].filter(Boolean);
    for (const part of parts) {
      const key = normalizeWorkdayKey(part);
      if (WORKDAY_TOKEN_CATEGORY[key]) return WORKDAY_TOKEN_CATEGORY[key];
      if (key.includes('firstname')) return 'first_name';
      if (key.includes('lastname')) return 'last_name';
      if (key.includes('addressline1')) return 'address';
      if (key.includes('postalcode')) return 'zip';
      if (key.includes('countryregion')) return 'state';
      if (key.includes('phonenumber') && !key.includes('phonecode') && !key.includes('phonetype')) return 'phone';
      if (key.includes('candidateispreviousworker')) return 'custom_question';
    }
    return null;
  }

  function stripWorkdayLabelText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('abbr, .css-1fc83zd, [class*="required"]').forEach((n) => n.remove());
    return trim(clone.textContent || '');
  }

  function isWorkdayListboxButton(el) {
    return el?.tagName === 'BUTTON' && el.getAttribute('aria-haspopup') === 'listbox';
  }

  function isWorkdayMultiselectInput(el) {
    return Boolean(el?.closest('[data-automation-id="multiSelectContainer"]'));
  }

  function isWorkdayTextInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (!isWorkdayFormContext()) return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'radio' || type === 'checkbox' || type === 'hidden' || type === 'file') return false;
    return Boolean(getWorkdayFormFieldRoot(el) || /\bcss-1ez3yv1\b/.test(el.className || ''));
  }

  function shouldSkipWorkdayScanElement(el) {
    if (!el || activeAdapter?.name !== 'workday') return false;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden') return true;
    const cls = String(el.className || '');
    if (/\bcss-77hcv\b/.test(cls)) return true;
    if (el.closest(
      '[data-automation-id="progressBar"], [data-automation-id="pageFooter"], [data-automation-id="backToJobPosting"], [data-automation-id="jobTitleHeading"]'
    )) return true;
    if (el.getAttribute('data-automation-id') === 'promptIcon') return true;
    if (el.closest('[data-automation-id="DELETE_charm"]')) return true;
    if (el.getAttribute('data-automation-id') === 'phone-sms-opt-in') return true;
    if (el.getAttribute('data-automation-id') === 'phone-terms-and-condition-link') return true;
    if (isWorkdayMultiselectInput(el) && el.closest('[data-automation-id="selectedItemList"]')) return true;
    return false;
  }

  const workdayAdapter = {
    name: 'workday',
    score() {
      let score = 0;
      const host = location.hostname.toLowerCase();
      if (/\.workday\.com$/i.test(host) || host.includes('myworkdayjobs.com')) score += 45;
      if (document.querySelector('[data-automation-id="jobPostingPage"], [data-automation-id="jobPostingDescription"]')) score += 22;
      if (document.querySelector('[data-automation-id="job-posting-details"]')) score += 14;
      if (document.querySelector('[data-automation-id="jobSidebar"], [data-automation-id="sidebar"]')) score += 8;
      if (document.querySelector('[data-automation-id="applyFlowPage"], [data-automation-id="applyFlowMyInfoPage"]')) score += 28;
      if (document.querySelector('[data-automation-id="applyFlow"], [data-automation-id="applyManually"]')) score += 15;
      const wdFields = document.querySelectorAll('[data-automation-id^="formField-"]').length;
      if (wdFields) score += Math.min(25, 8 + wdFields);
      if (countNamedFields((n) => /legalname|addressline|phonenumber|postalcode/i.test(n))) score += 12;
      if (document.querySelector('[data-automation-id="progressBar"]')) score += 8;
      if (isLeverHost() && !wdFields) score -= 40;
      if (countNamedFields((n) => /^job_application\[/i.test(n)) && !wdFields) score -= 35;
      return Math.max(0, score);
    },
    detect() { return workdayAdapter.score() >= ADAPTER_SCORE_THRESHOLD; },
    getScanRoot() {
      return document.querySelector(
        '[data-automation-id="applyFlowPage"], [data-automation-id="applyFlowMyInfoPage"], [data-automation-id="applyFlow"], [data-automation-id="applyManually"]'
      ) || document.querySelector('main form, form');
    },
    getQuestionContainer(el) {
      return getWorkdayFormFieldRoot(el)
        || el.closest('fieldset')
        || el.closest('[role="group"]');
    },
    getQuestionLabel(container, el) {
      if (!container) return null;
      const fieldRoot = getWorkdayFormFieldRoot(el) || container;
      const forId = el?.id || el?.getAttribute('id');
      if (forId) {
        const byFor = fieldRoot.querySelector(`label[for="${cssEscape(forId)}"]`);
        if (byFor) return byFor;
      }
      const label = fieldRoot.querySelector('label.css-1ud5i8o, label');
      if (label && stripWorkdayLabelText(label)) return label;
      const legend = fieldRoot.querySelector('legend');
      if (legend) return legend;
      return null;
    },
    getJobInfo() {
      return getWorkdayJobPostingInfo();
    },
    mapNameToCategory(nameAttr, el) {
      return mapWorkdayTokenToCategory(nameAttr, el);
    },
    mapIdToCategory(idAttr, el) {
      const fr = fieldRegistry();
      if (fr) {
        const fromRegistry = fr.matchByPlatformId('workday', idAttr);
        if (fromRegistry) return fromRegistry.category;
        const fromToken = fr.matchByPlatformId('workday', getWorkdayFieldToken(el));
        if (fromToken) return fromToken.category;
      }
      return mapWorkdayTokenToCategory(idAttr, el);
    },
    resolveFieldCategory(el, questionText) {
      const fromToken = mapWorkdayTokenToCategory(null, el);
      if (fromToken) {
        const token = normalizeWorkdayKey(getWorkdayFieldToken(el));
        if (token.includes('candidateispreviousworker')) {
          return { category: 'custom_question', confidence: 0.92, suggestedDefault: 'No' };
        }
        if (token.includes('phonetype')) {
          return { category: 'custom_question', confidence: 0.88, suggestedDefault: 'Mobile' };
        }
        return { category: fromToken, confidence: 0.95 };
      }
      const fr = fieldRegistry();
      if (!fr) return null;
      return fr.resolveFieldCategory({
        platform: 'workday',
        labelText: questionText,
        nameAttr: el?.getAttribute('name'),
        idAttr: el?.getAttribute('id') || getWorkdayFieldToken(el)
      });
    }
  };

  const RIPPLING_SKIP_TESTIDS = new Set([
    'field',
    'select-controller',
    'select-search-input',
    'screen-reader-only',
    'ButtonGroup',
    'VStack',
    'test_button',
    'Apply',
    'typography-br',
    'turnstile-container'
  ]);

  const RIPPLING_GENERIC_INPUT_TOKENS = new Set([
    'select-search-input',
    'undefined',
    'externalplaceid'
  ]);

  const RIPPLING_SKIP_FIELD_TOKENS = new Set([
    'phone_number-code',
    'turnstile-required',
    'aioptout',
    'sms_opt_in'
  ]);

  function walkRipplingFieldToken(el) {
    let node = el && el.parentElement;
    for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
      const tid = node.getAttribute && node.getAttribute('data-testid');
      if (!tid) continue;
      const norm = normalizeRipplingFieldToken(tid);
      if (RIPPLING_SKIP_TESTIDS.has(norm) || norm === 'field') continue;
      if (norm.startsWith('input-')) {
        const stripped = norm.slice('input-'.length);
        if (RIPPLING_GENERIC_INPUT_TOKENS.has(stripped) || RIPPLING_SKIP_FIELD_TOKENS.has(stripped)) continue;
        return stripped;
      }
      if (RIPPLING_GENERIC_INPUT_TOKENS.has(norm) || RIPPLING_SKIP_FIELD_TOKENS.has(norm)) continue;
      return norm;
    }
    return '';
  }

  function isRipplingHost() {
    const host = location.hostname.toLowerCase();
    return host.includes('rippling.com') || isRipplingPageContext();
  }

  function normalizeRipplingFieldToken(token) {
    return String(token || '').trim().toLowerCase();
  }

  const ripplingAdapter = {
    name: 'rippling',
    score() {
      let score = 0;
      if (isRipplingHost()) score += 45;
      const hasRipplingForm = Boolean(
        document.querySelector('form [data-testid="input-first_name"], form [data-testid="first_name"]')
        && document.querySelector('[data-testid="field"]')
      );
      if (hasRipplingForm) score += isRipplingHost() ? 15 : 48;
      const ripplingInputs = document.querySelectorAll(
        '[data-testid^="input-"], [data-testid="select-controller"], [data-testid="first_name"]'
      ).length;
      if (ripplingInputs) score += Math.min(40, 12 + ripplingInputs * 2);
      if (document.querySelector('[data-testid="Apply"], button[data-testid="Apply"]')) score += 12;
      if (document.querySelector('.ATS_htmlPreview')) score += 32;
      if (document.querySelector('[data-testid="breadcrumb"]')) score += 14;
      if (document.querySelector('button[data-testid="Apply now"]')) score += 10;
      if (document.querySelector('img[src*="ripplingcdn" i]')) score += 12;
      if (isRipplingPageContext()) score += 18;
      const appTitle = document.querySelector('form h4, h4');
      if (appTitle && /application\s*:/i.test(appTitle.textContent || '')) score += 10;
      if (document.querySelector('[data-testid="resume"], [data-testid="input-resume"]')) score += 8;
      if (countNamedFields((n) => /^job_application\[/i.test(n))) score -= 35;
      if (document.querySelector('#application-form, #application_form')) score -= 20;
      return Math.max(0, score);
    },
    detect() { return ripplingAdapter.score() >= ADAPTER_SCORE_THRESHOLD; },
    getScanRoot() {
      const forms = document.querySelectorAll('form');
      for (const form of forms) {
        if (form.querySelector('[data-testid="first_name"], [data-testid="input-first_name"], [data-testid="input-email"]')) {
          return form;
        }
      }
      return document.querySelector('form') || null;
    },
    getQuestionContainer(el) {
      return el.closest('[data-testid="field"]');
    },
    getQuestionLabel(container) {
      if (!container) return null;
      const label = container.querySelector('[id$="-label"]');
      if (label && !label.querySelector('input, textarea, select, button')) return label;
      return null;
    },
    getFieldToken(el) {
      if (!el) return '';
      const dataInput = el.getAttribute('data-input');
      if (dataInput) {
        const norm = normalizeRipplingFieldToken(dataInput);
        if (!RIPPLING_GENERIC_INPUT_TOKENS.has(norm) && !RIPPLING_SKIP_FIELD_TOKENS.has(norm)) {
          return norm;
        }
      }
      const directTestId = el.getAttribute('data-testid');
      if (directTestId) {
        const tid = normalizeRipplingFieldToken(directTestId);
        if (tid.startsWith('input-')) {
          const stripped = tid.slice('input-'.length);
          if (!RIPPLING_GENERIC_INPUT_TOKENS.has(stripped) && !RIPPLING_SKIP_FIELD_TOKENS.has(stripped)) {
            return stripped;
          }
        } else if (!RIPPLING_SKIP_TESTIDS.has(tid) && tid !== 'field'
          && !RIPPLING_GENERIC_INPUT_TOKENS.has(tid) && !RIPPLING_SKIP_FIELD_TOKENS.has(tid)) {
          return tid;
        }
      }
      return walkRipplingFieldToken(el);
    },
    mapTokenToCategory(token) {
      const fr = fieldRegistry();
      if (!fr || !token) return null;
      const fromPlatform = fr.matchByPlatformId('rippling', token);
      return fromPlatform ? fromPlatform.category : null;
    },
    mapNameToCategory(nameAttr, el) {
      const token = el ? ripplingAdapter.getFieldToken(el) : '';
      if (token) {
        const cat = ripplingAdapter.mapTokenToCategory(token);
        if (cat) return cat;
      }
      return null;
    },
    mapIdToCategory(idAttr, el) {
      return ripplingAdapter.mapNameToCategory(null, el);
    },
    getJobInfo() {
      if (document.querySelector('.ATS_htmlPreview') || isRipplingPageContext()) {
        const postingInfo = getRipplingJobPostingInfo();
        if (postingInfo.job_title || postingInfo.company_name || postingInfo.job_description) return postingInfo;
      }
      const titleEl = document.querySelector('form h4, h4');
      let job_title = '';
      if (titleEl) {
        const m = /application\s*:\s*(.+)/i.exec(trim(titleEl.textContent || ''));
        job_title = m ? trim(m[1]) : cleanTitle(trim(titleEl.textContent));
      }
      const companyEl = document.querySelector('[class*="company" i], header h1, header h2');
      return {
        job_title,
        company_name: companyEl ? cleanRipplingCompanyLabel(trim(companyEl.textContent)) : resolveRipplingCompanyName()
      };
    },
    isVoluntaryField() {
      return false;
    },
    isRipplingFieldRequired(el) {
      if (!el) return false;
      if (el.getAttribute('aria-required') === 'true') return true;
      const container = ripplingAdapter.getQuestionContainer(el);
      if (!container) return false;
      const requiredInput = container.querySelector('input[aria-required="true"], textarea[aria-required="true"]');
      if (requiredInput) return true;
      const labelWrap = container.querySelector('[class*="eun831x4"]');
      if (labelWrap) {
        for (const span of labelWrap.querySelectorAll('span')) {
          if (trim(span.textContent) === '*') return true;
        }
      }
      return false;
    },
    isOptionalField(el) {
      return !ripplingAdapter.isRipplingFieldRequired(el);
    },
    resolveFieldCategory(el, questionText) {
      const fr = fieldRegistry();
      if (!fr) return null;
      const token = ripplingAdapter.getFieldToken(el);
      if (token) {
        const fromToken = ripplingAdapter.mapTokenToCategory(token);
        if (fromToken) {
          return { category: fromToken, confidence: 0.96, fromTemplate: true };
        }
      }
      return fr.resolveFieldCategory({
        platform: 'rippling',
        labelText: questionText,
        nameAttr: token || (el && el.getAttribute('name')),
        idAttr: el && el.getAttribute('id')
      });
    }
  };

  function isRipplingLocationInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if (!isRipplingFormContext()) return false;
    if (el.closest('[data-testid="location"]')) return true;
    return ripplingAdapter.getFieldToken(el) === 'location';
  }

  function findRipplingComboboxInput(el) {
    if (!el) return null;
    const scope = el.closest('[data-testid="select-controller"], [data-testid^="eeoc."], [data-testid="field"]') || el.parentElement;
    if (!scope) return null;
    const input = scope.querySelector('input[role="combobox"], input[data-testid^="input-select"]');
    return input && isVisible(input) ? input : null;
  }

  const RIPPLING_GENERIC_COMBOBOX_LABEL_RE = /^(search|select|filter|type to search|choose)$/i;

  function isRipplingSelectSearchInput(el) {
    if (!el) return false;
    const dataInput = normalizeRipplingFieldToken(el.getAttribute('data-input') || '');
    if (dataInput === 'select-search-input') return true;
    const testId = normalizeRipplingFieldToken(el.getAttribute('data-testid') || '');
    return testId === 'input-select-search-input' || testId === 'select-search-input';
  }

  function isRipplingInternalSelectSearchInput(el) {
    if (!isRipplingSelectSearchInput(el)) return false;

    const ctrl = el.closest('[data-testid="select-controller"]');
    if (!ctrl) return true;

    const combos = ctrl.querySelectorAll('[role="combobox"]');
    for (const combo of combos) {
      if (combo === el) continue;
      if (combo.tagName !== 'INPUT' && isVisible(combo)) return true;
    }

    const token = ripplingAdapter.getFieldToken(el);
    if (token && ripplingAdapter.mapTokenToCategory(token)) return false;

    const label = stripPlaceholderNoise(trim(getAdapterContainerText(el) || el.getAttribute('placeholder') || ''));
    return RIPPLING_GENERIC_COMBOBOX_LABEL_RE.test(label);
  }

  function shouldSkipRipplingScanElement(el) {
    if (!el || activeAdapter?.name !== 'rippling') return false;
    if (el.type === 'hidden') return true;
    if (isRipplingInternalSelectSearchInput(el)) return true;
    const token = ripplingAdapter.getFieldToken(el);
    if (!token) return false;
    if (RIPPLING_SKIP_FIELD_TOKENS.has(token)) return true;
    if (token === 'externalplaceid' || token === 'turnstile-required' || token === 'aioptout') return true;
    return false;
  }

  const RIPPLING_CATEGORY_INPUT_TOKEN = {
    first_name: 'first_name',
    last_name: 'last_name',
    email: 'email',
    phone: 'phone_number',
    current_company: 'current_company',
    city: 'location',
    linkedin: 'linkedin_link'
  };

  function isRipplingFormContext() {
    if (activeAdapter?.name === 'rippling') return true;
    if (isRipplingHost()) return true;
    return Boolean(
      document.querySelector('form [data-testid="input-first_name"], form [data-testid="first_name"]')
    );
  }

  function findRipplingInputEl(token) {
    if (!token) return null;
    const safe = String(token).replace(/"/g, '\\"');
    const selectors = [
      `[data-testid="input-${safe}"]`,
      `input[data-input="${safe}"]`,
      `[data-testid="${safe}"] input:not([type="hidden"])`
    ];
    for (const selector of selectors) {
      try {
        const node = document.querySelector(selector);
        if (node && node.tagName === 'INPUT' && isVisible(node)) return node;
      } catch (_) {}
    }
    return null;
  }

  function findRipplingInputForCategory(category) {
    const token = RIPPLING_CATEGORY_INPUT_TOKEN[category];
    return token ? findRipplingInputEl(token) : null;
  }

  function ripplingInputValueMatches(el, expected) {
    const current = trim(el?.value || '');
    const exp = trim(expected || '');
    if (!current || !exp) return false;
    if (current === exp) return true;
    return current.toLowerCase() === exp.toLowerCase();
  }

  function isRipplingPlaceholderValue(el) {
    const current = trim(el?.value || '').toLowerCase();
    const placeholder = trim(el?.getAttribute('placeholder') || '').toLowerCase();
    return Boolean(placeholder && current === placeholder);
  }

  function setReactControlledInputValue(element, value) {
    const str = String(value ?? '');
    try {
      const tracker = element._valueTracker;
      if (tracker && typeof tracker.setValue === 'function') tracker.setValue('');
    } catch (_) {}

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(element, str);
    else element.value = str;

    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: str,
        inputType: 'insertText'
      }));
    } catch (_) {
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function pasteTextIntoInput(el, text) {
    const str = String(text || '');
    el.focus();
    try {
      const tracker = el._valueTracker;
      if (tracker && typeof tracker.setValue === 'function') tracker.setValue('');
    } catch (_) {}
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } catch (_) {}
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', str);
      el.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      }));
    } catch (_) {}
    try {
      document.execCommand('insertText', false, str);
    } catch (_) {}
    try {
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: str,
        inputType: 'insertFromPaste'
      }));
    } catch (_) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await delay(50);
  }

  function isRipplingTextInput(el) {
    if (!el || !isRipplingFormContext()) return false;
    const tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (['file', 'hidden', 'checkbox', 'radio', 'button', 'submit'].includes(type)) return false;
    if (isComboboxLike(el)) return false;
    if (isRipplingLocationInput(el)) return false;
    if (shouldSkipRipplingScanElement(el)) return false;
    return Boolean(
      el.getAttribute('data-input')
      || (el.getAttribute('data-testid') || '').startsWith('input-')
      || el.closest('[data-testid="field"]')
    );
  }

  function isUrlLikeFillValue(value) {
    const fr = fieldRegistry();
    if (fr && typeof fr.looksLikeAbsoluteUrl === 'function') {
      return fr.looksLikeAbsoluteUrl(value);
    }
    return /^https?:\/\//i.test(String(value || '').trim());
  }

  async function fillRipplingTextInput(el, value) {
    const str = String(value || '').trim();
    if (!str) return { success: false, error: 'No value to fill.' };
    const urlLike = isUrlLikeFillValue(str);

    let target = el;
    const token = ripplingAdapter.getFieldToken(el);
    const byToken = token ? findRipplingInputEl(token) : null;
    if (byToken) target = byToken;

    primeAutocompleteInput(target);
    dispatchPointerSequence(target);
    target.focus();
    await delay(30);

    setReactControlledInputValue(target, str);
    await delay(50);

    if (!ripplingInputValueMatches(target, str) || isRipplingPlaceholderValue(target)) {
      await pasteTextIntoInput(target, str);
    }

    if (!urlLike && (!ripplingInputValueMatches(target, str) || isRipplingPlaceholderValue(target))) {
      await insertTextLikeUser(target, str, 10);
      await delay(40);
    }

    if (!ripplingInputValueMatches(target, str) || isRipplingPlaceholderValue(target)) {
      setReactControlledInputValue(target, str);
      await delay(40);
    }

    try {
      target.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      target.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    } catch (_) {
      target.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    if (!ripplingInputValueMatches(target, str) || isRipplingPlaceholderValue(target)) {
      return { success: false, error: 'Rippling did not accept the value (controlled input).' };
    }
    return { success: true };
  }

  function normalizeGreenhouseFieldId(idAttr) {
    return String(idAttr || '').toLowerCase().replace(/-/g, '_');
  }

  function classifyGreenhouseByLabel(label) {
    const L = normalizeText(label);
    if (!L) return null;
    const rules = [
      [/preferred\s+(first\s+)?name/i, 'first_name', 0.93],
      [/^first\s+name$/i, 'first_name', 0.95],
      [/^last\s+name$/i, 'last_name', 0.95],
      [/^email$/i, 'email', 0.96],
      [/^phone$/i, 'phone', 0.92],
      [/location\s*\(\s*city/i, 'city', 0.95],
      [/linkedin\s+profile/i, 'linkedin', 0.94],
      [/^linkedin$/i, 'linkedin', 0.94],
      [/^website$/i, 'portfolio', 0.9],
      [/resume\s*\/?\s*cv/i, 'resume_upload', 0.95],
      [/^cover\s+letter/i, 'cover_letter_upload', 0.95],
      [/authorized to work|legally authorized to work|work authorization/i, 'work_authorization', 0.93],
      [/visa sponsorship|require sponsorship/i, 'sponsorship', 0.93],
      [/desired salary|base salary range|compensation/i, 'salary', 0.88],
      [/willing to relocate|relocation/i, 'relocation', 0.86],
      [/years of experience|how many years/i, 'experience_years', 0.86],
      [/notice period|available to start/i, 'notice_period', 0.86]
    ];
    for (const rule of rules) {
      if (rule[0].test(L)) return { category: rule[1], confidence: rule[2] };
    }
    return null;
  }

  function classifyGreenhouseField(el, questionText) {
    const id = normalizeGreenhouseFieldId(el.getAttribute('id'));
    if (id === 'country' && el.closest('.phone-input, fieldset.phone-input')) {
      return { skip: true };
    }

    const fr = fieldRegistry();
    if (fr) {
      const resolved = fr.resolveFieldCategory({
        platform: 'greenhouse',
        idAttr: el.getAttribute('id'),
        nameAttr: el.getAttribute('name'),
        labelText: questionText
      });
      if (resolved) {
        return { category: resolved.category, confidence: resolved.confidence || 0.95, fromTemplate: true };
      }
    }

    const fromId = greenhouseAdapter.mapIdToCategory(el.getAttribute('id'));
    if (fromId) {
      return { category: fromId, confidence: 0.95, fromTemplate: true };
    }

    if (/^question_\d+$/.test(id)) {
      const fromLabel = classifyGreenhouseByLabel(questionText);
      if (fromLabel) {
        return { category: fromLabel.category, confidence: fromLabel.confidence, fromTemplate: true };
      }
    }

    const fromLabel = classifyGreenhouseByLabel(questionText);
    if (fromLabel) {
      return { category: fromLabel.category, confidence: fromLabel.confidence, fromTemplate: true };
    }

    return null;
  }

  function stripLeverLabelText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.required, [class*="required"], .description').forEach((n) => n.remove());
    return trim(clone.textContent || '');
  }

  function isLeverHost() {
    const host = location.hostname.toLowerCase();
    return host === 'jobs.lever.co' || /^[a-z0-9][-a-z0-9]*\.lever\.co$/i.test(host);
  }

  function isAshbyHost() {
    const host = location.hostname.toLowerCase();
    return host === 'ashbyhq.com' || host.endsWith('.ashbyhq.com');
  }

  function isAshbyFormContext() {
    if (activeAdapter?.name === 'ashby') return true;
    if (!isAshbyHost()) return false;
    return Boolean(
      document.querySelector(
        '#form, .ashby-application-form-container, [class*="ashby-application-form" i], [data-field-path]'
      )
    );
  }

  function getAshbyFieldPath(el) {
    if (!el) return '';
    const host = el.closest('[data-field-path]');
    return host ? String(host.getAttribute('data-field-path') || '') : '';
  }

  function mapAshbyFieldToken(token) {
    if (!token) return null;
    const key = String(token).toLowerCase().replace(/^_systemfield_/, '');
    const table = {
      name: 'full_name',
      full_name: 'full_name',
      first_name: 'first_name',
      last_name: 'last_name',
      email: 'email',
      phone: 'phone',
      location: 'city',
      city: 'city',
      resume: 'resume_upload',
      cover_letter: 'cover_letter_upload',
      coverletter: 'cover_letter_upload',
      linkedin: 'linkedin',
      linkedinurl: 'linkedin',
      github: 'github',
      githuburl: 'github',
      website: 'portfolio',
      portfolio: 'portfolio',
      personalwebsite: 'portfolio',
      eeoc_gender: 'gender',
      eeoc_race: 'race',
      eeoc_veteran_status: 'veteran_status',
      eeoc_disability_status: 'disability_status'
    };
    return table[key] || null;
  }

  function mapAshbyFieldPath(path) {
    if (!path) return null;
    return mapAshbyFieldToken(path);
  }

  function shouldSkipAshbyScanElement(el) {
    if (!el || activeAdapter?.name !== 'ashby') return false;
    if (el.closest('.ashby-application-form-autofill-uploader, [class*="autofill-uploader" i], [class*="autofill-input-root" i]')) {
      return true;
    }
    const path = getAshbyFieldPath(el);
    if (path && path.includes('autofill')) return true;
    return false;
  }

  function isAshbyYesNoField(el) {
    if (!el || !isAshbyFormContext()) return false;
    return Boolean(el.closest('[class*="yesno" i], [class*="_yesno_" i]'));
  }

  function getAshbyYesNoOptions(el) {
    const entry = el?.closest('.ashby-application-form-field-entry, [data-field-path]');
    if (!entry) return [];
    const buttons = Array.from(entry.querySelectorAll('button')).filter((btn) => {
      const text = trim(btn.textContent || '');
      return text && isVisible(btn) && !/upload|replace|delete/i.test(text);
    });
    return buttons.map((btn) => trim(btn.textContent || '')).filter(Boolean);
  }

  function fillAshbyYesNo(el, value, category, threshold) {
    const cutoff = typeof threshold === 'number' ? threshold : 0.45;
    const normalized = normalizeDemographicFillValue(category, coerceSingleProfileValue(value));
    const options = getAshbyYesNoOptions(el);
    const entry = el.closest('.ashby-application-form-field-entry, [data-field-path]');
    const buttons = entry
      ? Array.from(entry.querySelectorAll('button')).filter((btn) => trim(btn.textContent || '') && isVisible(btn))
      : [];
    if (!buttons.length && options.length) {
      return { success: false, error: 'Ashby yes/no buttons not found.' };
    }
    let best = null;
    let bestScore = 0;
    for (const btn of buttons) {
      const text = trim(btn.textContent || '');
      const score = Math.max(
        scoreOptionAgainstTarget(text, normalized, category),
        scoreOptionAgainstTarget(text, value, category)
      );
      if (score > bestScore) {
        best = btn;
        bestScore = score;
      }
    }
    if (!best || bestScore < cutoff) {
      return { success: false, error: 'No matching Ashby yes/no option.' };
    }
    dispatchPointerSequence(best);
    return { success: true };
  }

  function findAshbyKitFileInput(category) {
    if (!isAshbyFormContext() || !category) return null;
    const root = document.querySelector(
      '#form, .ashby-application-form-container, .ashby-application-form-container, main form'
    ) || document;

    if (category === 'resume_upload') {
      const resume = root.querySelector(
        'input[type="file"][id="_systemfield_resume"], [data-field-path="_systemfield_resume"] input[type="file"]'
      );
      if (resume && !resume.closest('.ashby-application-form-autofill-uploader, [class*="autofill-uploader" i]')) {
        return resume;
      }
    }

    if (category === 'cover_letter_upload') {
      const candidates = root.querySelectorAll('input[type="file"]');
      for (const input of candidates) {
        if (input.closest('.ashby-application-form-autofill-uploader, [class*="autofill-uploader" i]')) continue;
        const path = getAshbyFieldPath(input);
        const hint = `${path} ${getQuestionText(input)}`.toLowerCase();
        if (path === '_systemfield_cover_letter' || /cover[\s_-]*letter|additional attachment/.test(hint)) {
          return input;
        }
      }
    }
    return null;
  }

  function isAshbyFileInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if ((el.getAttribute('type') || '').toLowerCase() !== 'file') return false;
    if (!isAshbyFormContext()) return false;
    if (el.closest('.ashby-application-form-autofill-uploader, [class*="autofill-uploader" i]')) return false;
    const path = getAshbyFieldPath(el);
    if (path === '_systemfield_resume') return true;
    const id = (el.getAttribute('id') || '').toLowerCase();
    if (id === '_systemfield_resume') return true;
    return Boolean(el.closest('.ashby-application-form-field-entry, [data-field-path]'));
  }

  function ashbyUploadAppearsComplete(el, fileName) {
    if (el?.files?.length) return true;
    const entry = el?.closest('.ashby-application-form-field-entry, [data-field-path]');
    if (!entry) return false;
    const base = String(fileName || '').replace(/\.[^.]+$/, '').toLowerCase();
    if (base.length >= 2 && (entry.textContent || '').toLowerCase().includes(base)) return true;
    if (entry.querySelector('[class*="file" i] [class*="name" i], [class*="_file_" i]')) return true;
    return false;
  }

  async function fillAshbyFileInput(el, uploadFile, category) {
    if (!uploadFile?.dataUrl) {
      return { success: false, error: 'No file attached for upload.' };
    }
    const file = dataUrlToFile(uploadFile.dataUrl, uploadFile.name, uploadFile.type);
    if (!file) return { success: false, error: 'Could not decode file from kit storage.' };

    let target = el;
    if (!isAshbyFileInput(target)) {
      target = findAshbyKitFileInput(category) || findKitFileInput(el, category);
    }
    if (!target) {
      return { success: false, error: 'Could not find Ashby file upload input.' };
    }

    const accept = target.getAttribute('accept') || '';
    if (!fileMatchesAccept(file, accept)) {
      return {
        success: false,
        error: `Kit file "${file.name}" does not match accept="${accept || 'any'}".`
      };
    }

    try {
      try { target.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
      assignFilesToInput(target, [file]);
      dispatchFileInputEvents(target);
      await delay(150);
      if (target.files?.length || ashbyUploadAppearsComplete(target, file.name)) {
        return { success: true, fileName: file.name };
      }
      return {
        success: false,
        error: 'Could not attach file on Ashby. Try uploading once manually, then fill again.'
      };
    } catch (err) {
      return { success: false, error: err.message || 'Ashby file upload failed.' };
    }
  }

  const LEVER_QA_CATEGORY = {
    'input-resume': 'resume_upload',
    'name-input': 'full_name',
    'email-input': 'email',
    'phone-input': 'phone',
    'location-input': 'city',
    'org-input': 'current_company',
    'application-file-upload': 'cover_letter_upload'
  };

  function getLeverCardSectionName(el) {
    const section = el?.closest('[data-qa="additional-cards"]');
    if (!section) return '';
    return trim(section.querySelector('[data-qa="card-name"]')?.textContent || '');
  }

  function parseLeverEmploymentField(el, questionText) {
    const card = normalizeText(getLeverCardSectionName(el));
    if (!card.includes('employment')) return null;
    const raw = String(questionText || '');
    const L = normalizeText(raw);
    let slot = 0;
    const num = /^\s*(\d+)\s*\.\s*/.exec(raw) || /\b(\d+)\s*\.\s*employer/i.exec(raw);
    if (num) slot = Math.max(0, parseInt(num[1], 10) - 1);

    if (/provide your employment history|five employers|fill what you can/i.test(L)) {
      return { employmentSlot: slot, employmentKey: 'intro', category: 'acknowledgment' };
    }
    if (/^job title$/.test(L) || (L.includes('job title') && !L.includes('employer'))) {
      return { employmentSlot: slot, employmentKey: 'job_title', category: 'employment_kit' };
    }
    const rules = [
      [/employer name/, 'employer_name'],
      [/employer phone/, 'employer_phone'],
      [/is this your current employer/, 'is_current'],
      [/employer location/, 'employer_location'],
      [/employment start date/, 'start_date'],
      [/employment end date/, 'end_date'],
      [/summarize the nature|job responsibilities|responsibilities performed/, 'responsibilities'],
      [/reason for leaving/, 'reason_for_leaving']
    ];
    for (const [pattern, key] of rules) {
      if (pattern.test(L)) {
        return { employmentSlot: slot, employmentKey: key, category: 'employment_kit' };
      }
    }
    return null;
  }

  function isLeverFormContext() {
    if (activeAdapter?.name === 'lever') return true;
    if (isLeverHost()) return true;
    return Boolean(document.querySelector('#application-form.application-form, form#application-form'));
  }

  function shouldSkipLeverScanElement(el) {
    if (!el || activeAdapter?.name !== 'lever') return false;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'hidden') return true;
    const name = (el.getAttribute('name') || '').toLowerCase();
    const id = (el.getAttribute('id') || '').toLowerCase();
    if (/\[basetemplate\]$/i.test(name)) return true;
    if (name === 'selectedlocation' || id === 'selected-location') return true;
    if (/^(accountid|linkedinadata|origin|referer|timezone|socialreferralkey|socialsource|resumestorageid|source|h-captcha-response)$/i.test(name)) {
      return true;
    }
    if (id === 'hcaptcharesponseinput' || id === 'applicant-timezone') return true;
    return false;
  }

  function findLeverKitFileInput(category) {
    if (!isLeverFormContext() || !category) return null;
    const root = document.querySelector('#application-form, form#application-form') || document;
    if (category === 'resume_upload') {
      return root.querySelector(
        'input[data-qa="input-resume"], #resume-upload-input, li.application-question.resume input[type="file"], input.application-file-input[name="resume"]'
      );
    }
    if (category === 'cover_letter_upload') {
      const inputs = root.querySelectorAll('input[data-qa="application-file-upload"], input.application-file-input[type="file"]');
      for (const input of inputs) {
        if (input.getAttribute('data-qa') === 'application-file-upload') return input;
        const hint = `${getQuestionText(input)} ${input.closest('[data-qa="additional-cards"]')?.querySelector('[data-qa="card-name"]')?.textContent || ''}`.toLowerCase();
        if (/cover\s*letter/.test(hint)) return input;
      }
      return inputs[0] || null;
    }
    return null;
  }

  function isLeverFileInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if ((el.getAttribute('type') || '').toLowerCase() !== 'file') return false;
    if (!isLeverFormContext()) return false;
    const qa = el.getAttribute('data-qa') || '';
    if (qa === 'input-resume' || qa === 'application-file-upload') return true;
    if (el.id === 'resume-upload-input' || el.name === 'resume') return true;
    return Boolean(el.classList.contains('application-file-input') && el.closest('#application-form, form#application-form'));
  }

  function leverUploadAppearsComplete(el, fileName) {
    if (el?.files?.length) return true;
    const zone = el?.closest('li.application-question, .application-question');
    if (!zone) return false;
    const fname = zone.querySelector('.filename');
    if (fname && trim(fname.textContent)) return true;
    if (zone.querySelector('.resume-upload-success')) return true;
    const defaultLabel = zone.querySelector('.default-label');
    if (defaultLabel && !/attach|upload file|drop/i.test(trim(defaultLabel.textContent || ''))) return true;
    const base = String(fileName || '').replace(/\.[^.]+$/, '').toLowerCase();
    if (base.length >= 2 && (zone.textContent || '').toLowerCase().includes(base)) return true;
    return false;
  }

  async function fillLeverFileInput(el, uploadFile) {
    if (!uploadFile?.dataUrl) {
      return { success: false, error: 'No file attached for upload.' };
    }
    const file = dataUrlToFile(uploadFile.dataUrl, uploadFile.name, uploadFile.type);
    if (!file) return { success: false, error: 'Could not decode file from kit storage.' };

    let target = el;
    if (!isLeverFileInput(target)) {
      const kind = (target?.getAttribute('data-qa') === 'application-file-upload') ? 'cover_letter_upload' : 'resume_upload';
      target = findLeverKitFileInput(kind) || target;
    }
    if (!target || target.tagName !== 'INPUT') {
      return { success: false, error: 'Could not find Lever file upload input.' };
    }

    const accept = target.getAttribute('accept') || '';
    if (!fileMatchesAccept(file, accept)) {
      return {
        success: false,
        error: `Kit file "${file.name}" does not match accept="${accept || 'any'}".`
      };
    }

    try {
      try { target.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
      assignFilesToInput(target, [file]);
      dispatchFileInputEvents(target);
      await delay(150);
      if (target.files?.length || leverUploadAppearsComplete(target, file.name)) {
        return { success: true, fileName: file.name };
      }
      return {
        success: false,
        error: 'Could not attach file on Lever. The file input may require a manual attach once.'
      };
    } catch (err) {
      return { success: false, error: err.message || 'Lever file upload failed.' };
    }
  }

  const leverAdapter = {
    name: 'lever',
    score() {
      let score = 0;
      if (isLeverHost()) score += 40;
      if (document.querySelector('.posting-page, .content-wrapper.posting-page, [data-qa="job-description"]')) score += 28;
      if (document.querySelector('#application-form, form#application-form')) score += 20;
      if (document.querySelector('.application-page, .content-wrapper.application-page')) score += 10;
      if (document.querySelector('#application-form .application-question, form#application-form .application-question')) score += 30;
      if (document.querySelector('[data-qa="multiple-choice"], [data-qa="checkboxes"], .application-answer-alternative')) score += 15;
      if (document.querySelector('[data-qa="input-resume"], #resume-upload-input')) score += 12;
      if (document.querySelector('[data-qa="btn-submit"], #btn-submit')) score += 8;
      if (document.querySelector('[data-qa="additional-cards"]')) score += 8;
      const leverNameCount = countNamedFields((n) => /^cards\[[a-f0-9-]{8,}\]\[/i.test(n) || /^surveysresponses\[/i.test(n));
      if (leverNameCount) score += Math.min(20, 5 + leverNameCount * 2);
      const ghFieldCount = countNamedFields((n) => /^job_application\[/i.test(n));
      if (ghFieldCount && !leverNameCount) score -= 35;
      if (countNamedFields((n) => /_systemfield_/i.test(n)) && !leverNameCount) score -= 30;
      if (document.querySelector('[data-testid="field"], form [data-testid="input-first_name"]')) score -= 25;
      return Math.max(0, score);
    },
    detect() { return leverAdapter.score() >= ADAPTER_SCORE_THRESHOLD; },
    getScanRoot() {
      return document.querySelector(
        '#application-form, form#application-form, .application-page form, form.application-form'
      );
    },
    getQuestionContainer(el) {
      return el.closest(
        '.application-question, li.application-question, [data-qa="structured-contact-location-question"], .eeo-section .application-question'
      );
    },
    getQuestionLabel(container, el) {
      if (!container) return null;
      const textParts = [];
      container.querySelectorAll('.application-label .text, .application-label').forEach((node) => {
        const t = stripLeverLabelText(node);
        if (t && !textParts.includes(t)) textParts.push(t);
      });
      if (!textParts.length) {
        container.querySelectorAll('h3, h4, h5, p').forEach((node) => {
          if (node.closest('.application-field, ul[data-qa], label')) return;
          const t = stripLeverLabelText(node);
          if (t && t.length > 12 && !textParts.includes(t)) textParts.push(t);
        });
      }
      if (textParts.length) {
        const merged = document.createElement('span');
        merged.textContent = textParts.join(' ');
        return merged;
      }
      const labelEl = container.querySelector('[data-qa$="question-label"]');
      if (labelEl && stripLeverLabelText(labelEl)) return labelEl;
      const cardHeading = container.closest('[data-qa="additional-cards"]')?.querySelector('[data-qa="card-name"]');
      if (cardHeading && el) {
        const cardText = trim(cardHeading.textContent || '');
        const fieldText = textParts.join(' ');
        if (cardText && fieldText && !fieldText.includes(cardText)) {
          const merged = document.createElement('span');
          merged.textContent = `${cardText} — ${fieldText}`;
          return merged;
        }
      }
      return null;
    },
    getJobInfo() {
      const postingInfo = getLeverJobPostingInfo();
      if (postingInfo.job_title || postingInfo.job_description) return postingInfo;
      return {
        job_title: findLeverPostingTitle(),
        company_name: resolveLeverCompanyName(),
        job_description: extractLeverJobDescription(document)
      };
    },
    isLeverFieldRequired(el) {
      if (!el) return false;
      if (el.required || el.getAttribute('aria-required') === 'true') return true;
      const container = leverAdapter.getQuestionContainer(el);
      if (!container) return false;
      if (container.querySelector('.application-field.required-field, .required-field')) return true;
      if (container.querySelector('.application-label .required, .application-label .required')) return true;
      return false;
    },
    isOptionalField(el) {
      const nameAttr = el?.getAttribute('name') || '';
      if (/^urls\[/i.test(nameAttr)) return false;
      const fromName = leverAdapter.mapNameToCategory(nameAttr);
      if (fromName === 'linkedin' || fromName === 'github' || fromName === 'portfolio') return false;
      return !leverAdapter.isLeverFieldRequired(el);
    },
    isVoluntaryField(el) {
      if (!el) return false;
      const name = (el.getAttribute('name') || '').toLowerCase();
      if (name.startsWith('eeo[')) return true;
      if (name.startsWith('surveysresponses[')) return true;
      if (el.closest('#eeoSurvey, .eeo-section, [data-qa="eeo-section"], [id^="eeoSurvey"]')) return true;
      if (el.closest('[id*="countrySurvey"], [id*="opportunity-locations"]')) return true;
      return false;
    },
    mapNameToCategory(nameAttr) {
      if (!nameAttr) return null;
      const lower = String(nameAttr).toLowerCase();
      const direct = {
        name: 'full_name',
        email: 'email',
        phone: 'phone',
        org: 'current_company',
        company: 'current_company',
        location: 'city',
        'current-location': 'city',
        currentlocation: 'city',
        selectedlocation: 'city',
        resume: 'resume_upload',
        cover_letter: 'cover_letter_upload',
        coverletter: 'cover_letter_upload',
        comments: 'custom_question'
      };
      if (direct[lower]) return direct[lower];
      const urlsMatch = /^urls\[(.+)\]$/i.exec(nameAttr);
      if (urlsMatch) {
        const key = urlsMatch[1].toLowerCase();
        if (key === 'linkedin') return 'linkedin';
        if (key === 'github') return 'github';
        if (key === 'portfolio' || key === 'other' || key === 'website') return 'portfolio';
        if (key === 'twitter') return 'custom_question';
      }
      const fr = fieldRegistry();
      if (fr && /^eeo\[/i.test(nameAttr)) {
        const fromEeo = fr.matchByName(nameAttr);
        if (fromEeo) return fromEeo.category;
      }
      if (/linkedin/i.test(nameAttr)) return 'linkedin';
      if (/github/i.test(nameAttr)) return 'github';
      if (/portfolio|website/i.test(nameAttr)) return 'portfolio';
      return null;
    },
    mapIdToCategory(idAttr, el) {
      const qa = el?.getAttribute('data-qa') || '';
      if (qa && LEVER_QA_CATEGORY[qa]) return LEVER_QA_CATEGORY[qa];
      const fr = fieldRegistry();
      if (fr) {
        const fromPlatform = fr.matchByPlatformId('lever', qa || idAttr);
        if (fromPlatform) return fromPlatform.category;
      }
      return leverAdapter.mapNameToCategory(el?.getAttribute('name'));
    },
    resolveFieldCategory(el, questionText) {
      const emp = parseLeverEmploymentField(el, questionText);
      if (emp?.category === 'acknowledgment') {
        return { category: 'acknowledgment', confidence: 0.96 };
      }
      if (emp?.category === 'employment_kit') {
        return {
          category: 'employment_kit',
          confidence: 0.93,
          employmentSlot: emp.employmentSlot,
          employmentKey: emp.employmentKey
        };
      }
      const inputType = el?.tagName === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : '';
      const optionList = (inputType === 'radio' || inputType === 'checkbox')
        ? getRadioOrCheckboxOptions(el)
        : [];
      if (isAcknowledgmentQuestion(questionText, optionList, el) || isLeverAcknowledgmentField(el)) {
        return { category: 'acknowledgment', confidence: 0.96 };
      }
      const fromClassify = classifyField(questionText, el?.tagName || 'INPUT', inputType, optionList, el);
      if (fromClassify && fromClassify.category !== 'unknown' && fromClassify.confidence >= 0.8) {
        return { category: fromClassify.category, confidence: fromClassify.confidence };
      }
      const qNorm = normalizeText(questionText);
      if (/type n\/a if not applicable|if not applicable/.test(qNorm)) {
        return { category: 'custom_question', confidence: 0.88, suggestedDefault: 'N/A' };
      }
      if (isLeverCustomQuestionField(el) && isLeverMultipleChoiceGroup(el) && /essential functions/.test(qNorm)) {
        return { category: 'custom_question', confidence: 0.86, suggestedDefault: 'Yes' };
      }
      if (isLeverCustomQuestionField(el) && isLeverMultipleChoiceGroup(el)
        && /convicted|felony|misdemeanor|judgement|liens|bonding company denied|disciplined by a regulatory/.test(qNorm)) {
        return { category: 'custom_question', confidence: 0.86, suggestedDefault: 'No' };
      }
      if (isLeverCustomQuestionField(el) && /employed by|previously applied for employment/.test(qNorm)) {
        return { category: 'custom_question', confidence: 0.85, suggestedDefault: 'No' };
      }
      const fr = fieldRegistry();
      if (!fr) return null;
      const qa = el?.getAttribute('data-qa') || '';
      if (qa && LEVER_QA_CATEGORY[qa]) {
        return { category: LEVER_QA_CATEGORY[qa], confidence: 0.96, fromTemplate: true };
      }
      return fr.resolveFieldCategory({
        platform: 'lever',
        labelText: questionText,
        nameAttr: el?.getAttribute('name'),
        idAttr: qa || el?.getAttribute('id')
      });
    }
  };

  const ashbyAdapter = {
    name: 'ashby',
    score() {
      let score = 0;
      if (isAshbyHost()) score += 45;
      if (/\/application(\/|$|\?)/i.test(location.pathname)) score += 20;
      const systemFields = Array.from(
        document.querySelectorAll('[data-field-path*="_systemfield_"], [name*="_systemfield_"], [id*="_systemfield_"]')
      ).length;
      if (systemFields) score += Math.min(35, 10 + systemFields * 4);
      if (document.querySelector('[class*="ashby"], [class*="Ashby"], [data-ashby], .ashby-application-form-container')) {
        score += 12;
      }
      if (document.querySelector('#form, form[class*="application" i], main form')) score += 8;
      if (document.querySelector('#overview[role="tabpanel"], [aria-labelledby="job-overview"], [class*="descriptionText"]')) score += 28;
      if (document.querySelector('.ashby-job-posting-heading, h1[class*="posting" i]')) score += 10;
      if (countNamedFields((n) => /^job_application\[/i.test(n))) score -= 35;
      if (isLeverHost() && !systemFields) score -= 25;
      return Math.max(0, score);
    },
    detect() { return ashbyAdapter.score() >= ADAPTER_SCORE_THRESHOLD; },
    getScanRoot() {
      return document.querySelector(
        '#form, .ashby-application-form-container, form.ashby-application-form-container, [id="job-application-form"], main form, [class*="application-form" i] form'
      ) || document.querySelector('main[role="main"], main');
    },
    getQuestionContainer(el) {
      return el.closest(
        '[data-field-path], .ashby-application-form-field-entry, [class*="fieldEntry" i], fieldset, [class*="field-entry" i]'
      );
    },
    getQuestionLabel(container, el) {
      if (!container) return null;
      const title = container.querySelector(
        '.ashby-application-form-question-title, label.ashby-application-form-question-title, [class*="question-title" i]'
      );
      if (title && (!el || !title.contains(el))) {
        const text = textFrom(title);
        if (text) return title;
      }
      const label = container.querySelector('label, legend');
      if (label && !label.querySelector('input, textarea, select, button')) return label;
      return null;
    },
    getJobInfo() {
      const postingInfo = getAshbyJobPostingInfo();
      if (postingInfo.job_title || postingInfo.job_description) return postingInfo;
      const titleEl = document.querySelector(
        'h1, .ashby-job-posting-heading, [class*="posting-title" i], [class*="job-title" i], [data-testid*="title" i]'
      );
      const companyEl = document.querySelector(
        '[class*="navLogoText" i], .ashby-job-posting-header a, [class*="company-name" i], header a, header h2'
      );
      return {
        job_title: titleEl ? trim(titleEl.textContent) : '',
        company_name: companyEl ? trim(companyEl.textContent) : resolveAshbyCompanyName()
      };
    },
    mapNameToCategory(nameAttr, el) {
      if (el) {
        const fromPath = mapAshbyFieldPath(getAshbyFieldPath(el));
        if (fromPath) return fromPath;
      }
      if (!nameAttr) return null;
      const fromAshby = mapAshbyFieldToken(nameAttr);
      if (fromAshby) return fromAshby;
      const lower = String(nameAttr).toLowerCase();
      const direct = {
        name: 'full_name',
        email: 'email',
        phone: 'phone',
        location: 'city',
        resume: 'resume_upload',
        cover_letter: 'cover_letter_upload'
      };
      if (direct[lower]) return direct[lower];
      if (/linkedin/i.test(nameAttr)) return 'linkedin';
      if (/github/i.test(nameAttr)) return 'github';
      if (/portfolio|website/i.test(nameAttr)) return 'portfolio';
      return null;
    },
    mapIdToCategory(idAttr, el) {
      if (el) {
        const fromPath = mapAshbyFieldPath(getAshbyFieldPath(el));
        if (fromPath) return fromPath;
      }
      return mapAshbyFieldToken(idAttr);
    },
    resolveFieldCategory(el, questionText) {
      const path = getAshbyFieldPath(el);
      const fromPath = mapAshbyFieldPath(path);
      if (fromPath) return { category: fromPath, confidence: 0.97 };
      const fr = fieldRegistry();
      if (!fr) return null;
      return fr.resolveFieldCategory({
        labelText: questionText,
        nameAttr: el && el.getAttribute('name'),
        idAttr: el && el.getAttribute('id')
      });
    }
  };

  const smartRecruitersAdapter = {
    name: 'smartrecruiters',
    score() {
      let score = 0;
      if (isSmartRecruitersHost()) score += 40;
      if (document.querySelector('[data-automation="job-application-form"], [data-automation="apply-form"], spl-application-form, [class*="ApplicationForm" i]')) score += 30;
      const srNames = countNamedFields((n) => /^(firstname|lastname|email|phone|resume)$/i.test(n.replace(/[-_]/g, '')));
      if (srNames) score += Math.min(20, 5 + srNames * 3);
      if (/\/(job|jobs|posting|postings|apply|application)/i.test(location.pathname)) score += 10;
      if (document.querySelector('main.jobad-main, .jobad-container')) score += 28;
      if (document.querySelector('[itemprop="description"], .job-section[id^="st-"]')) score += 16;
      if (document.querySelector('h1.job-title[itemprop="title"], h1.job-title')) score += 10;
      if (document.querySelector('script[src*="smartrecruiters" i], link[href*="smartrecruiters" i]')) score += 8;
      if (countNamedFields((n) => /^job_application\[/i.test(n))) score -= 35;
      if (countNamedFields((n) => /_systemfield_/i.test(n))) score -= 30;
      return Math.max(0, score);
    },
    detect() { return smartRecruitersAdapter.score() >= ADAPTER_SCORE_THRESHOLD; },
    getScanRoot() {
      return document.querySelector(
        '[data-automation="job-application-form"], [data-automation="apply-form"], spl-application-form, #application-form, form[data-automation*="application" i], [class*="ApplicationForm" i]'
      ) || document.querySelector('main form, form[action*="apply" i]');
    },
    getQuestionContainer(el) {
      return el.closest(
        '[data-automation*="question" i], [class*="question" i], [class*="field" i], fieldset, spl-form-field, oc-form-field'
      );
    },
    getQuestionLabel(container) {
      if (!container) return null;
      const label = container.querySelector(
        'label, legend, [data-automation*="label" i], [class*="label" i], .question-title'
      );
      if (label && !label.querySelector('input, textarea, select, button')) return label;
      return null;
    },
    getJobInfo() {
      const postingInfo = getSmartRecruitersJobPostingInfo();
      if (postingInfo.job_title || postingInfo.company_name || postingInfo.job_description) return postingInfo;
      const titleEl = document.querySelector(
        '[data-automation="job-title"], [class*="job-title" i], h1, .job-title'
      );
      const companyEl = document.querySelector(
        '[data-automation="company-name"], [class*="company-name" i], .company-name, header .brand'
      );
      return {
        job_title: titleEl ? cleanTitle(trim(titleEl.textContent)) : '',
        company_name: companyEl ? cleanCompany(trim(companyEl.textContent)) : resolveSmartRecruitersCompanyName()
      };
    },
    isVoluntaryField(el) {
      if (!el) return false;
      if (el.closest('[data-compliance-type="DIVERSITY"], [data-automation*="diversity" i], [class*="diversity" i]')) return true;
      const label = trim(getQuestionText(el)).toLowerCase();
      if (/^confidential diversity|^voluntary self-identification|^eeo\b/.test(label)) return true;
      return false;
    },
    mapNameToCategory(nameAttr) {
      if (!nameAttr) return null;
      const norm = String(nameAttr).toLowerCase().replace(/[-_\s]/g, '');
      const table = {
        firstname: 'first_name',
        lastname: 'last_name',
        email: 'email',
        phone: 'phone',
        phonenumber: 'phone',
        location: 'city',
        city: 'city',
        resume: 'resume_upload',
        coverletter: 'cover_letter_upload',
        linkedin: 'linkedin',
        linkedinurl: 'linkedin',
        github: 'github',
        website: 'portfolio',
        portfolio: 'portfolio'
      };
      if (table[norm]) return table[norm];
      if (/linkedin/i.test(nameAttr)) return 'linkedin';
      if (/github/i.test(nameAttr)) return 'github';
      if (/portfolio|website/i.test(nameAttr)) return 'portfolio';
      return null;
    },
    mapIdToCategory(idAttr) {
      if (!idAttr) return null;
      return smartRecruitersAdapter.mapNameToCategory(idAttr);
    },
    resolveFieldCategory(el, questionText) {
      const fr = fieldRegistry();
      if (!fr) return null;
      return fr.resolveFieldCategory({
        labelText: questionText,
        nameAttr: el && el.getAttribute('name'),
        idAttr: el && el.getAttribute('id')
      });
    }
  };

  const bamboohrAdapter = {
    name: 'bamboohr',
    score() {
      let score = 0;
      if (isBamboohrHost()) score += 45;
      if (document.querySelector('.BambooRichText')) score += 32;
      if (document.querySelector('[data-fabric-component="Headline"]')) score += 12;
      if (/\/careers(\/|$)/i.test(location.pathname)) score += 12;
      if (document.querySelector('[data-bi-id="careers-site-apply-button"]')) score += 8;
      if (document.querySelector('script[type="application/ld+json"]')) score += 6;
      return Math.max(0, score);
    },
    detect() { return bamboohrAdapter.score() >= ADAPTER_SCORE_THRESHOLD; },
    getScanRoot() {
      return document.querySelector('form[data-fabric-component], form') || null;
    },
    getQuestionContainer(el) {
      return el.closest('[data-fabric-component="TextField"], .MuiFormControl-root, fieldset');
    },
    getJobInfo() {
      const postingInfo = getBamboohrJobPostingInfo();
      if (postingInfo.job_title || postingInfo.job_description) return postingInfo;
      return {
        job_title: findBamboohrPostingTitle(),
        company_name: resolveBamboohrCompanyName()
      };
    },
    mapNameToCategory() {
      return null;
    },
    resolveFieldCategory(el, questionText) {
      const fr = fieldRegistry();
      if (!fr) return null;
      return fr.resolveFieldCategory({
        labelText: questionText,
        nameAttr: el && el.getAttribute('name'),
        idAttr: el && el.getAttribute('id')
      });
    }
  };

  const workableAdapter = {
    name: 'workable',
    score() {
      let score = 0;
      if (isWorkableHost()) score += 45;
      if (document.querySelector('[data-ui="overview-title"]')) score += 25;
      if (document.querySelector('[data-ui="job-breakdown-description-parsed-html"], [class*="jobBreakdown__job-breakdown"]')) score += 28;
      if (document.querySelector('[data-ui="overview-apply-now"], [class*="applyButton__apply-button"]')) score += 10;
      if (document.querySelector('form[data-ui], form[class*="application"]')) score += 12;
      return Math.max(0, score);
    },
    detect() { return workableAdapter.score() >= ADAPTER_SCORE_THRESHOLD; },
    getScanRoot() {
      return document.querySelector('form[data-ui], form[class*="application"]') || document.querySelector('main');
    },
    getQuestionContainer(el) {
      return el.closest('[data-ui], .field, fieldset, [class*="field"]');
    },
    getJobInfo() {
      const postingInfo = getWorkableJobPostingInfo();
      if (postingInfo.job_title || postingInfo.job_description) return postingInfo;
      return {
        job_title: findWorkablePostingTitle(),
        company_name: resolveWorkableCompanyName(),
        job_description: appendWorkableCompanyDescription(extractWorkableJobDescription(document))
      };
    },
    mapNameToCategory() {
      return null;
    },
    resolveFieldCategory(el, questionText) {
      const fr = fieldRegistry();
      if (!fr) return null;
      return fr.resolveFieldCategory({
        labelText: questionText,
        nameAttr: el && el.getAttribute('name'),
        idAttr: el && el.getAttribute('id')
      });
    }
  };

  const doverAdapter = {
    name: 'dover',
    score() {
      let score = 0;
      if (isDoverHost()) score += 45;
      if (document.querySelector('[class*="InboundApplication__JobDescriptionWrapper"], [class*="JobDescriptionWrapper"]')) score += 28;
      if (document.querySelector('[class*="typography__TitleLarge"]')) score += 12;
      if (document.querySelector('input[name="firstName"], input[name="lastName"], input[name="email"]')) score += 25;
      if (document.querySelector('a[href*="dover.com"]')) score += 8;
      return Math.max(0, score);
    },
    detect() { return doverAdapter.score() >= ADAPTER_SCORE_THRESHOLD; },
    getScanRoot() {
      return document.querySelector(
        '[class*="InboundApplication__FormWrapper"] form, [class*="FormWrapper"] form, form'
      ) || document.querySelector('[class*="InboundApplication__RightColumn"]');
    },
    getQuestionContainer(el) {
      return el.closest('.MuiFormControl-root, .MuiBox-root, fieldset, [class*="FormLabel"]')?.parentElement
        || el.closest('.MuiFormControl-root, .MuiBox-root, fieldset');
    },
    getQuestionLabel(container, el) {
      if (!container) return null;
      const label = container.querySelector('[class*="FormLabel"], label, legend');
      if (label && el && !label.contains(el)) return label;
      const prev = el?.previousElementSibling;
      if (prev && /FormLabel/i.test(prev.className || '')) return prev;
      return null;
    },
    getJobInfo() {
      const postingInfo = getDoverJobPostingInfo();
      if (postingInfo.job_title || postingInfo.job_description) return postingInfo;
      return {
        job_title: findDoverPostingTitle(),
        company_name: resolveDoverCompanyName(),
        job_description: extractDoverJobDescription(document)
      };
    },
    mapNameToCategory(nameAttr) {
      if (!nameAttr) return null;
      const key = String(nameAttr).toLowerCase();
      const table = {
        firstname: 'first_name',
        lastname: 'last_name',
        email: 'email',
        linkedinurl: 'linkedin',
        phonenumber: 'phone'
      };
      return table[key] || null;
    },
    mapIdToCategory(idAttr) {
      return doverAdapter.mapNameToCategory(idAttr);
    },
    resolveFieldCategory(el, questionText) {
      const fromName = doverAdapter.mapNameToCategory(el?.getAttribute('name'));
      if (fromName) return fromName;
      const fr = fieldRegistry();
      if (!fr) return null;
      return fr.resolveFieldCategory({
        labelText: questionText,
        nameAttr: el && el.getAttribute('name'),
        idAttr: el && el.getAttribute('id')
      });
    }
  };

  const adapters = [
    greenhouseAdapter,
    leverAdapter,
    ashbyAdapter,
    smartRecruitersAdapter,
    workableAdapter,
    doverAdapter,
    bamboohrAdapter,
    workdayAdapter,
    ripplingAdapter,
    defaultAdapter
  ];
  let activeAdapter = defaultAdapter;
  let lastAdapterPick = null;

  function adapterScore(adapter) {
    try {
      if (typeof adapter.score === 'function') return Number(adapter.score()) || 0;
      if (typeof adapter.detect === 'function') return adapter.detect() ? 50 : 0;
    } catch (_) {}
    return 0;
  }

  function describeScanRoot(root) {
    if (!root || root === document || root === document.documentElement) return 'document';
    if (root.id) return `#${root.id}`;
    const tag = root.tagName ? root.tagName.toLowerCase() : 'element';
    const cls = root.classList && root.classList.length
      ? `.${Array.from(root.classList).slice(0, 2).join('.')}`
      : '';
    return `${tag}${cls}`;
  }

  function getScanRootForAdapter(adapter) {
    if (!adapter || typeof adapter.getScanRoot !== 'function') return null;
    try {
      const root = adapter.getScanRoot();
      if (root instanceof Element && root !== document.documentElement) return root;
    } catch (_) {}
    return null;
  }

  function pickAdapterWithDebug() {
    const rankings = adapters.map((adapter) => ({
      name: adapter.name,
      score: adapterScore(adapter)
    })).sort((a, b) => b.score - a.score);

    const best = rankings[0];
    const adapter = best && best.score >= ADAPTER_SCORE_THRESHOLD
      ? adapters.find((a) => a.name === best.name) || defaultAdapter
      : defaultAdapter;
    const score = best && best.score >= ADAPTER_SCORE_THRESHOLD ? best.score : 0;
    const scanRoot = getScanRootForAdapter(adapter);
    const pick = {
      adapter,
      score,
      rankings,
      threshold: ADAPTER_SCORE_THRESHOLD,
      scanRoot: scanRoot || document,
      scanRootLabel: describeScanRoot(scanRoot),
      scopedScan: Boolean(scanRoot && scanRoot !== document)
    };
    lastAdapterPick = pick;
    return pick;
  }

  function pickAdapter() {
    const pick = pickAdapterWithDebug();
    activeAdapter = pick.adapter;
    return activeAdapter;
  }

  function trim(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function textFrom(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll(NOISE_SELECTOR).forEach((node) => node.remove());
    return trim(clone.textContent || clone.innerText || '');
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 && rect.height <= 1) return false;
    if (rect.bottom < 0 || rect.right < 0) return false;
    return rect.width > 0 && rect.height > 0;
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value || '').replace(/([ #;?%&,.+*~\':"!^$[\]()=>|/@])/g, '\\$1');
  }

  function getElementPath(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    if (el.id) return `#${cssEscape(el.id)}`;

    const parts = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
      let selector = node.nodeName.toLowerCase();
      if (node.classList && node.classList.length) {
        const safeClass = Array.from(node.classList).slice(0, 2).map(cssEscape).join('.');
        if (safeClass) selector += `.${safeClass}`;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.nodeName === node.nodeName);
        if (siblings.length > 1) selector += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(selector);
      node = parent;
      if (parts.length > 6) break;
    }
    return parts.join(' > ');
  }

  function findByElementPath(path) {
    if (!path) return null;
    try {
      return document.querySelector(path);
    } catch (_) {
      return null;
    }
  }

  function getElementSignature(el, scanRoot) {
    const tag = el.tagName;
    const type = tag === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : tag.toLowerCase();
    const selector = ['input', 'textarea', 'select', '[contenteditable="true"]'].join(',');
    const scope = (scanRoot && scanRoot.querySelectorAll) ? scanRoot : document;
    const all = Array.from(scope.querySelectorAll(selector));
    return {
      tagName: tag,
      inputType: type,
      idAttr: el.getAttribute('id') || '',
      name: el.getAttribute('name') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      placeholder: el.getAttribute('placeholder') || '',
      docIndex: all.indexOf(el)
    };
  }

  function resolveFieldElement(payload) {
    pickAdapter();

    if (isAshbyFormContext() && payload?.fieldCategory) {
      if (payload.fieldCategory === 'resume_upload' || payload.fieldCategory === 'cover_letter_upload') {
        const fileEl = findAshbyKitFileInput(payload.fieldCategory);
        if (fileEl) return fileEl;
      }
    }

    if (isRipplingFormContext() && payload?.fieldCategory) {
      if (payload.fieldCategory === 'resume_upload' || payload.fieldCategory === 'cover_letter_upload') {
        const fileEl = findRipplingKitFileInput(payload.fieldCategory);
        if (fileEl) return fileEl;
      }
      const ripplingEl = findRipplingInputForCategory(payload.fieldCategory);
      if (ripplingEl) return ripplingEl;
    }

    const fromPath = findByElementPath(payload.elementPath);
    if (fromPath) return fromPath;

    const sig = payload.signature;
    if (!sig) return null;

    if (sig.idAttr) {
      try {
        const byId = document.getElementById(sig.idAttr);
        if (byId) return byId;
      } catch (_) {}
    }

    if (isRipplingFormContext() && sig.idAttr) {
      const dataInput = document.querySelector(`[data-input][id="${cssEscape(sig.idAttr)}"]`);
      if (dataInput) return dataInput;
    }

    if (sig.name) {
      try {
        const typeSelector = sig.inputType && sig.tagName === 'INPUT'
          ? `input[type="${cssEscape(sig.inputType)}"][name="${cssEscape(sig.name)}"]`
          : `${sig.tagName.toLowerCase()}[name="${cssEscape(sig.name)}"]`;
        const byName = document.querySelector(typeSelector);
        if (byName) return byName;
      } catch (_) {}
    }

    if (sig.ariaLabel) {
      try {
        const byAria = document.querySelector(`[aria-label="${cssEscape(sig.ariaLabel)}"]`);
        if (byAria) return byAria;
      } catch (_) {}
    }

    if (sig.idAttr && sig.inputType === 'file') {
      try {
        const byFileId = document.getElementById(sig.idAttr);
        if (byFileId && byFileId.tagName === 'INPUT' && (byFileId.getAttribute('type') || '').toLowerCase() === 'file') {
          return byFileId;
        }
      } catch (_) {}
    }

    if (typeof sig.docIndex === 'number' && sig.docIndex >= 0) {
      const all = Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"]'));
      const candidate = all[sig.docIndex];
      if (candidate && candidate.tagName === sig.tagName) return candidate;
    }

    if (payload.fieldCategory === 'acknowledgment' || payload.fieldType === 'checkbox') {
      const leverAck = findLeverAcknowledgmentCheckbox(payload);
      if (leverAck) return leverAck;
    }

    return null;
  }

  function getLabelText(el) {
    const labels = [];

    if (el.id) {
      const explicit = document.querySelectorAll(`label[for="${cssEscape(el.id)}"]`);
      explicit.forEach((label) => labels.push(textFrom(label)));
    }

    if (el.labels && el.labels.length) {
      Array.from(el.labels).forEach((label) => labels.push(textFrom(label)));
    }

    const parentLabel = el.closest('label');
    if (parentLabel) labels.push(textFrom(parentLabel));

    const fieldset = el.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend) labels.push(textFrom(legend));
    }

    return trim([...new Set(labels.filter(Boolean))].join(' '));
  }

  function getNearbyText(el) {
    const pieces = [];
    let node = el.parentElement;
    for (let depth = 0; node && depth < 3; depth += 1) {
      const text = textFrom(node);
      if (text && text.length <= 350) pieces.push(text);
      node = node.parentElement;
    }
    return trim(pieces.join(' ')).slice(0, 500);
  }

  function getAdapterContainerText(el) {
    if (!activeAdapter || !activeAdapter.getQuestionContainer) return '';
    const container = activeAdapter.getQuestionContainer(el);
    if (!container) return '';
    if (typeof activeAdapter.getQuestionLabel === 'function') {
      const adapterLabel = activeAdapter.getQuestionLabel(container, el);
      if (adapterLabel) {
        const text = activeAdapter.name === 'lever'
          ? stripLeverLabelText(adapterLabel)
          : activeAdapter.name === 'workday'
            ? stripWorkdayLabelText(adapterLabel)
            : textFrom(adapterLabel);
        if (text) return text;
      }
    }
    // Generic fallback: prefer a label/legend/.question/.label that does NOT itself wrap an input
    // (option-wrapping labels would otherwise leak the option text in).
    const candidates = container.querySelectorAll('legend, .question, .label, label');
    for (const candidate of candidates) {
      if (candidate.querySelector('input, textarea, select')) continue;
      const text = textFrom(candidate);
      if (text) return text;
    }
    return '';
  }

  const PLACEHOLDER_NOISE_RE = /\b(select\.{0,3}|please select|choose( one| an option)?|pick( one| an option)?|none selected|no value|--?\s*select\s*--?)\b/gi;
  const INTERNAL_ID_TOKEN_RE = /^(question|field|input|item|q|f|id|i)[-_][\w-]*$|^react[-_]select[-_][\w-]*$|^[a-f0-9]{8,}$|^\d{4,}$|^(field|input|item|question|row)[-_]?\d+$/i;
  const GENERIC_LABEL_WORDS_RE = /^(field|input|question|item|row|element|control|widget|placeholder|untitled|unknown|select|option|value|text|none|null|undefined|true|false|optional|required|disabled|readonly|hidden)$/i;
  const GENERIC_PHRASE_RE = /^(field|input|question|item|row|element|control)\s*(no\.?|number|#)?\s*\d*$/i;

  function isInternalIdLike(value) {
    const trimmed = trim(value || '');
    if (!trimmed) return true;
    if (trimmed.length > 80) return false;
    if (/\s/.test(trimmed)) return false;
    return INTERNAL_ID_TOKEN_RE.test(trimmed);
  }

  function looksLikeRandomToken(value) {
    const s = trim(value || '');
    if (!s || s.length < 4 || s.length > 24) return false;
    if (/\s/.test(s)) return false;
    if (/[._\-]/.test(s)) return false;
    if (!/[a-z]/i.test(s)) return false;
    if (!/[aeiouy]/i.test(s)) return true;
    const hasUpper = /[A-Z]/.test(s);
    const hasLower = /[a-z]/.test(s);
    const hasDigit = /\d/.test(s);
    if (hasUpper && hasLower) {
      let transitions = 0;
      for (let i = 1; i < s.length; i += 1) {
        const a = s[i - 1];
        const b = s[i];
        if ((/[a-z]/.test(a) && /[A-Z]/.test(b)) || (/[A-Z]/.test(a) && /[a-z]/.test(b))) transitions += 1;
      }
      if (hasDigit && transitions >= 3) return true;
      if (transitions >= 4) return true;
    }
    return false;
  }

  function looksMeaningful(text) {
    const s = trim(text || '');
    if (!s || s.length < 2) return false;
    if (GENERIC_PHRASE_RE.test(s)) return false;
    const cleaned = s.replace(/[^A-Za-z\s'?]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned) return false;
    const words = cleaned.split(/\s+/);
    for (const w of words) {
      if (w.length < 3) continue;
      if (!/[aeiouy]/i.test(w)) continue;
      if (looksLikeRandomToken(w)) continue;
      if (GENERIC_LABEL_WORDS_RE.test(w)) continue;
      return true;
    }
    return false;
  }

  function stripPlaceholderNoise(text) {
    if (!text) return '';
    return String(text).replace(PLACEHOLDER_NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
  }

  function getTrustedLabel(el) {
    if (!el) return '';
    const cleaned = stripPlaceholderNoise(trim(getQuestionText(el)));
    return looksMeaningful(cleaned) ? cleaned : '';
  }

  function resolveAriaLabelledBy(el) {
    const ref = el.getAttribute('aria-labelledby');
    if (!ref) return '';
    return ref.split(/\s+/).filter(Boolean)
      .map((id) => textFrom(document.getElementById(id)))
      .filter(Boolean)
      .join(' ');
  }

  function getGroupQuestionLabel(el, inputType) {
    if (!el || (inputType !== 'radio' && inputType !== 'checkbox')) return '';
    const fieldset = el.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend) {
        const text = textFrom(legend);
        if (text) return text;
      }
    }
    const group = el.closest('[role="radiogroup"], [role="group"]');
    if (group) {
      const ariaLabel = group.getAttribute('aria-label');
      if (ariaLabel && trim(ariaLabel)) return trim(ariaLabel);
      const ref = group.getAttribute('aria-labelledby');
      if (ref) {
        const ids = ref.split(/\s+/).filter(Boolean);
        const text = ids.map((id) => textFrom(document.getElementById(id))).filter(Boolean).join(' ');
        if (text) return text;
      }
    }
    return '';
  }

  function isGroupedRadioOrCheckbox(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    const inputType = (el.getAttribute('type') || '').toLowerCase();
    if (inputType !== 'radio' && inputType !== 'checkbox') return false;
    const name = el.getAttribute('name');
    if (!name) return false;
    try {
      const group = document.querySelectorAll(`input[type="${inputType}"][name="${cssEscape(name)}"]`);
      return group.length > 1;
    } catch (_) { return false; }
  }

  function looksLikeNoisyNameToken(value) {
    const s = String(value || '');
    if (!s) return true;
    if (/[a-f0-9]{8,}/i.test(s)) return true;       // UUIDs / long hashes
    if (/\d{4,}/.test(s)) return true;              // long numeric runs
    if (/^\[?[a-f0-9-]{8,}\]?/i.test(s)) return true;
    return false;
  }

  function getQuestionText(el) {
    if (!el) return '';

    // 1. Adapter-supplied question label (most trustworthy)
    const adapterText = stripPlaceholderNoise(trim(getAdapterContainerText(el)));
    if (looksMeaningful(adapterText)) return adapterText;

    // 2. aria-label / aria-labelledby
    const ariaLabel = stripPlaceholderNoise(trim(el.getAttribute('aria-label') || ''));
    if (looksMeaningful(ariaLabel)) return ariaLabel;
    const ariaLabelledBy = stripPlaceholderNoise(trim(resolveAriaLabelledBy(el)));
    if (looksMeaningful(ariaLabelledBy)) return ariaLabelledBy;

    const inputType = el.tagName === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : '';
    const isGroup = isGroupedRadioOrCheckbox(el);

    // 3. For grouped radio/checkbox, prefer fieldset legend / radiogroup label over the per-option <label>
    if (isGroup) {
      const groupLabel = stripPlaceholderNoise(trim(getGroupQuestionLabel(el, inputType)));
      if (looksMeaningful(groupLabel)) return groupLabel;
    } else {
      const labelText = stripPlaceholderNoise(trim(getLabelText(el)));
      if (looksMeaningful(labelText)) return labelText;
    }

    // 4. Placeholder (only if meaningful and not an internal id)
    const placeholder = el.getAttribute('placeholder') || '';
    if (!isInternalIdLike(placeholder)) {
      const cleaned = stripPlaceholderNoise(trim(placeholder));
      if (looksMeaningful(cleaned)) return cleaned;
    }

    // 5. name attribute, if it looks human (not UUID-laden)
    const nameAttr = el.getAttribute('name') || '';
    if (nameAttr && !isInternalIdLike(nameAttr) && !looksLikeNoisyNameToken(nameAttr)) {
      const cleaned = stripPlaceholderNoise(trim(nameAttr.replace(/[._\-\[\]]/g, ' ')));
      if (looksMeaningful(cleaned)) return cleaned;
    }

    // 6. id attribute, if it looks human
    const idAttr = el.getAttribute('id') || '';
    if (idAttr && !isInternalIdLike(idAttr) && !looksLikeNoisyNameToken(idAttr)) {
      const cleaned = stripPlaceholderNoise(trim(idAttr.replace(/[._\-]/g, ' ')));
      if (looksMeaningful(cleaned)) return cleaned;
    }

    // 7. nearbyText as last resort (often noisy but better than nothing)
    const nearby = stripPlaceholderNoise(trim(getNearbyText(el)));
    if (looksMeaningful(nearby)) return nearby;

    // 8. Final fallback: concatenate whatever we have so the row isn't blank
    const parts = [adapterText, ariaLabel, ariaLabelledBy, placeholder].map(trim).filter(Boolean);
    return trim([...new Set(parts)].join(' '));
  }

  function getSelectOptions(select) {
    return Array.from(select.options || []).map((option) => trim(option.textContent || option.value)).filter(Boolean);
  }

  function isComboboxLike(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.tagName === 'SELECT') return false;
    if (isWorkdayListboxButton(el)) return true;
    if (isWorkdayMultiselectInput(el)) return true;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'combobox') return true;
    if (el.getAttribute('aria-haspopup') === 'listbox') return true;
    if (el.getAttribute('list')) return true;
    return false;
  }

  function findComboboxControl(el) {
    const ripplingCtrl = el.closest('[data-testid="select-controller"]');
    if (ripplingCtrl) return ripplingCtrl;
    const wrappers = [
      '[class*="select__control" i]',
      '[class*="select-control" i]',
      '[class*="select-shell" i]',
      '[class*="combobox-control" i]',
      '[class*="combobox-wrapper" i]',
      '[class*="autocomplete-root" i]',
      '[class*="autocomplete-wrapper" i]'
    ];
    for (const selector of wrappers) {
      const wrapper = el.closest(selector);
      if (wrapper && wrapper !== el) return wrapper;
    }
    const roleParent = el.parentElement ? el.parentElement.closest('[role="combobox"]') : null;
    if (roleParent && roleParent !== el) return roleParent;
    return el;
  }

  function findComboboxToggleButton(el, control) {
    const scope = control && control !== el ? control : (el.parentElement || document);
    const selectors = [
      'button[aria-label*="toggle" i]',
      'button[aria-label*="open" i]',
      'button[aria-label*="dropdown" i]',
      'button[aria-label*="flyout" i]',
      'button[aria-haspopup="listbox"]',
      '[class*="indicator" i] button',
      'button[class*="indicator" i]',
      'button[class*="dropdown" i]',
      'button[class*="chevron" i]'
    ];
    for (const selector of selectors) {
      const btn = scope.querySelector ? scope.querySelector(selector) : null;
      if (btn && isVisible(btn)) return btn;
    }
    return null;
  }

  function findListboxFor(el) {
    const idAttrs = ['aria-controls', 'aria-owns'];
    for (const attr of idAttrs) {
      const ids = (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean);
      for (const id of ids) {
        const target = document.getElementById(id);
        if (target) return target;
      }
    }

    const listAttr = el.getAttribute('list');
    if (listAttr) {
      const dl = document.getElementById(listAttr);
      if (dl) return dl;
    }

    const control = findComboboxControl(el);
    const parent = control.parentElement;
    if (parent) {
      const sibling = parent.querySelector('[role="listbox"]');
      if (sibling) return sibling;
    }
    return null;
  }

  function readComboboxOptions(el) {
    if (isWorkdayListboxButton(el)) {
      const current = trim(el.textContent || el.getAttribute('aria-label') || '');
      if (current && !/^select one$/i.test(current)) return [current];
      return [];
    }
    if (isWorkdayMultiselectInput(el)) {
      const container = el.closest('[data-automation-id="multiSelectContainer"]');
      const selected = container
        ? Array.from(container.querySelectorAll('[data-automation-id="promptOption"], [data-automation-id="selectedItem"] p'))
          .map((n) => trim(n.textContent || n.getAttribute('data-automation-label') || ''))
          .filter(Boolean)
        : [];
      if (selected.length) return selected;
    }
    const listbox = findListboxFor(el);
    if (!listbox) return [];
    const optionEls = listbox.querySelectorAll('[role="option"], option');
    return Array.from(optionEls).map((option) => trim(option.textContent || option.value)).filter(Boolean);
  }

  function findVisibleOpenListbox(el, knownListboxId) {
    const explicitId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns') || knownListboxId || '';
    const ids = explicitId.split(/\s+/).filter(Boolean);
    for (const id of ids) {
      const lb = document.getElementById(id);
      if (lb && isVisible(lb)) return lb;
    }
    const candidates = Array.from(document.querySelectorAll('[role="listbox"]'));
    return candidates.find((lb) => isVisible(lb) && lb.querySelector('[role="option"]')) || null;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isLeverFormElement(el) {
    return activeAdapter?.name === 'lever' || isLeverFormContext();
  }

  function isLeverCustomQuestionField(el) {
    return Boolean(el?.closest('li.application-question.custom-question, .application-question.custom-question'));
  }

  function isLeverMultipleChoiceGroup(el) {
    return Boolean(el?.closest('ul[data-qa="multiple-choice"]'));
  }

  function isLeverCheckboxGroup(el) {
    return Boolean(el?.closest('ul[data-qa="checkboxes"]'));
  }

  function getLeverOptionLabel(input) {
    if (!input) return '';
    const optionSpan = input.closest('label')?.querySelector('.application-answer-alternative');
    if (optionSpan) return trim(optionSpan.textContent || '');
    const optionValue = trim(input.getAttribute('value') || '');
    if (optionValue && optionValue !== 'on') return optionValue;
    return '';
  }

  function getRadioOrCheckboxOptions(el) {
    if (isAshbyYesNoField(el)) {
      const yesNoOpts = getAshbyYesNoOptions(el);
      if (yesNoOpts.length) return yesNoOpts;
    }
    const name = el.getAttribute('name');
    if (!name) return [];
    let group;
    if (isLeverFormElement(el)) {
      const scope = el.closest('ul[data-qa="multiple-choice"], ul[data-qa="checkboxes"]');
      if (scope) {
        group = scope.querySelectorAll(`input[type="${el.type}"][name="${cssEscape(name)}"]`);
      }
    }
    if (!group || !group.length) {
      group = name
        ? document.querySelectorAll(`input[type="${el.type}"][name="${cssEscape(name)}"]`)
        : [];
    }
    if (!group.length) {
      const single = getLeverOptionLabel(el) || getLabelText(el) || trim(el.getAttribute('value') || '');
      if (single && single !== 'on') return [single];
      return [];
    }
    const useLeverLabels = isLeverFormElement(el);
    return Array.from(group).map((input) => {
      if (useLeverLabels) {
        const leverLabel = getLeverOptionLabel(input);
        if (leverLabel) return leverLabel;
      }
      const label = getLabelText(input) || input.value || input.id || input.name;
      return trim(label);
    }).filter(Boolean);
  }

  function isYesNoOptions(options) {
    if (!Array.isArray(options) || options.length < 2 || options.length > 4) return false;
    const norm = options.map((o) => normalizeText(o));
    const yes = /^(yes|y|true|i (do|am|will|have)|sure|yep|yeah|of course|definitely)$/;
    const no = /^(no|n|false|i (don.?t|am not|will not|haven.?t|cannot|can.?t)|nope|nah|never)$/;
    const neutral = /^(prefer not (to (say|answer)|to)|decline (to (say|answer|state))?|n a|na|not applicable|cannot recall|other|unsure|maybe)$/;
    const hasYes = norm.some((o) => yes.test(o));
    const hasNo = norm.some((o) => no.test(o));
    if (!hasYes || !hasNo) return false;
    return norm.every((o) => yes.test(o) || no.test(o) || neutral.test(o));
  }

  const YES_NO_CATEGORIES = new Set([
    'work_authorization',
    'work_authorization_us',
    'work_authorization_ca',
    'work_authorization_uk',
    'sponsorship',
    'relocation',
    'lgbtq_identity'
  ]);
  const YES_NO_QUESTION_RE = /\b(yes|no)\b/i;
  const YES_NO_PREFIX_RE = /^(do|did|does|are|is|was|were|have|has|had|can|could|will|would|should|may|might|must) (you|we|they|i|he|she|it)\b/i;

  function looksLikeYesNoQuestion(questionText, category) {
    if (category && YES_NO_CATEGORIES.has(category)) return true;
    const text = trim(questionText || '');
    if (!text) return false;
    if (text.length > 220) return false;
    if (YES_NO_PREFIX_RE.test(text)) return true;
    if (/\?$/.test(text) && YES_NO_QUESTION_RE.test(text)) return true;
    return false;
  }

  const AUTOCOMPLETE_INPUT_CLASS_RE = /\b(location-input|location-search|typeahead|autocomplete|autosuggest|search-input|places-input|combo-search|geo-input|address-autocomplete)\b/i;
  const AUTOCOMPLETE_DROPDOWN_SELECTORS = [
    '[class*="dropdown-container"]',
    '[class*="dropdown-results"]',
    '[class*="autocomplete-results"]',
    '[class*="autocomplete-list"]',
    '[class*="autocomplete-dropdown"]',
    '[class*="typeahead-results"]',
    '[class*="typeahead-dropdown"]',
    '[class*="suggestions"]',
    '[class*="places-results"]'
  ];
  const AUTOCOMPLETE_ITEM_SELECTORS = [
    '[class*="dropdown-result"]:not([class*="no-result"]):not([class*="loading"])',
    '[class*="autocomplete-item"]',
    '[class*="autocomplete-option"]',
    '[class*="typeahead-item"]',
    '[class*="suggestion-item"]',
    '[class*="suggestion"]:not([class*="loading"]):not([class*="empty"])',
    '[role="option"]',
    'li'
  ];

  function findAutocompleteDropdown(el) {
    if (!el) return null;
    const scopes = [];
    let node = el.parentElement;
    for (let depth = 0; node && depth < 5; depth += 1) {
      scopes.push(node);
      node = node.parentElement;
    }
    const fieldWrap = el.closest(
      '[data-qa="structured-contact-location-question"], [class*="field"], [class*="form-row"], [class*="form-group"], [class*="application-field"], label'
    );
    if (fieldWrap && !scopes.includes(fieldWrap)) scopes.push(fieldWrap);

    for (const scope of scopes) {
      for (const sel of AUTOCOMPLETE_DROPDOWN_SELECTORS) {
        try {
          const found = scope.querySelector(sel);
          if (found && found !== el && !el.contains(found)) return found;
        } catch (_) {}
      }
    }
    return null;
  }

  function resolveAutocompleteScope(el) {
    const dropdown = findAutocompleteDropdown(el);
    if (dropdown) return dropdown;
    return el.closest(
      '[data-qa="structured-contact-location-question"], label, [class*="application-field"], [class*="field"]'
    ) || el.parentElement || document.body;
  }

  function isLeverLocationInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    const dataQa = (el.getAttribute('data-qa') || '').toLowerCase();
    if (dataQa === 'location-input') return true;
    if (el.classList && el.classList.contains('location-input')) return true;
    const name = (el.getAttribute('name') || '').toLowerCase();
    if (name === 'location' && el.closest('[data-qa="structured-contact-location-question"]')) return true;
    return false;
  }

  function isReactSelectCombobox(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if ((el.getAttribute('role') || '').toLowerCase() !== 'combobox') return false;
    return Boolean(el.closest('.select-shell, .select__container, [class*="select__control"]'));
  }

  function isGreenhouseLocationCombobox(el) {
    if (!isReactSelectCombobox(el)) return false;
    const id = (el.id || '').toLowerCase();
    if (id === 'candidate-location' || /candidate[-_]?location/.test(id)) return true;
    const ql = normalizeText(el.__questionTextHint || getQuestionText(el));
    if (/location\s*\(\s*city\s*\)/i.test(ql)) return true;
    if (/\blocation\b/.test(ql) && /\bcity\b/.test(ql)) return true;
    if (activeAdapter && activeAdapter.name === 'greenhouse' && /\blocation\b/.test(ql)) return true;
    return false;
  }

  function isAutocompletePanelOpen(scope) {
    if (!scope) return false;
    const panel = scope.matches('[class*="dropdown-container"]')
      ? scope
      : scope.querySelector('[class*="dropdown-container"]');
    if (!panel) return false;
    const style = window.getComputedStyle(panel);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = panel.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findHiddenMirrorInput(el) {
    if (!el) return null;
    const scopes = [el.parentElement, el.parentElement?.parentElement, el.closest('label, [class*="field"], [class*="application-field"]')].filter(Boolean);
    const selectors = [
      'input#selected-location',
      'input[type="hidden"][name="selectedLocation"]',
      'input[type="hidden"][name="selectedlocation"]',
      'input[type="hidden"][id*="selected"]',
      'input[type="hidden"][name*="selected"]',
      'input[type="hidden"][id*="autocomplete"]',
      'input[type="hidden"][name*="autocomplete"]',
      'input[type="hidden"][id*="place"]',
      'input[type="hidden"][name*="place"]'
    ];
    for (const scope of scopes) {
      for (const sel of selectors) {
        try {
          const found = scope.querySelector(sel);
          if (found && found !== el) return found;
        } catch (_) {}
      }
    }
    return null;
  }

  function isSearchAutocomplete(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type !== 'text' && type !== 'search') return false;

    // Lever location: hidden selectedLocation + location-input (dropdown may be empty at scan time)
    if (isLeverLocationInput(el) && findHiddenMirrorInput(el)) return true;

    // Greenhouse react-select Location (City) — options load only after typing
    if (isGreenhouseLocationCombobox(el)) return true;

    if (isRipplingLocationInput(el)) return true;

    const ariaAuto = (el.getAttribute('aria-autocomplete') || '').toLowerCase();
    if (ariaAuto === 'list' || ariaAuto === 'both') {
      if (findAutocompleteDropdown(el) || findHiddenMirrorInput(el)) return true;
    }

    const cls = el.className || '';
    if (AUTOCOMPLETE_INPUT_CLASS_RE.test(cls)) {
      if (findAutocompleteDropdown(el) || findHiddenMirrorInput(el)) return true;
    }

    const dataQa = el.getAttribute('data-qa') || '';
    if (/location-input|autocomplete|typeahead|search-input/i.test(dataQa)) {
      if (findAutocompleteDropdown(el) || findHiddenMirrorInput(el)) return true;
    }

    if (findHiddenMirrorInput(el) && findAutocompleteDropdown(el)) return true;

    return false;
  }

  function classifyFieldType(el, tagName, inputType, options, isCombobox, category) {
    if (el.isContentEditable) return 'rich-text';

    if (tagName === 'INPUT' && inputType === 'file') return 'file';

    if (tagName === 'SELECT') {
      if (el.multiple) return 'multi-select';
      if (isYesNoOptions(options)) return 'yes-no';
      return 'dropdown';
    }

    if (tagName === 'BUTTON' && isCombobox) return 'combobox';

    if (isCombobox) {
      const ariaMulti = el.getAttribute('aria-multiselectable') === 'true';
      if (ariaMulti || isWorkdayMultiselectInput(el)) return 'multi-combobox';
      if (isYesNoOptions(options)) return 'yes-no';
      if (!options.length && looksLikeYesNoQuestion(el.__questionTextHint, category)) return 'yes-no';
      if (isGreenhouseLocationCombobox(el) || isRipplingLocationInput(el) || (category === 'city' && isReactSelectCombobox(el))) {
        return 'search-autocomplete';
      }
      return 'combobox';
    }

    if (tagName === 'INPUT' && inputType === 'checkbox') {
      if (isAshbyYesNoField(el)) {
        const ashbyOpts = getAshbyYesNoOptions(el);
        if (ashbyOpts.length >= 2 && isYesNoOptions(ashbyOpts)) return 'yes-no';
      }
      if (isLeverCheckboxGroup(el)) {
        if (options.length <= 1 || isAcknowledgmentQuestion(el.__questionTextHint, options, el) || isLeverAcknowledgmentField(el)) {
          return 'checkbox';
        }
        return 'checkbox-group';
      }
      const name = el.getAttribute('name');
      if (name) {
        const group = document.querySelectorAll(`input[type="checkbox"][name="${cssEscape(name)}"]`);
        if (group.length > 1) {
          if (isYesNoOptions(options)) return 'yes-no';
          return 'checkbox-group';
        }
      }
      return 'checkbox';
    }

    if (tagName === 'INPUT' && inputType === 'radio') {
      if (isLeverMultipleChoiceGroup(el)) {
        if (isYesNoOptions(options) || (category && YES_NO_CATEGORIES.has(category))) return 'yes-no';
        return 'radio-group';
      }
      if (isYesNoOptions(options)) return 'yes-no';
      return 'radio-group';
    }

    if (tagName === 'TEXTAREA') return 'textarea';

    if (tagName === 'INPUT') {
      if ((inputType === 'text' || inputType === 'search') && (isSearchAutocomplete(el) || isLeverLocationInput(el))) {
        return 'search-autocomplete';
      }
      const map = {
        email: 'email',
        tel: 'phone',
        url: 'url',
        number: 'number',
        date: 'date',
        'datetime-local': 'datetime',
        month: 'month',
        week: 'week',
        time: 'time',
        range: 'slider',
        color: 'color',
        password: 'password',
        search: 'search'
      };
      if (map[inputType]) return map[inputType];
      return 'text';
    }

    return 'text';
  }

  const ACKNOWLEDGMENT_OPTION_RE = /\b(i have read( this)?|i acknowledge( that)?|i understand( that)?|i agree to read|i have reviewed|i certify that i have)\b/i;
  const ACKNOWLEDGMENT_DISCLOSURE_RE = /\b(polygraph|lie detector|statement|please read|important|disclosure|fingerprints|finra|securities industry regulations|employment history|professional references)\b/i;

  function isAcknowledgmentOptionText(text) {
    const t = normalizeText(text);
    if (!t || t === 'on' || t === 'yes' || t === 'no') return false;
    return ACKNOWLEDGMENT_OPTION_RE.test(t);
  }

  function collectAcknowledgmentOptions(el, options) {
    const seen = new Set();
    const out = [];
    const add = (raw) => {
      const t = trim(raw);
      if (!t || t === 'on') return;
      const key = normalizeText(t);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(t);
    };
    (options || []).forEach(add);
    if (el && el.tagName === 'INPUT') {
      if (isLeverFormElement(el)) add(getLeverOptionLabel(el));
      add(getLabelText(el));
      add(el.getAttribute('value'));
    }
    return out;
  }

  function getLeverQuestionBlockText(el) {
    if (!el || !isLeverFormElement(el)) return '';
    const container = leverAdapter.getQuestionContainer(el);
    if (!container) return '';
    const parts = [];
    container.querySelectorAll('.application-label .text, .application-label').forEach((node) => {
      const t = stripLeverLabelText(node);
      if (t && !parts.includes(t)) parts.push(t);
    });
    if (!parts.length) {
      container.querySelectorAll('h3, h4, h5, p').forEach((node) => {
        if (node.closest('.application-field, ul[data-qa], label')) return;
        const t = stripLeverLabelText(node);
        if (t && !parts.includes(t)) parts.push(t);
      });
    }
    return parts.join(' ');
  }

  function isLeverAcknowledgmentField(el) {
    if (!el || !isLeverFormElement(el)) return false;
    const inputType = (el.getAttribute('type') || '').toLowerCase();
    if (inputType !== 'checkbox' && inputType !== 'radio') return false;
    const optionTexts = collectAcknowledgmentOptions(el, getRadioOrCheckboxOptions(el));
    if (!optionTexts.some((o) => isAcknowledgmentOptionText(o))) return false;
    if (el.closest('ul[data-qa="checkboxes"]')) return true;
    const blockText = normalizeText(getLeverQuestionBlockText(el));
    if (blockText.length > 60 && ACKNOWLEDGMENT_DISCLOSURE_RE.test(blockText)) return true;
    if (ACKNOWLEDGMENT_DISCLOSURE_RE.test(blockText) && optionTexts.length === 1) return true;
    if (el.closest('.application-label.multiple-select, .application-label.full-width.multiple-select')) return true;
    return inputType === 'checkbox' && optionTexts.length === 1;
  }

  function isAcknowledgmentQuestion(questionText, options, el) {
    const opts = collectAcknowledgmentOptions(el, options).map((o) => normalizeText(o)).filter(Boolean);
    if (!opts.length) return false;
    const ackOpts = opts.filter((o) => isAcknowledgmentOptionText(o));
    if (!ackOpts.length) return false;
    if (ackOpts.length === opts.length) return true;
    if (opts.length === 1 && ackOpts.length === 1) return true;
    const L = normalizeText(questionText || getLeverQuestionBlockText(el));
    if (L.length > 80 && ackOpts.length >= 1) return true;
    if (ACKNOWLEDGMENT_DISCLOSURE_RE.test(L) && ackOpts.length >= 1) return true;
    if (el && isLeverAcknowledgmentField(el)) return true;
    return false;
  }

  function pickAcknowledgmentValue(options) {
    const opts = collectAcknowledgmentOptions(null, options).map((o) => trim(o)).filter(Boolean);
    const preferred = opts.find((o) => isAcknowledgmentOptionText(o));
    return preferred || opts[0] || 'I have read this';
  }

  function classifyField(rawText, tagName, inputType, options, el) {
    if (isAcknowledgmentQuestion(rawText, options, el)) {
      return { category: 'acknowledgment', confidence: 0.96 };
    }
    const text = normalizeText(rawText);
    const type = normalizeText(inputType);
    const optionText = normalizeText((options || []).join(' '));
    const all = `${text} ${type} ${optionText}`.trim();

    const fr = fieldRegistry();
    if (fr) {
      const fromRegistry = fr.matchByLabel(rawText);
      if (fromRegistry) return fromRegistry;
    }

    function has(...terms) {
      return terms.some((term) => all.includes(term));
    }

    function hasWord(word) {
      return new RegExp(`\\b${word}\\b`).test(all);
    }

    if (type === 'file' && has('cover letter', 'coverletter')) return { category: 'cover_letter_upload', confidence: 0.95 };
    if (type === 'file' && has('resume', 'cv', 'curriculum vitae')) return { category: 'resume_upload', confidence: 0.95 };
    if (has('cover letter', 'coverletter')) return { category: 'cover_letter_upload', confidence: 0.9 };
    if (has('resume', 'curriculum vitae') || hasWord('cv')) return { category: 'resume_upload', confidence: 0.9 };

    if (has('first name', 'given name')) return { category: 'first_name', confidence: 0.95 };
    if (has('last name', 'family name', 'surname')) return { category: 'last_name', confidence: 0.95 };
    if (has('preferred first name', 'preferred name')) return { category: 'first_name', confidence: 0.88 };
    if (has('full name', 'legal name') || (hasWord('name') && !has('company name', 'preferred name'))) return { category: 'full_name', confidence: 0.82 };
    if (type === 'email' || has('email', 'e mail')) return { category: 'email', confidence: 0.96 };
    if (type === 'tel' || has('phone', 'mobile', 'cell')) return { category: 'phone', confidence: 0.92 };
    if (has('street address', 'address line', 'mailing address') || (hasWord('street') && !has('wall street', 'email address'))) {
      return { category: 'address', confidence: 0.92 };
    }
    if (hasWord('address') && !has('email address', 'company address', 'ip address')) {
      return { category: 'address', confidence: 0.84 };
    }
    if (hasWord('city')) return { category: 'city', confidence: 0.9 };
    if (has('state province', 'province') || hasWord('state')) return { category: 'state', confidence: 0.86 };
    if (has('zip code', 'postal code', 'postcode') || hasWord('zip')) return { category: 'zip', confidence: 0.9 };
    if (has('sponsorship', 'visa sponsorship', 'require visa', 'require sponsorship', 'now or in the future')) return { category: 'sponsorship', confidence: 0.93 };
    if (has('authorized to work', 'legally authorized', 'eligible to work', 'work authorization')) {
      if (has('united states', ' u s ', ' usa', ' u s a')) return { category: 'work_authorization_us', confidence: 0.96 };
      if (has('canada')) return { category: 'work_authorization_ca', confidence: 0.96 };
      if (has('united kingdom', ' uk ')) return { category: 'work_authorization_uk', confidence: 0.96 };
      return { category: 'work_authorization', confidence: 0.9 };
    }
    if (has('lgbtq', 'lgbtq+', 'lgbt')) return { category: 'lgbtq_identity', confidence: 0.94 };
    if (hasWord('country') && !has('country of residence', 'country of birth', 'country of citizenship', 'home country', 'origin country', 'country of origin')) return { category: 'country', confidence: 0.9 };
    if (has('current company', 'employer')) return { category: 'current_company', confidence: 0.9 };
    if (has('linkedin profile', 'linked in profile', 'linkedin link') || (has('linkedin', 'linked in') && !has('github'))) return { category: 'linkedin', confidence: 0.94 };
    if (has('github', 'git hub')) return { category: 'github', confidence: 0.94 };
    if (has('portfolio', 'personal website', 'personal site')) return { category: 'portfolio', confidence: 0.86 };
    if (hasWord('website') && !has('company website', 'work website')) return { category: 'portfolio', confidence: 0.84 };
    if (has('salary', 'compensation', 'pay expectation', 'expected pay', 'desired pay')) return { category: 'salary', confidence: 0.86 };
    if (has('relocate', 'relocation', 'willing to move')) return { category: 'relocation', confidence: 0.86 };
    if (has('hispanic', 'latino', 'latinx', 'latin a') || has('spanish origin', 'hispanic origin')) return { category: 'hispanic_latino', confidence: 0.93 };
    if (has('transgender') || (has('identify') && has('trans'))) return { category: 'transgender', confidence: 0.9 };
    if (has('veteran', 'military service', 'armed forces')) return { category: 'veteran_status', confidence: 0.9 };
    if (has('disability', 'disabled', 'handicap', 'impairment')) return { category: 'disability_status', confidence: 0.88 };
    if (has('sexual orientation') || (has('describe') && has('sexual') && has('orientation'))) {
      return { category: 'sexual_orientation', confidence: 0.92 };
    }
    if (has('gender identity') || (has('describe') && has('gender') && has('identity'))) {
      return { category: 'gender_identity', confidence: 0.92 };
    }
    if (hasWord('gender') && !has('pay gap', 'equal pay', 'identity', 'sexual')) return { category: 'gender', confidence: 0.88 };
    if (has('what is your ethnicity', 'identify your race', 'please identify your race')) return { category: 'race', confidence: 0.93 };
    if (has('race', 'ethnicity', 'ethnic background', 'racial') || has('ethnic group')) return { category: 'race', confidence: 0.88 };
    if (has('decline to answer', 'prefer not', 'do not wish') && has('race', 'ethnicity', 'gender', 'veteran', 'disability', 'hispanic')) {
      if (has('race', 'ethnicity')) return { category: 'race', confidence: 0.75 };
      if (has('gender')) return { category: 'gender', confidence: 0.75 };
      if (has('veteran')) return { category: 'veteran_status', confidence: 0.75 };
      if (has('disability')) return { category: 'disability_status', confidence: 0.75 };
      if (has('hispanic', 'latino')) return { category: 'hispanic_latino', confidence: 0.75 };
    }
    if (has('notice period', 'start date', 'available to start')) return { category: 'notice_period', confidence: 0.8 };
    if (has('highest level of education', 'level of education you have completed')) return { category: 'education', confidence: 0.93 };
    if (has('institution name', 'name of institution')) return { category: 'school', confidence: 0.92 };
    if (has('degree or certification earned', 'degree or certification')) return { category: 'degree', confidence: 0.91 };
    if (has('location of institution')) return { category: 'city', confidence: 0.85 };
    if (has('attendance start date', 'attendence start date')) return { category: 'custom_question', confidence: 0.55 };
    if (has('attendence end date', 'attendance end date') && has('present')) return { category: 'graduation_year', confidence: 0.7 };
    if (has('degree', 'education', 'school', 'university', 'college')) return { category: 'education', confidence: 0.78 };
    if (has('years of experience', 'experience years', 'how many years')) return { category: 'experience_years', confidence: 0.86 };

    const isLongQuestion = text.length > 45 || /\?$/.test(trim(rawText));
    const isTextarea = tagName === 'TEXTAREA' || type === 'textarea';
    if (isTextarea || isLongQuestion) return { category: 'custom_question', confidence: 0.62 };

    return { category: 'unknown', confidence: 0.2 };
  }

  function makeDetectedField(el, index, scanRoot) {
    const tagName = el.tagName;
    const inputType = tagName === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : tagName.toLowerCase();
    const trustedLabel = getTrustedLabel(el);
    const questionText = getQuestionText(el);
    const isCombobox = isComboboxLike(el);
    let options = tagName === 'SELECT' ? getSelectOptions(el) :
      isCombobox ? readComboboxOptions(el) :
      (inputType === 'radio' || inputType === 'checkbox') ? getRadioOrCheckboxOptions(el) : [];
    if (inputType === 'radio' || inputType === 'checkbox') {
      options = collectAcknowledgmentOptions(el, options);
    }
    let classification = classifyField(questionText, tagName, inputType, options, el);
    let categoryFromName = false;

    if ((classification.category === 'unknown' || classification.confidence < 0.7) && activeAdapter.mapNameToCategory) {
      const adapterCategory = (activeAdapter.name === 'rippling' || activeAdapter.name === 'workday' || activeAdapter.name === 'ashby')
        ? activeAdapter.mapNameToCategory(el.getAttribute('name'), el)
        : activeAdapter.mapNameToCategory(el.getAttribute('name'));
      if (adapterCategory) {
        classification = { category: adapterCategory, confidence: 0.92 };
        categoryFromName = true;
      }
    }
    let employmentSlot;
    let employmentKey;
    if (!categoryFromName && activeAdapter.resolveFieldCategory) {
      const resolved = activeAdapter.resolveFieldCategory(el, questionText);
      if (resolved && resolved.skip) {
        return null;
      }
      if (resolved && resolved.category) {
        classification = { category: resolved.category, confidence: resolved.confidence || 0.95 };
        categoryFromName = true;
        if (resolved.employmentSlot !== undefined) employmentSlot = resolved.employmentSlot;
        if (resolved.employmentKey) employmentKey = resolved.employmentKey;
        if (resolved.suggestedDefault) classification.suggestedDefault = resolved.suggestedDefault;
      }
    }
    if (!categoryFromName && (classification.category === 'unknown' || classification.confidence < 0.7)
      && activeAdapter.mapIdToCategory) {
      const idCategory = (activeAdapter.name === 'rippling' || activeAdapter.name === 'lever' || activeAdapter.name === 'workday' || activeAdapter.name === 'ashby')
        ? activeAdapter.mapIdToCategory(el.getAttribute('id'), el)
        : activeAdapter.mapIdToCategory(el.getAttribute('id'));
      if (idCategory) {
        classification = { category: idCategory, confidence: 0.9 };
        categoryFromName = true;
      }
    }

    el.__questionTextHint = questionText;
    const fieldType = classifyFieldType(el, tagName, inputType, options, isCombobox, classification.category);
    try { delete el.__questionTextHint; } catch (_) {}

    const voluntary = activeAdapter && typeof activeAdapter.isVoluntaryField === 'function'
      ? Boolean(activeAdapter.isVoluntaryField(el))
      : false;
    const optional = activeAdapter && typeof activeAdapter.isOptionalField === 'function'
      ? Boolean(activeAdapter.isOptionalField(el))
      : false;
    const required = activeAdapter?.name === 'rippling' && typeof activeAdapter.isRipplingFieldRequired === 'function'
      ? Boolean(activeAdapter.isRipplingFieldRequired(el))
      : Boolean(el.required || el.getAttribute('aria-required') === 'true');

    return {
      id: `field_${index}_${Math.random().toString(36).slice(2, 8)}`,
      tagName,
      inputType,
      name: el.getAttribute('name') || '',
      idAttr: el.getAttribute('id') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      placeholder: el.getAttribute('placeholder') || '',
      labelText: getLabelText(el),
      nearbyText: getNearbyText(el),
      questionText,
      trustedLabel,
      hasMeaningfulLabel: Boolean(trustedLabel),
      categoryFromName,
      fromTemplate: categoryFromName,
      options,
      required,
      value: tagName === 'SELECT' ? (el.options[el.selectedIndex] && el.options[el.selectedIndex].text) || el.value : (el.value || ''),
      fieldCategory: classification.category,
      confidence: classification.confidence,
      voluntary,
      optional,
      isCombobox,
      fieldType,
      optionsResolvedAtFill: isCombobox && !options.length,
      employmentSlot,
      employmentKey,
      suggestedDefault: classification.suggestedDefault || '',
      elementPath: getElementPath(el),
      signature: getElementSignature(el, scanRoot)
    };
  }

  const NOISY_CATEGORIES_WITHOUT_LABEL = new Set(['unknown', 'custom_question']);

  function isNoisyDetection(detected) {
    if (!detected) return true;
    if (detected.fromTemplate) return false;
    if (detected.categoryFromName) return false;
    if ((detected.confidence || 0) >= 0.85) return false;
    if (detected.isCombobox && RIPPLING_GENERIC_COMBOBOX_LABEL_RE.test(trim(detected.questionText || ''))) {
      if (!detected.fromTemplate && !detected.categoryFromName) return true;
    }
    if (detected.hasMeaningfulLabel) return false;
    return NOISY_CATEGORIES_WITHOUT_LABEL.has(detected.fieldCategory);
  }

  function scanApplicationForm() {
    const pick = pickAdapterWithDebug();
    activeAdapter = pick.adapter;
    const scanRoot = pick.scanRoot;
    let selector = [
      'input',
      'textarea',
      'select',
      '[contenteditable="true"]',
      '[role="combobox"]'
    ];
    if (activeAdapter.name === 'workday') {
      selector.push('button[aria-haspopup="listbox"]');
    }

    const fields = [];
    let skipped = 0;
    let skippedOutsideRoot = 0;
    const seenRadioGroups = new Set();
    const seenComboboxControls = new WeakSet();
    const elements = Array.from(scanRoot.querySelectorAll(selector.join(',')));

    for (const el of elements) {
      if (pick.scopedScan && scanRoot !== document && !scanRoot.contains(el)) {
        skippedOutsideRoot += 1;
        continue;
      }
      if (activeAdapter.name === 'greenhouse' && el.id === 'country' && el.closest('.phone-input, fieldset.phone-input')) {
        skipped += 1;
        continue;
      }
      if (shouldSkipRipplingScanElement(el)) {
        skipped += 1;
        continue;
      }
      if (shouldSkipLeverScanElement(el)) {
        skipped += 1;
        continue;
      }
      if (shouldSkipWorkdayScanElement(el)) {
        skipped += 1;
        continue;
      }
      if (shouldSkipAshbyScanElement(el)) {
        skipped += 1;
        continue;
      }
      const tag = el.tagName;
      const type = tag === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : tag.toLowerCase();
      const isFileInput = tag === 'INPUT' && type === 'file';
      const ashbyHiddenChoice = activeAdapter.name === 'ashby'
        && (type === 'radio' || type === 'checkbox')
        && el.closest('.ashby-application-form-field-entry, [data-field-path], fieldset');
      if (!isFileInput && !ashbyHiddenChoice && (!isVisible(el) || el.disabled || el.readOnly)) continue;
      if (isFileInput && el.disabled) continue;
      if (tag === 'INPUT' && SKIP_INPUT_TYPES.has(type)) continue;
      if (tag === 'BUTTON' && activeAdapter.name !== 'workday') continue;

      if ((type === 'radio' || type === 'checkbox') && el.name) {
        const key = `${type}:${el.name}`;
        if (seenRadioGroups.has(key)) continue;
        seenRadioGroups.add(key);
      }

      if (isComboboxLike(el)) {
        const control = findComboboxControl(el);
        if (seenComboboxControls.has(control)) continue;
        seenComboboxControls.add(control);
      }

      const detected = makeDetectedField(el, fields.length, scanRoot);
      if (!detected) {
        skipped += 1;
        continue;
      }
      if (isFileInput && !detected.categoryFromName && detected.fieldCategory === 'unknown') {
        const ghId = (el.getAttribute('id') || '').toLowerCase();
        if (ghId === 'resume' || ghId === 'cover_letter') {
          detected.fieldCategory = ghId === 'resume' ? 'resume_upload' : 'cover_letter_upload';
          detected.categoryFromName = true;
          detected.confidence = 0.95;
        }
        if (activeAdapter.name === 'rippling') {
          const token = ripplingAdapter.getFieldToken(el);
          if (token === 'resume') {
            detected.fieldCategory = 'resume_upload';
            detected.categoryFromName = true;
            detected.confidence = 0.96;
          } else if (token === 'cover_letter') {
            detected.fieldCategory = 'cover_letter_upload';
            detected.categoryFromName = true;
            detected.confidence = 0.96;
          }
        }
        if (activeAdapter.name === 'lever') {
          const qa = el.getAttribute('data-qa') || '';
          if (qa === 'input-resume' || el.name === 'resume') {
            detected.fieldCategory = 'resume_upload';
            detected.categoryFromName = true;
            detected.confidence = 0.96;
          } else if (qa === 'application-file-upload' || /cover\s*letter/i.test(detected.questionText || '')) {
            detected.fieldCategory = 'cover_letter_upload';
            detected.categoryFromName = true;
            detected.confidence = 0.95;
          }
        }
        if (activeAdapter.name === 'ashby') {
          const fromPath = mapAshbyFieldPath(getAshbyFieldPath(el));
          if (fromPath) {
            detected.fieldCategory = fromPath;
            detected.categoryFromName = true;
            detected.confidence = 0.97;
          } else if (el.id === '_systemfield_resume') {
            detected.fieldCategory = 'resume_upload';
            detected.categoryFromName = true;
            detected.confidence = 0.97;
          }
        }
      }
      if (isNoisyDetection(detected)) {
        skipped += 1;
        continue;
      }

      fields.push(detected);
    }

    return {
      success: true,
      url: window.location.href,
      title: document.title,
      adapter: activeAdapter.name,
      adapterScore: pick.score,
      adapterRankings: pick.rankings,
      adapterThreshold: pick.threshold,
      scanRoot: pick.scanRootLabel,
      scopedScan: pick.scopedScan,
      fields,
      skipped,
      skippedOutsideRoot
    };
  }

  function getAdapterDebugInfo() {
    const pick = pickAdapterWithDebug();
    activeAdapter = pick.adapter;
    return {
      success: true,
      adapter: pick.adapter.name,
      adapterScore: pick.score,
      adapterRankings: pick.rankings,
      adapterThreshold: pick.threshold,
      scanRoot: pick.scanRootLabel,
      scopedScan: pick.scopedScan,
      url: window.location.href
    };
  }

  function getJobFields() {
    const pick = pickAdapterWithDebug();
    activeAdapter = pick.adapter;
    const adapterInfo = activeAdapter.getJobInfo ? (activeAdapter.getJobInfo() || {}) : {};
    const workdayInfo = (isWorkdayHost() || isWorkdayPageContext()) ? getWorkdayJobPostingInfo() : {};
    const ripplingInfo = (isRipplingHost() || isRipplingPageContext()) ? getRipplingJobPostingInfo() : {};
    const greenhouseInfo = isGreenhouseHost() ? getGreenhouseJobPostingInfo() : {};
    const smartRecruitersInfo = isSmartRecruitersHost() ? getSmartRecruitersJobPostingInfo() : {};
    const ashbyInfo = isAshbyHost() ? getAshbyJobPostingInfo() : {};
    const bamboohrInfo = isBamboohrHost() ? getBamboohrJobPostingInfo() : {};
    const leverInfo = isLeverHost() ? getLeverJobPostingInfo() : {};
    const workableInfo = isWorkableHost() ? getWorkableJobPostingInfo() : {};
    const doverInfo = isDoverHost() ? getDoverJobPostingInfo() : {};
    const jsonLd = readJobPostingJsonLd();
    const metaTitle = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]')?.content || '';
    const titleCandidates = [
      adapterInfo.job_title,
      doverInfo.job_title,
      workableInfo.job_title,
      leverInfo.job_title,
      bamboohrInfo.job_title,
      ashbyInfo.job_title,
      smartRecruitersInfo.job_title,
      greenhouseInfo.job_title,
      ripplingInfo.job_title,
      workdayInfo.job_title,
      jsonLd?.title,
      document.querySelector(
        '[data-automation-id="jobPostingHeader"], [data-automation-id="jobTitleHeading"], [data-testid*="job-title" i], [class*="job-title" i], [class*="JobTitle"], h1, h2'
      )?.textContent,
      metaTitle.split('|')[0],
      document.title.split('|')[0]
    ].map(cleanTitle).filter(Boolean);

    const companyCandidates = [
      workdayInfo.company_name,
      resolveWorkdayCompanyName(),
      bamboohrInfo.company_name,
      resolveBamboohrCompanyName(),
      ashbyInfo.company_name,
      resolveAshbyCompanyName(),
      smartRecruitersInfo.company_name,
      resolveSmartRecruitersCompanyName(),
      greenhouseInfo.company_name,
      resolveGreenhouseCompanyName(),
      leverInfo.company_name,
      resolveLeverCompanyName(),
      workableInfo.company_name,
      resolveWorkableCompanyName(),
      doverInfo.company_name,
      resolveDoverCompanyName(),
      ripplingInfo.company_name,
      resolveRipplingCompanyName(),
      adapterInfo.company_name,
      jsonLd?.hiringOrganization?.name || jsonLd?.hiringOrganization,
      document.querySelector('[data-testid*="company" i], [class*="company" i], [class*="Company"], a[href*="/company"], a[href*="/companies"]')?.textContent,
      parseCompanyFromTitle(metaTitle),
      parseCompanyFromTitle(document.title)
    ]
      .map(cleanCompany)
      .filter((name) => Boolean(name) && !isUnreliableWorkdayCompanyName(name));

    const descriptionCandidates = [
      adapterInfo.job_description,
      doverInfo.job_description,
      workableInfo.job_description,
      leverInfo.job_description,
      bamboohrInfo.job_description,
      ashbyInfo.job_description,
      smartRecruitersInfo.job_description,
      greenhouseInfo.job_description,
      ripplingInfo.job_description,
      workdayInfo.job_description,
      isBamboohrHost() ? extractBamboohrJobDescription(document) : '',
      isAshbyHost() ? extractAshbyJobDescription(document) : '',
      isSmartRecruitersHost() ? extractSmartRecruitersJobDescription(document) : '',
      isGreenhouseHost() ? extractGreenhouseJobDescription(document) : '',
      isLeverHost() ? extractLeverJobDescription(document) : '',
      isWorkableHost() ? appendWorkableCompanyDescription(extractWorkableJobDescription(document)) : '',
      isDoverHost() ? extractDoverJobDescription(document) : '',
      (isRipplingHost() || isRipplingPageContext()) ? extractRipplingJobDescription(document) : '',
      jsonLd?.description,
      extractWorkdayJobDescription(document)
    ]
      .map(normalizeJobDescriptionCandidate)
      .filter(Boolean);

    return {
      success: true,
      adapter: activeAdapter.name,
      adapterScore: pick.score,
      adapterRankings: pick.rankings,
      scanRoot: pick.scanRootLabel,
      job_title: titleCandidates[0] || '',
      company_name: companyCandidates[0] || '',
      job_description: descriptionCandidates[0] || '',
      job_link: window.location.href
    };
  }

  function readJobPostingJsonLd() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
      try {
        const parsed = JSON.parse(script.textContent || '{}');
        const candidates = Array.isArray(parsed) ? parsed : [parsed, ...(parsed['@graph'] || [])];
        const job = candidates.find((item) => item && (item['@type'] === 'JobPosting' || (Array.isArray(item['@type']) && item['@type'].includes('JobPosting'))));
        if (job) return job;
      } catch (_) {}
    }
    return null;
  }

  function cleanTitle(value) {
    const text = trim(value);
    if (!text || text.length > 220) return '';
    return text.replace(/\s+[-|]\s+Apply.*$/i, '').replace(/\s+job\s*$/i, '').trim();
  }

  function cleanCompany(value) {
    const text = trim(typeof value === 'string' ? value : value?.name);
    if (!text || text.length > 160) return '';
    if (/^(apply|jobs|careers|home|sign in|login)$/i.test(text)) return '';
    return text;
  }

  function parseCompanyFromTitle(title) {
    const text = trim(title);
    if (!text) return '';
    const parts = text.split(/\s+[|–—-]\s+/).map(trim).filter(Boolean);
    if (parts.length >= 2) return parts[1].replace(/^careers? at\s+/i, '');
    const match = text.match(/at\s+([^|–—-]+)/i);
    return match ? trim(match[1]) : '';
  }

  function parseDataUrl(dataUrl) {
    const raw = String(dataUrl || '');
    const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(raw);
    if (!m) return null;
    const mime = (m[1] || 'application/octet-stream').trim();
    const isBase64 = Boolean(m[2]);
    const data = m[3] || '';
    return { mime, isBase64, data };
  }

  function dataUrlToFile(dataUrl, name, mimeType) {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return null;
    const fileName = name || 'upload.bin';
    const type = mimeType || parsed.mime || 'application/octet-stream';
    try {
      if (parsed.isBase64) {
        const binary = atob(parsed.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return new File([bytes], fileName, { type });
      }
      return new File([decodeURIComponent(parsed.data)], fileName, { type });
    } catch (_) {
      return null;
    }
  }

  function fileMatchesAccept(file, acceptAttr) {
    if (!file || !acceptAttr) return true;
    const tokens = String(acceptAttr).toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
    if (!tokens.length) return true;
    const ext = (String(file.name || '').match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    const mime = (file.type || '').toLowerCase();
    return tokens.some((token) => {
      if (token === '*/*') return true;
      if (token.startsWith('.') && ext === token) return true;
      if (token.endsWith('/*') && mime.startsWith(token.slice(0, -1))) return true;
      return mime === token;
    });
  }

  function isGreenhouseFileInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if ((el.getAttribute('type') || '').toLowerCase() !== 'file') return false;
    const id = (el.getAttribute('id') || '').toLowerCase();
    if (id === 'resume' || id === 'cover_letter' || id === 'cover-letter') return true;
    return Boolean(
      el.closest('.file-upload, .file-upload__wrapper, .button-container, [class*="file-upload"]')
      && (activeAdapter.name === 'greenhouse' || /greenhouse/i.test(location.hostname))
    );
  }

  function findRipplingKitFileInput(category) {
    if (!isRipplingFormContext() || !category) return null;
    const token = category === 'resume_upload' ? 'resume' : category === 'cover_letter_upload' ? 'cover_letter' : null;
    if (!token) return null;
    const byInput = findRipplingInputEl(token);
    if (byInput && byInput.tagName === 'INPUT' && (byInput.getAttribute('type') || '').toLowerCase() === 'file') {
      return byInput;
    }
    const wrapper = document.querySelector(`[data-testid="${token}"]`);
    if (wrapper) {
      const nested = wrapper.querySelector('input[type="file"]');
      if (nested) return nested;
    }
    return null;
  }

  function isRipplingFileInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    if ((el.getAttribute('type') || '').toLowerCase() !== 'file') return false;
    if (!isRipplingFormContext()) return false;
    const testId = (el.getAttribute('data-testid') || '').toLowerCase();
    if (testId === 'input-resume' || testId === 'input-cover_letter') return true;
    return Boolean(el.closest('[data-testid="resume"], [data-testid="cover_letter"]'));
  }

  function findKitFileInput(el, category) {
    if (!el && !category) return null;

    const ripplingFile = findRipplingKitFileInput(category);
    if (ripplingFile) return ripplingFile;

    const ashbyFile = findAshbyKitFileInput(category);
    if (ashbyFile) return ashbyFile;

    const leverFile = findLeverKitFileInput(category);
    if (leverFile) return leverFile;

    const scope = (el && (el.closest('form, #application_form, #application-form, main') || el.form)) || document;

    const idByCategory = {
      resume_upload: ['resume', 'cv', 'curriculum_vitae'],
      cover_letter_upload: ['cover_letter', 'cover-letter']
    };
    const wantIds = idByCategory[category] || [];
    for (const id of wantIds) {
      const byId = document.getElementById(id);
      if (byId && byId.tagName === 'INPUT' && (byId.getAttribute('type') || '').toLowerCase() === 'file') {
        return byId;
      }
    }

    const pattern = category === 'resume_upload'
      ? /resume|cv|curriculum/i
      : category === 'cover_letter_upload'
        ? /cover[\s_-]*letter/i
        : null;

    const candidates = scope.querySelectorAll('input[type="file"]');
    for (const input of candidates) {
      const token = ripplingAdapter.getFieldToken(input);
      if (category === 'resume_upload' && token === 'resume') return input;
      if (category === 'cover_letter_upload' && token === 'cover_letter') return input;
      const hint = `${input.name || ''} ${input.id || ''} ${input.getAttribute('data-testid') || ''} ${getQuestionText(input)}`.toLowerCase();
      if (pattern && pattern.test(hint)) return input;
    }

    if (category === 'resume_upload') {
      for (const input of candidates) {
        const hint = `${input.name || ''} ${input.id || ''} ${getQuestionText(input)}`.toLowerCase();
        if (/resume|cv|curriculum/.test(hint)) return input;
      }
    }

    if (category === 'cover_letter_upload') {
      for (const input of candidates) {
        const hint = `${input.name || ''} ${input.id || ''} ${input.getAttribute('data-testid') || ''} ${getQuestionText(input)}`.toLowerCase();
        if (/cover[\s_-]*letter/.test(hint)) return input;
      }
    }

    return null;
  }

  function findResumeFileInputNear(el) {
    return findKitFileInput(el, 'resume_upload');
  }

  function findCoverLetterFileInputNear(el) {
    return findKitFileInput(el, 'cover_letter_upload');
  }

  function uploadKindFromFieldCategory(category) {
    if (category === 'resume_upload') return 'resume';
    if (category === 'cover_letter_upload') return 'coverLetter';
    return null;
  }

  function storageLocalGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          if (chrome.runtime.lastError) resolve({});
          else resolve(result || {});
        });
      } catch (_) {
        resolve({});
      }
    });
  }

  async function loadKitUploadFromStorage(kind) {
    if (!kind) return null;
    const result = await storageLocalGet([KIT_STORAGE_KEY]);
    const kits = Array.isArray(result[KIT_STORAGE_KEY]) ? result[KIT_STORAGE_KEY] : [];
    if (!kits.length) return null;
    const kit = kits.find((k) => k && k.isDefault) || kits[0];
    if (!kit) return null;
    const file = kind === 'resume' ? kit.resume : kind === 'coverLetter' ? kit.coverLetter : null;
    if (!file || !file.dataUrl) return null;
    return {
      name: file.name || (kind === 'resume' ? 'resume.pdf' : 'cover_letter.pdf'),
      type: file.type || '',
      size: file.size,
      dataUrl: file.dataUrl
    };
  }

  async function resolveUploadFile(payload) {
    if (payload.uploadFile && payload.uploadFile.dataUrl) {
      return payload.uploadFile;
    }
    const kind = payload.uploadKitKind || uploadKindFromFieldCategory(payload.fieldCategory);
    if (!kind) return null;
    return loadKitUploadFromStorage(kind);
  }

  function assignFilesToInput(el, fileList) {
    const dt = new DataTransfer();
    for (let i = 0; i < fileList.length; i += 1) {
      dt.items.add(fileList[i]);
    }
    const files = dt.files;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(el, files);
      } else {
        el.files = files;
      }
    } catch (_) {
      el.files = files;
    }
    return files;
  }

  function dispatchFileInputEvents(el) {
    const eventInit = { bubbles: true, cancelable: true, composed: true };
    try {
      el.dispatchEvent(new InputEvent('input', { ...eventInit, inputType: 'insertReplacementText' }));
    } catch (_) {
      el.dispatchEvent(new Event('input', eventInit));
    }
    el.dispatchEvent(new Event('change', eventInit));
  }

  function tryGreenhouseDragDropUpload(el, file) {
    const zone = el.closest('.file-upload__wrapper, .file-upload, .button-container');
    if (!zone || !file) return false;
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      for (const type of ['dragenter', 'dragover', 'drop']) {
        zone.dispatchEvent(new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer: dt
        }));
      }
      return Boolean(el.files && el.files.length);
    } catch (_) {
      return false;
    }
  }

  function greenhouseUploadAppearsComplete(el, fileName) {
    if (!el.files || !el.files.length) return false;
    const root = el.closest('.file-upload, .field-wrapper, .field');
    if (!root) return true;
    const base = String(fileName || el.files[0].name || '').replace(/\.[^.]+$/, '').toLowerCase();
    const text = (root.textContent || '').toLowerCase();
    if (base && base.length >= 3 && text.includes(base)) return true;
    const hasFilenameClass = root.querySelector(
      '[class*="filename"], [class*="file-name"], [class*="file_name"], [data-testid*="file"]'
    );
    if (hasFilenameClass && trim(hasFilenameClass.textContent || '')) return true;
    return true;
  }

  function fillFileInput(el, uploadFile) {
    if (!el || el.tagName !== 'INPUT' || (el.getAttribute('type') || '').toLowerCase() !== 'file') {
      return { success: false, error: 'Target is not a file input.' };
    }
    if (!uploadFile || !uploadFile.dataUrl) {
      return { success: false, error: 'No file attached for upload.' };
    }

    const file = dataUrlToFile(uploadFile.dataUrl, uploadFile.name, uploadFile.type);
    if (!file) return { success: false, error: 'Could not decode file from kit storage.' };

    const accept = el.getAttribute('accept') || '';
    if (!fileMatchesAccept(file, accept)) {
      return {
        success: false,
        error: `Kit file "${file.name}" does not match accept="${accept || 'any'}".`
      };
    }

    try {
      assignFilesToInput(el, [file]);
      dispatchFileInputEvents(el);
      if (el.files && el.files.length) {
        return { success: true, fileName: file.name };
      }
      return { success: false, error: 'Browser blocked file assignment on this input.' };
    } catch (err) {
      return { success: false, error: err.message || 'File upload failed.' };
    }
  }

  function tryRipplingDragDropUpload(zone, file) {
    if (!zone || !file) return false;
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      for (const type of ['dragenter', 'dragover', 'drop']) {
        zone.dispatchEvent(new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer: dt
        }));
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function ripplingUploadAppearsComplete(el, fileName) {
    if (el?.files?.length) return true;
    const zone = el?.closest('[data-testid="field"], [data-testid="resume"], [data-testid="cover_letter"]');
    if (!zone) return false;
    const statusEl = zone.querySelector('[data-testid="screen-reader-only"][id^="file-input"]');
    if (statusEl && /total\s+[1-9]\d*\s+file/i.test(statusEl.textContent || '')) return true;
    const base = String(fileName || '').replace(/\.[^.]+$/, '').toLowerCase();
    if (base.length >= 2 && (zone.textContent || '').toLowerCase().includes(base)) return true;
    const dropBtn = zone.querySelector('button[data-testid="test_button"] span');
    const btnText = trim(dropBtn?.textContent || zone.querySelector('button')?.textContent || '');
    if (btnText && !/drop or select/i.test(btnText)) return true;
    return false;
  }

  async function fillRipplingFileInput(el, uploadFile, category) {
    if (!uploadFile?.dataUrl) {
      return { success: false, error: 'No file attached for upload.' };
    }

    const file = dataUrlToFile(uploadFile.dataUrl, uploadFile.name, uploadFile.type);
    if (!file) return { success: false, error: 'Could not decode file from kit storage.' };

    let target = el;
    if (!target || target.tagName !== 'INPUT' || (target.getAttribute('type') || '').toLowerCase() !== 'file') {
      target = findRipplingKitFileInput(category) || findKitFileInput(el, category);
    }
    if (!target) {
      return { success: false, error: 'Could not find Rippling file upload input.' };
    }

    const accept = target.getAttribute('accept') || '';
    if (!fileMatchesAccept(file, accept)) {
      return {
        success: false,
        error: `Kit file "${file.name}" does not match accept="${accept || 'any'}".`
      };
    }

    try {
      try { target.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
      const zone = target.closest('[data-testid="resume"], [data-testid="cover_letter"], [data-testid="field"]') || target.parentElement;

      assignFilesToInput(target, [file]);
      dispatchFileInputEvents(target);

      if (zone) {
        tryRipplingDragDropUpload(zone, file);
        try {
          zone.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        } catch (_) {}
      }

      if (!target.files?.length) {
        assignFilesToInput(target, [file]);
        dispatchFileInputEvents(target);
      }

      await delay(120);

      const inputHasFiles = Boolean(target.files?.length);
      if (inputHasFiles && !ripplingUploadAppearsComplete(target, file.name)) {
        await delay(220);
      }

      const uploadComplete = ripplingUploadAppearsComplete(target, file.name);
      // Never click Rippling upload labels/buttons here: that opens the native file picker.
      // Autofill should stay non-interactive and rely only on synthetic file assignment/events.
      if (!uploadComplete && !inputHasFiles) {
        await delay(150);
      }

      if (target.files?.length || ripplingUploadAppearsComplete(target, file.name)) {
        return { success: true, fileName: file.name };
      }

      return {
        success: false,
        error: 'Could not attach file on Rippling. Try choosing the file once manually, then reload and fill again.'
      };
    } catch (err) {
      return { success: false, error: err.message || 'Rippling file upload failed.' };
    }
  }

  async function fillGreenhouseFileInput(el, uploadFile) {
    if (!uploadFile || !uploadFile.dataUrl) {
      return { success: false, error: 'No file attached for upload.' };
    }

    const file = dataUrlToFile(uploadFile.dataUrl, uploadFile.name, uploadFile.type);
    if (!file) return { success: false, error: 'Could not decode file from kit storage.' };

    const accept = el.getAttribute('accept') || '';
    if (!fileMatchesAccept(file, accept)) {
      return {
        success: false,
        error: `Kit file "${file.name}" does not match accept="${accept || 'any'}".`
      };
    }

    try {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
      el.focus();

      assignFilesToInput(el, [file]);
      dispatchFileInputEvents(el);

      if (!el.files || !el.files.length) {
        tryGreenhouseDragDropUpload(el, file);
        dispatchFileInputEvents(el);
      }

      if (!el.files || !el.files.length) {
        assignFilesToInput(el, [file]);
        dispatchFileInputEvents(el);
      }

      await delay(120);

      if (!greenhouseUploadAppearsComplete(el, file.name)) {
        return {
          success: false,
          error: 'Could not attach file to Greenhouse. Try clicking Attach once, or reload the page and fill again.'
        };
      }

      return { success: true, fileName: file.name };
    } catch (err) {
      return { success: false, error: err.message || 'Greenhouse file upload failed.' };
    }
  }

  async function fillKitUploadField(target, payload) {
    const uploadFile = await resolveUploadFile(payload);
    if (!uploadFile) {
      return {
        success: false,
        error: 'No file in your default application kit. Add a resume or cover letter under Profile → Application kits.'
      };
    }
    const category = payload.fieldCategory || uploadKindFromFieldCategory(payload.uploadKitKind);
    if (isAshbyFileInput(target) || (isAshbyFormContext() && category && findAshbyKitFileInput(category))) {
      return fillAshbyFileInput(target, uploadFile, category);
    }
    if (isRipplingFileInput(target) || (isRipplingFormContext() && category && findRipplingKitFileInput(category))) {
      return fillRipplingFileInput(target, uploadFile, category);
    }
    if (isLeverFileInput(target) || (isLeverFormContext() && category && findLeverKitFileInput(category))) {
      return fillLeverFileInput(target, uploadFile);
    }
    if (isGreenhouseFileInput(target)) {
      return fillGreenhouseFileInput(target, uploadFile);
    }
    return fillFileInput(target, uploadFile);
  }

  function setNativeCheckboxChecked(checkbox, checked) {
    if (!checkbox || checkbox.type !== 'checkbox') return false;
    if (checkbox.checked === checked) return true;

    try {
      const tracker = checkbox._valueTracker;
      if (tracker && typeof tracker.setValue === 'function') {
        tracker.setValue(String(checkbox.checked));
      }
    } catch (_) {}

    const checkedSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
    if (checkedSetter) {
      checkedSetter.call(checkbox, checked);
    } else {
      checkbox.checked = checked;
    }

    try {
      checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch (_) {
      checkbox.dispatchEvent(new Event('click', { bubbles: true }));
    }
    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    return checkbox.checked === checked;
  }

  function fillCheckboxControl(checkbox, checked) {
    if (!checkbox || checkbox.type !== 'checkbox') return false;
    if (checkbox.checked === checked) return true;

    const label = checkbox.closest('label');
    if (label && checked) {
      try { label.click(); } catch (_) {}
      if (checkbox.checked === checked) return true;
    }

    if (setNativeCheckboxChecked(checkbox, checked)) return true;

    if (label && checked) {
      try { label.click(); } catch (_) {}
    }
    return checkbox.checked === checked;
  }

  function findLeverAcknowledgmentCheckbox(payload) {
    if (!isLeverFormContext()) return null;
    const sig = payload?.signature;
    const root = document.querySelector('#application-form, form#application-form') || document;

    if (sig?.name) {
      try {
        const byName = root.querySelector(
          `ul[data-qa="checkboxes"] input[type="checkbox"][name="${cssEscape(sig.name)}"]`
        ) || root.querySelector(`input[type="checkbox"][name="${cssEscape(sig.name)}"]`);
        if (byName) return byName;
      } catch (_) {}
    }

    const want = normalizeText(payload?.value || 'I have read this');
    const candidates = root.querySelectorAll('ul[data-qa="checkboxes"] input[type="checkbox"]');
    for (const cb of candidates) {
      const label = normalizeText(getLeverOptionLabel(cb) || getLabelText(cb) || cb.value || '');
      if (label && (label === want || isAcknowledgmentOptionText(label))) return cb;
    }
    return null;
  }

  function setNativeValue(element, value, opts = {}) {
    const emitInput = opts.emitInput !== false;
    const emitBlur = opts.emitBlur === true;
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }

    if (emitInput) {
      try {
        element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: value, inputType: 'insertText' }));
      } catch (_) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (emitBlur) element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function coerceSingleProfileValue(value) {
    const fr = fieldRegistry();
    return fr ? fr.coerceSingleProfileValue(value) : String(value || '').trim();
  }

  function isDemographicCategory(category) {
    const fr = fieldRegistry();
    return fr ? fr.isDemographicCategory(category) : false;
  }

  function normalizeDemographicFillValue(category, value) {
    const fr = fieldRegistry();
    return fr ? fr.normalizeDemographicFillValue(category, value) : value;
  }

  function getDemographicCandidates(category, value) {
    const fr = fieldRegistry();
    return fr ? fr.getDemographicCandidates(category, value) : [String(value || '').trim()];
  }

  function demographicOptionScore(optionText, targetText, category) {
    const fr = fieldRegistry();
    return fr
      ? fr.demographicOptionScore(optionText, targetText, category)
      : optionScore(optionText, targetText);
  }

  function optionScore(optionText, targetText) {
    const a = normalizeText(optionText);
    const b = normalizeText(targetText);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.8;
    const aTokens = new Set(a.split(' '));
    const bTokens = new Set(b.split(' '));
    let overlap = 0;
    bTokens.forEach((token) => { if (aTokens.has(token)) overlap += 1; });
    return overlap / Math.max(aTokens.size, bTokens.size);
  }

  function fillSelect(select, value, threshold) {
    const cutoff = typeof threshold === 'number' ? threshold : 0.5;
    const options = Array.from(select.options || []);
    let best = null;
    let bestScore = 0;
    for (const option of options) {
      const score = Math.max(optionScore(option.value, value), optionScore(option.textContent, value));
      if (score > bestScore) {
        best = option;
        bestScore = score;
      }
    }
    if (!best || bestScore < cutoff) return { success: false, error: 'No matching select option.' };
    select.value = best.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  }

  function fillAcknowledgmentControl(el, value, options) {
    const pick = trim(value) || pickAcknowledgmentValue(options);
    if (el.type === 'checkbox') {
      if (!fillCheckboxControl(el, true)) {
        return { success: false, error: 'Could not check acknowledgment checkbox on page.' };
      }
      return { success: true };
    }
    const name = el.getAttribute('name');
    const group = name
      ? Array.from(document.querySelectorAll(`input[type="radio"][name="${cssEscape(name)}"]`))
      : [el];
    let target = null;
    for (const radio of group) {
      const label = getLabelText(radio) || radio.value || '';
      if (normalizeText(label) === normalizeText(pick)) {
        target = radio;
        break;
      }
      if (isAcknowledgmentOptionText(label) || isAcknowledgmentOptionText(radio.value)) {
        target = radio;
        break;
      }
    }
    if (!target && group.length === 1) target = group[0];
    if (!target) return { success: false, error: 'Acknowledgment option not found.' };
    target.click();
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  }

  function fillRadioOrCheckbox(el, value, category, threshold, options) {
    if (isAshbyYesNoField(el)) {
      return fillAshbyYesNo(el, value, category, threshold);
    }
    const cutoff = typeof threshold === 'number' ? threshold : 0.45;
    let normalized = normalizeText(value);
    if (isWorkdayFormContext() && el.type === 'radio') {
      if (/^(yes|y|true)$/.test(normalized)) normalized = 'true';
      if (/^(no|n|false)$/.test(normalized)) normalized = 'false';
    }
    const risky = /(terms|condition|certif|agree|consent|privacy|accurate|truth|background|signature)/i;
    const text = getQuestionText(el);
    const ackOpts = collectAcknowledgmentOptions(el, options);
    if (category === 'acknowledgment' || isAcknowledgmentQuestion(text, ackOpts, el) || isLeverAcknowledgmentField(el)) {
      return fillAcknowledgmentControl(el, value, ackOpts);
    }
    if (el.type === 'checkbox' && risky.test(text)) {
      return { success: false, error: 'Skipped legal/consent checkbox for safety.' };
    }

    if (el.type === 'checkbox') {
      const shouldCheck = /^(yes|true|checked|i agree|agree|i have read)/i.test(trim(value))
        || isAcknowledgmentOptionText(value);
      if (!fillCheckboxControl(el, shouldCheck)) {
        return { success: false, error: 'Could not update checkbox on page.' };
      }
      return { success: true };
    }

    const name = el.getAttribute('name');
    const group = name ? Array.from(document.querySelectorAll(`input[type="radio"][name="${cssEscape(name)}"]`)) : [el];
    let best = null;
    let bestScore = 0;
    for (const radio of group) {
      const label = getLabelText(radio) || radio.value || '';
      const score = Math.max(optionScore(label, normalized), optionScore(radio.value, normalized));
      if (score > bestScore) {
        best = radio;
        bestScore = score;
      }
    }
    if (!best || bestScore < cutoff) return { success: false, error: 'No matching radio option.' };
    if (isAshbyFormContext() && best.id) {
      const ashbyLabel = document.querySelector(`label[for="${cssEscape(best.id)}"]`);
      if (ashbyLabel) {
        dispatchPointerSequence(ashbyLabel);
      } else {
        dispatchPointerSequence(best);
      }
    } else {
      best.click();
    }
    best.dispatchEvent(new Event('input', { bubbles: true }));
    best.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  }

  function fillContentEditable(el, value) {
    el.focus();
    el.textContent = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  }

  function isMultiSelectCombobox(el) {
    if (!el) return false;
    if (isWorkdayMultiselectInput(el)) return true;
    if (el.getAttribute('aria-multiselectable') === 'true') return true;
    return Boolean(el.closest('.select__value-container--is-multi, [class*="value-container--is-multi"]'));
  }

  function scoreOptionAgainstTarget(optionText, targetText, category) {
    if (isDemographicCategory(category)) {
      return demographicOptionScore(optionText, targetText, category);
    }
    return optionScore(optionText, targetText);
  }

  function bestOptionMatch(options, value, category) {
    const candidates = isDemographicCategory(category)
      ? getDemographicCandidates(category, value)
      : [String(value || '').trim()];
    let best = null;
    let bestScore = 0;
    let matchedTarget = candidates[0] || '';
    for (const target of candidates) {
      if (!target) continue;
      for (const option of options) {
        const text = trim(option.textContent || option.value || '');
        if (!text) continue;
        const score = scoreOptionAgainstTarget(text, target, category);
        if (score > bestScore) {
          best = option;
          bestScore = score;
          matchedTarget = target;
        }
      }
    }
    return { best, bestScore, target: matchedTarget };
  }

  async function typeIntoComboboxFilter(el, text) {
    if (!text) return;
    try { el.focus(); } catch (_) {}
    setNativeValue(el, text);
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    } catch (_) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await delay(180);
  }

  async function clearComboboxSelections(el) {
    const control = findComboboxControl(el);
    const scope = control || el.parentElement || document;

    const clearBtn = scope.querySelector(
      '[class*="clear-indicator" i], button[aria-label*="clear" i]:not([aria-label*="search" i])'
    );
    if (clearBtn && isVisible(clearBtn)) {
      dispatchPointerSequence(clearBtn);
      await delay(80);
      return true;
    }

    const removeSelectors = [
      '[class*="multi-value__remove" i]',
      '[class*="MultiValueRemove" i]',
      '[class*="multi-value"] button[aria-label*="remove" i]',
      '[class*="tag-remove" i]'
    ];
    let removedAny = false;
    for (let pass = 0; pass < 10; pass += 1) {
      let removedThisPass = false;
      for (const selector of removeSelectors) {
        const buttons = scope.querySelectorAll(selector);
        for (const btn of buttons) {
          if (!isVisible(btn)) continue;
          dispatchPointerSequence(btn);
          removedThisPass = true;
          removedAny = true;
          await delay(45);
        }
      }
      if (!removedThisPass) break;
    }
    if (removedAny) await delay(60);
    return removedAny;
  }

  function closeComboboxMenu(el) {
    try {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
    } catch (_) {}
  }

  function dispatchPointerSequence(target) {
    if (!target) return;
    const opts = { bubbles: true, cancelable: true, button: 0, view: window };
    try { target.dispatchEvent(new MouseEvent('pointerdown', opts)); } catch (_) {}
    try { target.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (_) {}
    try { target.dispatchEvent(new MouseEvent('pointerup', opts)); } catch (_) {}
    try { target.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (_) {}
    try { target.click(); } catch (_) {}
  }

  async function waitForListboxToOpen(el, knownListboxId, attempts, intervalMs) {
    const totalAttempts = attempts || 25;
    const wait = intervalMs || 20;
    for (let i = 0; i < totalAttempts; i += 1) {
      await delay(wait);
      const lb = findVisibleOpenListbox(el, knownListboxId);
      if (lb && lb.querySelector('[role="option"], option')) return lb;
    }
    return null;
  }

  async function openComboboxMenu(el, knownListboxId) {
    const control = findComboboxControl(el);
    const toggleBtn = findComboboxToggleButton(el, control);

    try { el.focus(); } catch (_) {}

    const targets = [];
    if (toggleBtn) targets.push({ name: 'toggle-button', target: toggleBtn });
    if (control && control !== el && control !== toggleBtn) targets.push({ name: 'control-wrapper', target: control });
    targets.push({ name: 'input', target: el });

    for (const { target } of targets) {
      dispatchPointerSequence(target);
      const listbox = await waitForListboxToOpen(el, knownListboxId, 25, 20);
      if (listbox) return listbox;
    }

    try {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
    } catch (_) {}
    return await waitForListboxToOpen(el, knownListboxId, 30, 20);
  }

  async function pickComboboxOption(el, value, threshold, fieldCategory, knownListboxId) {
    const baseCutoff = typeof threshold === 'number' ? threshold : 0.5;
    const cutoff = isDemographicCategory(fieldCategory) ? Math.min(baseCutoff, 0.45) : baseCutoff;
    const pickValue = coerceSingleProfileValue(value);
    if (!pickValue) return { success: false, error: 'No value to fill into combobox.' };

    const tryMatch = (optionEls) => bestOptionMatch(optionEls, pickValue, fieldCategory);

    const preListbox = findListboxFor(el);
    if (preListbox && preListbox.querySelector('[role="option"], option')) {
      const optionEls = Array.from(preListbox.querySelectorAll('[role="option"], option'));
      let { best, bestScore, target } = tryMatch(optionEls);
      if (best && bestScore >= cutoff) {
        return { success: true, best, target };
      }
    }

    let listbox = await openComboboxMenu(el, knownListboxId);
    if (!listbox) {
      return { success: false, error: 'Combobox menu did not open after clicking toggle / control / input.' };
    }

    let optionEls = Array.from(listbox.querySelectorAll('[role="option"], option'));
    let { best, bestScore, target } = tryMatch(optionEls);

    if ((!best || bestScore < cutoff) && isDemographicCategory(fieldCategory)) {
      const filterText = getDemographicCandidates(fieldCategory, pickValue).find((c) => c && c.length >= 3) || pickValue;
      const filterEl = findRipplingComboboxInput(el) || el;
      if (filterEl.tagName === 'INPUT') {
        await typeIntoComboboxFilter(filterEl, filterText.slice(0, 24));
      }
      listbox = await waitForListboxToOpen(el, knownListboxId, 20, 25) || listbox;
      optionEls = Array.from(listbox.querySelectorAll('[role="option"], option'));
      ({ best, bestScore, target } = tryMatch(optionEls));
    }

    if (!best || bestScore < cutoff) {
      return {
        success: false,
        error: `No matching combobox option (best score ${bestScore.toFixed(2)} for "${target || pickValue}").`
      };
    }

    return { success: true, best, target };
  }

  async function fillCombobox(el, value, threshold, fieldCategory) {
    const pickValue = coerceSingleProfileValue(value);
    if (!pickValue) return { success: false, error: 'No value to fill into combobox.' };

    if (isMultiSelectCombobox(el)) {
      await clearComboboxSelections(el);
    }

    const knownListboxId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns') || '';
    const picked = await pickComboboxOption(el, value, threshold, fieldCategory, knownListboxId);

    if (!picked.success) {
      closeComboboxMenu(el);
      return { success: false, error: picked.error };
    }

    dispatchPointerSequence(picked.best);
    picked.best.dispatchEvent(new Event('input', { bubbles: true }));
    picked.best.dispatchEvent(new Event('change', { bubbles: true }));
    closeComboboxMenu(el);

    await delay(60);
    return { success: true };
  }

  async function fillTextLike(el, value) {
    if (isRipplingTextInput(el)) {
      return fillRipplingTextInput(el, value);
    }
    if (isWorkdayTextInput(el)) {
      el.focus();
      setReactControlledInputValue(el, value);
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return { success: true };
    }
    el.focus();
    setNativeValue(el, value, { emitBlur: true });
    return { success: true };
  }

  function isAutocompleteResultNode(node) {
    if (!node || !(node instanceof Element)) return false;
    const text = trim(node.textContent || '');
    if (!text || text.length > 200) return false;
    if (/^(loading|no result|no location|no match|searching)/i.test(text)) return false;
    const cls = String(node.className || '').toLowerCase();
    if (/no-result|loading|spinner/.test(cls)) return false;
    // Lever: .dropdown-results is a container — use its children, not the empty wrapper
    if (node.matches('.dropdown-results, [class*="dropdown-results"]') && node.children.length) return false;
    return true;
  }

  function getVisibleAutocompleteItems(scope) {
    if (!scope) return [];
    const itemSet = new Set();

    const leverRows = scope.querySelectorAll(
      '.dropdown-results > *, [class*="dropdown-results"] > *, [class*="dropdown-result"], [data-qa*="dropdown-result"]'
    );
    leverRows.forEach((node) => {
      if (!isAutocompleteResultNode(node)) return;
      if (!isVisible(node)) return;
      itemSet.add(node);
    });

    for (const sel of AUTOCOMPLETE_ITEM_SELECTORS) {
      let nodes;
      try { nodes = scope.querySelectorAll(sel); } catch (_) { continue; }
      nodes.forEach((node) => {
        if (!isAutocompleteResultNode(node)) return;
        if (!isVisible(node)) return;
        itemSet.add(node);
      });
      if (itemSet.size) break;
    }
    return Array.from(itemSet);
  }

  function isLoadingState(scope) {
    if (!scope) return false;
    const nodes = scope.querySelectorAll('[class*="loading"], [class*="spinner"], [class*="searching"]');
    for (const n of nodes) {
      if (isVisible(n)) return true;
    }
    return false;
  }

  function hasNoResultsBanner(scope) {
    if (!scope) return false;
    const nodes = scope.querySelectorAll('[class*="no-result"], [class*="no-results"], [class*="empty"], [class*="not-found"]');
    for (const n of nodes) {
      if (!isVisible(n)) continue;
      const text = (n.textContent || '').toLowerCase();
      if (/no\s*(result|location|match|option|item)|not\s*found|empty/i.test(text)) return true;
    }
    return false;
  }

  async function waitForAutocompleteResults(scope, timeoutMs) {
    const start = Date.now();
    let lastSeenItems = [];
    while (Date.now() - start < timeoutMs) {
      const panelOpen = isAutocompletePanelOpen(scope);
      if (isLoadingState(scope)) {
        await delay(100);
        continue;
      }
      const items = getVisibleAutocompleteItems(scope);
      if (items.length) {
        lastSeenItems = items;
        await delay(80);
        const refreshed = getVisibleAutocompleteItems(scope);
        return { state: 'ready', items: refreshed.length ? refreshed : items };
      }
      if (hasNoResultsBanner(scope) && panelOpen) {
        return { state: 'none' };
      }
      await delay(120);
    }
    return lastSeenItems.length ? { state: 'ready', items: lastSeenItems } : { state: 'timeout' };
  }

  function bestAutocompleteMatch(items, value) {
    let best = null;
    let bestScore = 0;
    for (const item of items) {
      const text = trim(item.textContent || '');
      if (!text) continue;
      const score = optionScore(text, value);
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    return { best, bestScore };
  }

  function primeAutocompleteInput(el) {
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
    dispatchPointerSequence(el);
    el.focus();
    try { el.click(); } catch (_) {}
  }

  function getLeverLocationPanel(el) {
    const field = el.closest('[data-qa="structured-contact-location-question"], .application-field, label') || el.parentElement;
    if (!field) return null;
    return field.querySelector('[class*="dropdown-container"]');
  }

  function getLeverLocationResultsRoot(el) {
    const panel = getLeverLocationPanel(el);
    if (panel) {
      const inPanel = panel.querySelector('.dropdown-results, [class*="dropdown-results"]');
      if (inPanel) return inPanel;
    }
    const field = el.closest('[data-qa="structured-contact-location-question"], .application-field, label') || el.parentElement;
    return field ? field.querySelector('.dropdown-results, [class*="dropdown-results"]') : null;
  }

  function isLeverLocationLoadingVisible(panel) {
    if (!panel) return false;
    const loadingEl = panel.querySelector('.dropdown-loading-results, [class*="loading-results"]');
    if (!loadingEl) return false;
    const style = window.getComputedStyle(loadingEl);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return isVisible(loadingEl);
  }

  function isLeverLocationResultText(text) {
    const t = trim(text || '');
    if (!t || t.length < 3) return false;
    if (/^(loading|searching|no location)/i.test(t)) return false;
    if (/no location found/i.test(t)) return false;
    return true;
  }

  function collectLeverLocationItems(resultsRoot) {
    if (!resultsRoot) return [];
    const items = [];
    const pushIfResult = (node) => {
      if (!node || !(node instanceof Element)) return;
      const text = trim(node.textContent || '');
      if (!isLeverLocationResultText(text)) return;
      if (node.matches('.dropdown-results, [class*="dropdown-results"], .dropdown-loading-results, [class*="no-result"]')) return;
      items.push(node);
    };
    Array.from(resultsRoot.children).forEach(pushIfResult);
    if (!items.length) {
      resultsRoot.querySelectorAll('[class*="dropdown-result"]:not([class*="dropdown-results"])').forEach(pushIfResult);
    }
    return items.filter((node, i, arr) => arr.indexOf(node) === i);
  }

  async function waitForLeverLocationDropdown(el, timeoutMs) {
    const panel = getLeverLocationPanel(el);
    const resultsRoot = getLeverLocationResultsRoot(el);
    if (!panel || !resultsRoot) {
      return { state: 'timeout', items: [], reason: 'Location dropdown markup not found.' };
    }

    const start = Date.now();
    let sawLoading = false;

    while (Date.now() - start < timeoutMs) {
      const loading = isLeverLocationLoadingVisible(panel);
      if (loading) sawLoading = true;

      const items = collectLeverLocationItems(resultsRoot);
      if (items.length && !loading) {
        await delay(60);
        const stable = collectLeverLocationItems(resultsRoot);
        return { state: 'ready', items: stable.length ? stable : items };
      }

      if (sawLoading && !loading && hasNoResultsBanner(panel)) {
        return { state: 'none', items: [] };
      }

      await delay(100);
    }

    const items = collectLeverLocationItems(resultsRoot);
    if (items.length) return { state: 'ready', items };
    if (sawLoading) return { state: 'timeout', items: [], reason: 'Loading finished but no selectable results appeared.' };
    return { state: 'timeout', items: [], reason: 'Location search did not start (no loading indicator).' };
  }

  function findReactSelectListbox(el) {
    if (!el) return null;
    const inputId = el.id;
    if (inputId) {
      const exact = document.getElementById(`react-select-${inputId}-listbox`);
      if (exact && isVisible(exact)) return exact;
      try {
        const partial = document.querySelector(
          `[id^="react-select-${cssEscape(inputId)}"][id$="-listbox"]`
        );
        if (partial && isVisible(partial)) return partial;
      } catch (_) {}
    }
    const controls = (el.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean);
    for (const id of controls) {
      const lb = document.getElementById(id);
      if (lb && lb.getAttribute('role') === 'listbox' && isVisible(lb)) return lb;
    }
    const menu = document.querySelector('[class*="select__menu"]:not([aria-hidden="true"])');
    if (menu && isVisible(menu) && menu.querySelector('[role="option"]')) return menu;
    return findVisibleOpenListbox(el, '');
  }

  function collectReactSelectLocationOptions(listbox) {
    if (!listbox) return [];
    return Array.from(listbox.querySelectorAll('[role="option"]')).filter((option) => {
      if (!isVisible(option)) return false;
      const text = trim(option.textContent || '');
      if (!text || text.length > 200) return false;
      if (/^(loading|searching|no options|no results)/i.test(text)) return false;
      return true;
    });
  }

  async function waitForReactSelectLocationOptions(el, timeoutMs) {
    const start = Date.now();
    let sawLoading = false;

    while (Date.now() - start < timeoutMs) {
      const listbox = findReactSelectListbox(el);
      if (listbox) {
        const loadingEl = listbox.querySelector(
          '[class*="loading"], [class*="LoadingMessage"], [class*="loading-message"]'
        );
        if (loadingEl && isVisible(loadingEl)) {
          sawLoading = true;
          await delay(80);
          continue;
        }

        const options = collectReactSelectLocationOptions(listbox);
        if (options.length) {
          await delay(60);
          const refreshed = collectReactSelectLocationOptions(findReactSelectListbox(el) || listbox);
          return { state: 'ready', items: refreshed.length ? refreshed : options };
        }

        if (sawLoading && hasNoResultsBanner(listbox)) {
          return { state: 'none', items: [] };
        }
      }

      if (el.getAttribute('aria-expanded') === 'true') {
        const options = collectReactSelectLocationOptions(findReactSelectListbox(el));
        if (options.length) return { state: 'ready', items: options };
      }

      await delay(100);
    }

    const listbox = findReactSelectListbox(el);
    const options = collectReactSelectLocationOptions(listbox);
    if (options.length) return { state: 'ready', items: options };
    if (sawLoading) {
      return { state: 'timeout', items: [], reason: 'Location search finished but no selectable results appeared.' };
    }
    return { state: 'timeout', items: [], reason: 'Location menu did not show options in time.' };
  }

  function verifyGreenhouseLocationSelection(el) {
    const shell = el.closest('.select-shell, .select__container');
    if (shell) {
      const single = shell.querySelector('[class*="single-value" i], [class*="SingleValue" i]');
      if (single && trim(single.textContent || '')) return true;
      const hidden = shell.querySelector('input[tabindex="-1"][aria-hidden="true"]');
      if (hidden && trim(hidden.value || '')) return true;
    }
    const control = el.closest('[class*="select__control" i]');
    if (control) {
      const single = control.querySelector('[class*="single-value" i]');
      if (single && trim(single.textContent || '')) return true;
      const placeholder = control.querySelector('[class*="placeholder" i]');
      if (!placeholder || !isVisible(placeholder)) {
        const val = control.querySelector('[class*="single-value" i], [class*="multi-value" i]');
        if (val && trim(val.textContent || '')) return true;
      }
    }
    return false;
  }

  function waitForHiddenInputValue(hidden, timeoutMs) {
    if (!hidden) return Promise.resolve(false);
    if (trim(hidden.value || '')) return Promise.resolve(true);

    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        try { observer.disconnect(); } catch (_) {}
        clearInterval(pollId);
        clearTimeout(timerId);
        resolve(ok);
      };

      const check = () => Boolean(trim(hidden.value || ''));

      const observer = new MutationObserver(() => { if (check()) finish(true); });
      observer.observe(hidden, { attributes: true, attributeFilter: ['value'] });

      const pollId = setInterval(() => { if (check()) finish(true); }, 50);
      const timerId = setTimeout(() => finish(check()), timeoutMs);
    });
  }

  async function typeIntoLeverLocation(el, text) {
    const str = String(text || '').trim();
    primeAutocompleteInput(el);
    setNativeValue(el, '', { emitBlur: false });
    el.focus();

    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } catch (_) {}

    for (let i = 0; i < str.length; i += 1) {
      const ch = str[i];
      const code = ch.charCodeAt(0);
      try {
        el.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true, cancelable: true, key: ch, char: ch, keyCode: code
        }));
      } catch (_) {}
      let inserted = false;
      try { inserted = document.execCommand('insertText', false, ch); } catch (_) {}
      if (!inserted) {
        setNativeValue(el, (el.value || '') + ch, { emitBlur: false });
      }
      try {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: ch, inputType: 'insertText' }));
      } catch (_) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      try {
        el.dispatchEvent(new KeyboardEvent('keyup', {
          bubbles: true, cancelable: true, key: ch, char: ch, keyCode: code
        }));
      } catch (_) {}
      await delay(45);
    }
    return trim(el.value || '');
  }

  async function insertTextLikeUser(el, text, perCharMs) {
    const str = String(text || '');
    primeAutocompleteInput(el);
    setNativeValue(el, '', { emitBlur: false });
    el.focus();

    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } catch (_) {}

    if (perCharMs > 0 && str.length > 0) {
      for (const ch of str) {
        let inserted = false;
        try { inserted = document.execCommand('insertText', false, ch); } catch (_) {}
        if (!inserted) setNativeValue(el, (el.value || '') + ch, { emitBlur: false });
        try {
          el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: ch, inputType: 'insertText' }));
        } catch (_) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await delay(perCharMs);
      }
    } else {
      let inserted = false;
      try { inserted = document.execCommand('insertText', false, str); } catch (_) {}
      if (!inserted) setNativeValue(el, str, { emitBlur: false });
      else {
        try {
          el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: str, inputType: 'insertText' }));
        } catch (_) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }
  }

  async function typeIntoAutocomplete(el, value, opts = {}) {
    if (isLeverLocationInput(el)) return typeIntoLeverLocation(el, value);
    if (isGreenhouseLocationCombobox(el)) return typeIntoLeverLocation(el, value);
    const perCharMs = opts.perCharMs || 0;
    return insertTextLikeUser(el, value, perCharMs);
  }

  async function tryKeyboardAutocompletePick(el) {
    const keys = [
      { key: 'ArrowDown', code: 'ArrowDown' },
      { key: 'Enter', code: 'Enter' }
    ];
    for (const spec of keys) {
      try {
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...spec }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...spec }));
      } catch (_) {}
      await delay(80);
    }
  }

  async function clickAutocompleteOption(optionEl, inputEl) {
    try { optionEl.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
    dispatchPointerSequence(optionEl);
    const rect = optionEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
    try { optionEl.dispatchEvent(new MouseEvent('pointerdown', opts)); } catch (_) {}
    try { optionEl.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (_) {}
    try { optionEl.dispatchEvent(new MouseEvent('pointerup', opts)); } catch (_) {}
    try { optionEl.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (_) {}
    try { optionEl.dispatchEvent(new MouseEvent('click', opts)); } catch (_) {}
    try {
      const topEl = document.elementFromPoint(cx, cy);
      if (topEl && topEl !== optionEl && optionEl.contains(topEl)) topEl.click();
      else if (topEl && topEl !== optionEl) topEl.click();
    } catch (_) {}
    if (inputEl) {
      try { inputEl.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
    }
    await delay(150);
  }

  function buildAutocompleteAttempts(value) {
    const v = String(value || '').trim();
    if (!v) return [];
    const attempts = [v];
    const beforeComma = v.split(',')[0].trim();
    if (beforeComma && beforeComma !== v) attempts.push(beforeComma);
    const firstWord = beforeComma.split(/\s+/)[0];
    if (firstWord && firstWord !== beforeComma && firstWord.length >= 3) attempts.push(firstWord);
    return Array.from(new Set(attempts));
  }

  function verifyLeverLocationSelection(hiddenMirror) {
    return Boolean(hiddenMirror && trim(hiddenMirror.value || ''));
  }

  function verifyAutocompleteSelection(el, hiddenMirror, expectedValue, beforeValue) {
    if (isLeverLocationInput(el)) return verifyLeverLocationSelection(hiddenMirror);
    if (isGreenhouseLocationCombobox(el)) return verifyGreenhouseLocationSelection(el);
    if (hiddenMirror && trim(hiddenMirror.value || '')) return true;
    const current = trim(el.value || '');
    if (current && current !== beforeValue) return true;
    if (current && expectedValue && current.toLowerCase().includes(String(expectedValue).slice(0, 3).toLowerCase())) return true;
    return false;
  }

  async function fillLeverLocationField(el, value, threshold) {
    const MAX_TOTAL_MS = 5000;
    const cutoff = typeof threshold === 'number' ? Math.min(threshold, 0.25) : 0.25;
    if (!value) return { success: false, error: 'No location value to fill.' };

    const hiddenMirror = findHiddenMirrorInput(el)
      || document.getElementById('selected-location')
      || el.closest('.application-field, label')?.querySelector('input[name="selectedLocation"]');
    if (!hiddenMirror) {
      return { success: false, error: 'Lever location hidden field (selectedLocation) not found.' };
    }

    const attempts = buildAutocompleteAttempts(value);
    const deadline = Date.now() + MAX_TOTAL_MS;
    let lastReason = 'Lever location: could not select from dropdown.';

    let attemptCycle = 0;
    while (Date.now() < deadline) {
      const attempt = attempts[attemptCycle % attempts.length];
      attemptCycle += 1;

      const typed = await typeIntoLeverLocation(el, attempt);
      if (!typed || typed.length < 2) {
        lastReason = 'Could not type into the location field.';
        await delay(100);
        continue;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      const waited = await waitForLeverLocationDropdown(el, remaining);

      if (waited.state === 'ready' && waited.items.length) {
        const { best, bestScore } = bestAutocompleteMatch(waited.items, value);
        const pick = (best && bestScore >= cutoff) ? best : waited.items[0];
        await clickAutocompleteOption(pick, el);
        if (await waitForHiddenInputValue(hiddenMirror, 800)) {
          return { success: true };
        }
        await tryKeyboardAutocompletePick(el);
        if (await waitForHiddenInputValue(hiddenMirror, 500)) {
          return { success: true };
        }
        lastReason = 'Clicked a location but selectedLocation was not set. Try a shorter city name (e.g. "Fort Worth, TX").';
      } else if (waited.state === 'none') {
        lastReason = `No locations found for "${attempt}".`;
      } else {
        lastReason = waited.reason || `Timed out waiting for location results for "${attempt}".`;
        if (!isLeverLocationLoadingVisible(getLeverLocationPanel(el)) && trim(el.value || '')) {
          await tryKeyboardAutocompletePick(el);
          if (await waitForHiddenInputValue(hiddenMirror, 400)) return { success: true };
        }
      }

      await delay(150);
    }

    return { success: false, error: lastReason };
  }

  async function fillGreenhouseLocationCombobox(el, value, threshold) {
    const MAX_TOTAL_MS = 5000;
    const cutoff = typeof threshold === 'number' ? Math.min(threshold, 0.25) : 0.25;
    if (!value) return { success: false, error: 'No location value to fill.' };

    const attempts = buildAutocompleteAttempts(value);
    const deadline = Date.now() + MAX_TOTAL_MS;
    let lastReason = 'Greenhouse location: could not select from dropdown.';
    let attemptCycle = 0;

    while (Date.now() < deadline) {
      const attempt = attempts[attemptCycle % attempts.length];
      attemptCycle += 1;

      const typed = await typeIntoLeverLocation(el, attempt);
      if (!typed || typed.length < 2) {
        lastReason = 'Could not type into the location field.';
        await delay(100);
        continue;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      const waited = await waitForReactSelectLocationOptions(el, remaining);

      if (waited.state === 'ready' && waited.items.length) {
        const { best, bestScore } = bestOptionMatch(waited.items, value);
        const pick = (best && bestScore >= cutoff) ? best : waited.items[0];
        await clickAutocompleteOption(pick, el);
        await delay(120);
        if (verifyGreenhouseLocationSelection(el)) {
          return { success: true };
        }
        await tryKeyboardAutocompletePick(el);
        await delay(120);
        if (verifyGreenhouseLocationSelection(el)) {
          return { success: true };
        }
        lastReason = 'Clicked a location but the field did not show a selected value. Try a shorter city name (e.g. "Fort Worth, TX").';
      } else if (waited.state === 'none') {
        lastReason = `No locations found for "${attempt}".`;
      } else {
        lastReason = waited.reason || `Timed out waiting for location results for "${attempt}".`;
        if (trim(el.value || '')) {
          await tryKeyboardAutocompletePick(el);
          await delay(120);
          if (verifyGreenhouseLocationSelection(el)) return { success: true };
        }
      }

      await delay(150);
    }

    return { success: false, error: lastReason };
  }

  async function fillSearchAutocomplete(el, value, threshold, fieldCategory) {
    if (isLeverLocationInput(el)) {
      return fillLeverLocationField(el, value, threshold);
    }
    if (isGreenhouseLocationCombobox(el)) {
      return fillGreenhouseLocationCombobox(el, value, threshold);
    }

    const MAX_TOTAL_MS = 5000;
    const baseCutoff = typeof threshold === 'number' ? threshold : 0.5;
    const isLocation = fieldCategory === 'city';
    const cutoff = isLocation ? Math.min(baseCutoff, 0.35) : baseCutoff;
    if (!value) return { success: false, error: 'No value to fill into search field.' };

    const scope = resolveAutocompleteScope(el);
    const hiddenMirror = findHiddenMirrorInput(el);
    const attempts = buildAutocompleteAttempts(value);
    const deadline = Date.now() + MAX_TOTAL_MS;

    let lastReason = 'Autocomplete did not return a usable result.';
    let attemptCycle = 0;

    while (Date.now() < deadline) {
      const attempt = attempts[attemptCycle % attempts.length];
      attemptCycle += 1;
      const before = trim(el.value || '');
      const hiddenBefore = hiddenMirror ? trim(hiddenMirror.value || '') : '';

      await typeIntoAutocomplete(el, attempt);

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      const waited = await waitForAutocompleteResults(scope, Math.min(remaining, 2800));

      if (waited.state === 'ready' && waited.items.length) {
        const { best, bestScore } = bestAutocompleteMatch(waited.items, value);
        let pick = best && bestScore >= cutoff ? best : null;
        if (!pick && isLocation && waited.items.length) {
          pick = waited.items[0];
        }
        if (pick) {
          await clickAutocompleteOption(pick, el);
          if (verifyAutocompleteSelection(el, hiddenMirror, value, before)) {
            return { success: true };
          }
          await tryKeyboardAutocompletePick(el);
          await delay(100);
          if (verifyAutocompleteSelection(el, hiddenMirror, value, before)) {
            return { success: true };
          }
          lastReason = 'Clicked autocomplete result but selection did not persist.';
        } else {
          lastReason = `No autocomplete result matched "${value}" (best score ${bestScore.toFixed(2)}).`;
        }
      } else if (waited.state === 'none') {
        lastReason = `Autocomplete returned no results for "${attempt}".`;
      } else if (waited.state === 'timeout') {
        await tryKeyboardAutocompletePick(el);
        await delay(100);
        if (verifyAutocompleteSelection(el, hiddenMirror, value, before)) {
          return { success: true };
        }
        lastReason = `Autocomplete did not respond in time for "${attempt}".`;
      }

      if (hiddenMirror && trim(hiddenMirror.value || '') && trim(hiddenMirror.value) !== hiddenBefore) {
        return { success: true };
      }

      await delay(100);
    }

    return { success: false, error: lastReason };
  }

  async function dispatchByFieldType(el, value, thresholds, declaredType, fieldCategory, fillPayload) {
    const tag = el.tagName;
    const inputType = tag === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : tag.toLowerCase();
    const payload = fillPayload && typeof fillPayload === 'object'
      ? fillPayload
      : { fieldCategory, uploadFile: fillPayload };

    switch (declaredType) {
      case 'file':
        return fillKitUploadField(el, {
          ...payload,
          fieldCategory: payload.fieldCategory || fieldCategory,
          uploadKitKind: payload.uploadKitKind || uploadKindFromFieldCategory(fieldCategory)
        });

      case 'dropdown':
      case 'multi-select':
        if (tag === 'SELECT') return fillSelect(el, value, thresholds?.selectMatchThreshold);
        return fillCombobox(el, value, thresholds?.selectMatchThreshold, fieldCategory);

      case 'combobox':
      case 'multi-combobox':
        return fillCombobox(el, value, thresholds?.selectMatchThreshold, fieldCategory);

      case 'yes-no':
        if (isAshbyYesNoField(el)) {
          return fillAshbyYesNo(el, value, fieldCategory, thresholds?.radioMatchThreshold);
        }
        if (tag === 'SELECT') return fillSelect(el, value, thresholds?.selectMatchThreshold);
        if (inputType === 'radio' || inputType === 'checkbox') {
          const opts = fillPayload?.options || getRadioOrCheckboxOptions(el);
          return fillRadioOrCheckbox(el, value, fieldCategory, thresholds?.radioMatchThreshold, opts);
        }
        return fillCombobox(el, value, thresholds?.selectMatchThreshold, fieldCategory);

      case 'checkbox':
      case 'checkbox-group':
      case 'radio-group': {
        const opts = fillPayload?.options || getRadioOrCheckboxOptions(el);
        return fillRadioOrCheckbox(el, value, fieldCategory, thresholds?.radioMatchThreshold, opts);
      }

      case 'rich-text':
        return fillContentEditable(el, value);

      case 'search-autocomplete':
        return fillSearchAutocomplete(el, value, thresholds?.selectMatchThreshold, fieldCategory);

      case 'text':
      case 'textarea':
      case 'email':
      case 'phone':
      case 'url':
      case 'number':
      case 'date':
      case 'datetime':
      case 'month':
      case 'week':
      case 'time':
      case 'slider':
      case 'color':
      case 'password':
      case 'search':
        if (tag === 'INPUT' && (inputType === 'text' || inputType === 'search') && isSearchAutocomplete(el)) {
          return fillSearchAutocomplete(el, value, thresholds?.selectMatchThreshold, fieldCategory);
        }
        if (tag === 'INPUT' || tag === 'TEXTAREA') return await fillTextLike(el, value);
        if (el.isContentEditable) return fillContentEditable(el, value);
        return { success: false, error: `Cannot type into ${tag.toLowerCase()} element.` };

      default:
        return null;
    }
  }

  async function fillField(payload, thresholds) {
    pickAdapter();
    let el = resolveFieldElement(payload);
    if (!el && isRipplingFormContext() && payload?.fieldCategory) {
      el = findRipplingInputForCategory(payload.fieldCategory);
    }
    if (!el) return { success: false, error: 'Field no longer exists on page.' };
    const rawValue = payload.value == null ? '' : String(payload.value);
    let value = normalizeDemographicFillValue(payload.fieldCategory, rawValue);
    if (payload.fieldCategory === 'linkedin' || payload.fieldCategory === 'portfolio' || payload.fieldCategory === 'github') {
      value = String(rawValue).trim();
    }
    const tag = el.tagName;
    const type = tag === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : tag.toLowerCase();

    if (isLeverLocationInput(el) && value) {
      return fillLeverLocationField(el, value, thresholds?.selectMatchThreshold);
    }

    if (isGreenhouseLocationCombobox(el) && value) {
      return fillGreenhouseLocationCombobox(el, value, thresholds?.selectMatchThreshold);
    }

    if (isRipplingLocationInput(el) && value) {
      return fillSearchAutocomplete(el, value, thresholds?.selectMatchThreshold, payload.fieldCategory);
    }

    const uploadKind = payload.uploadKitKind || uploadKindFromFieldCategory(payload.fieldCategory);
    const isKitUpload = type === 'file' || payload.fieldType === 'file' || uploadKind;

    if (isKitUpload) {
      let target = el;
      const targetType = target.tagName === 'INPUT' ? (target.getAttribute('type') || '').toLowerCase() : '';
      if (targetType !== 'file') {
        if (payload.fieldCategory === 'resume_upload' || uploadKind === 'resume') {
          const near = findResumeFileInputNear(target);
          if (near) target = near;
        } else if (payload.fieldCategory === 'cover_letter_upload' || uploadKind === 'coverLetter') {
          const near = findCoverLetterFileInputNear(target);
          if (near) target = near;
        }
      }
      if (!target || target.tagName !== 'INPUT' || (target.getAttribute('type') || '').toLowerCase() !== 'file') {
        const cat = payload.fieldCategory || (uploadKind === 'resume' ? 'resume_upload' : 'cover_letter_upload');
        const fallback = findRipplingKitFileInput(cat) || findKitFileInput(null, cat);
        if (fallback) target = fallback;
      }
      if (!target || target.tagName !== 'INPUT') {
        return { success: false, error: 'Could not find a file upload input on the page.' };
      }
      return fillKitUploadField(target, payload);
    }

    if (payload.fieldType) {
      const dispatched = await dispatchByFieldType(el, value, thresholds, payload.fieldType, payload.fieldCategory, payload);
      if (dispatched) return dispatched;
    }

    if (tag === 'SELECT') return fillSelect(el, value, thresholds?.selectMatchThreshold);
    if (type === 'radio' || type === 'checkbox') {
      const opts = payload.options || getRadioOrCheckboxOptions(el);
      return fillRadioOrCheckbox(el, value, payload.fieldCategory, thresholds?.radioMatchThreshold, opts);
    }
    if (isComboboxLike(el)) {
      if (isGreenhouseLocationCombobox(el) && value) {
        return fillGreenhouseLocationCombobox(el, value, thresholds?.selectMatchThreshold);
      }
      return await fillCombobox(el, value, thresholds?.selectMatchThreshold, payload.fieldCategory);
    }
    if (el.isContentEditable) return fillContentEditable(el, value);

    if (tag === 'INPUT' && (type === 'text' || type === 'search') && isSearchAutocomplete(el)) {
      return await fillSearchAutocomplete(el, value, thresholds?.selectMatchThreshold, payload.fieldCategory);
    }

    if (tag === 'INPUT' || tag === 'TEXTAREA') return await fillTextLike(el, value);

    return { success: false, error: `Unsupported field type: ${tag}/${type}` };
  }

  function tickUncheckedLeverAcknowledgments() {
    if (!isLeverFormContext()) return 0;
    const root = document.querySelector('#application-form, form#application-form') || document;
    let ticked = 0;
    root.querySelectorAll('ul[data-qa="checkboxes"] input[type="checkbox"]').forEach((cb) => {
      if (cb.checked || cb.disabled) return;
      const label = getLeverOptionLabel(cb) || getLabelText(cb) || cb.value || '';
      if (!isAcknowledgmentOptionText(label)) return;
      if (fillCheckboxControl(cb, true)) ticked += 1;
    });
    return ticked;
  }

  async function fillApplicationFields(fields, thresholds) {
    pickAdapter();
    const results = [];
    for (const field of fields || []) {
      try {
        const result = await fillField(field, thresholds);
        results.push({ id: field.id, elementPath: field.elementPath, ...result });
      } catch (error) {
        results.push({ id: field.id, elementPath: field.elementPath, success: false, error: error?.message || String(error) });
      }
    }
    if (isLeverFormContext()) {
      tickUncheckedLeverAcknowledgments();
    }
    return { success: true, results };
  }

  function getFieldHighlightTarget(el) {
    if (!el || !(el instanceof Element)) return el;

    if (isLeverFormContext()) {
      const leverQuestion = leverAdapter.getQuestionContainer(el);
      if (leverQuestion && isVisible(leverQuestion)) return leverQuestion;
    }

    if (isWorkdayFormContext()) {
      const wdField = getWorkdayFormFieldRoot(el) || workdayAdapter.getQuestionContainer(el);
      if (wdField && isVisible(wdField)) return wdField;
    }

    const inputType = el.tagName === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : '';
    if (inputType === 'radio' || inputType === 'checkbox') {
      const fieldset = el.closest('fieldset');
      if (fieldset && isVisible(fieldset)) return fieldset;

      const ghField = el.closest(
        '.field, .select-field, .checkbox-field, .multiple-choice-field, .demographic_question'
      );
      if (ghField && isVisible(ghField)) return ghField;

      const choiceBlock = el.closest('ul[data-qa="multiple-choice"], ul[data-qa="checkboxes"]');
      if (choiceBlock) {
        const question = choiceBlock.closest('.application-question, li.application-question');
        if (question && isVisible(question)) return question;
        const appField = choiceBlock.closest('.application-field');
        if (appField && isVisible(appField)) return appField;
      }

      const roleGroup = el.closest('[role="radiogroup"], [role="group"]');
      if (roleGroup && roleGroup !== el && isVisible(roleGroup)) return roleGroup;
    }

    if (isRipplingFormContext()) {
      const ripplingField = el.closest('[data-testid="field"]');
      if (ripplingField && isVisible(ripplingField)) return ripplingField;
    }

    if (isAshbyFormContext()) {
      const ashbyField = el.closest('[data-field-path], .ashby-application-form-field-entry, fieldset');
      if (ashbyField && isVisible(ashbyField)) return ashbyField;
    }

    return el;
  }

  function highlightElement(el) {
    if (!el || !(el instanceof Element)) return;
    const prevStyle = el.getAttribute('style') || '';
    try {
      el.style.setProperty('outline', '3px solid #2563eb', 'important');
      el.style.setProperty('outline-offset', '2px', 'important');
      el.style.setProperty('box-shadow', '0 0 0 8px rgba(37, 99, 235, 0.22)', 'important');
      el.style.setProperty('border-radius', el.style.borderRadius || '8px', 'important');
      el.style.setProperty('transition', 'outline 0.25s ease, box-shadow 0.25s ease', 'important');
    } catch (_) {}
    setTimeout(() => {
      try {
        if (prevStyle) el.setAttribute('style', prevStyle);
        else el.removeAttribute('style');
      } catch (_) {}
    }, 1600);
  }

  async function focusField(payload) {
    const el = resolveFieldElement(payload);
    if (!el) return { success: false, error: 'Could not locate this field on the page (it may have been re-rendered).' };

    const isCombo = isComboboxLike(el);
    let scrollTarget = isCombo ? findComboboxControl(el) : el;
    scrollTarget = getFieldHighlightTarget(scrollTarget instanceof Element ? scrollTarget : el);
    const safeScrollTarget = (scrollTarget instanceof Element) ? scrollTarget : el;

    try {
      safeScrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    } catch (_) {
      try { safeScrollTarget.scrollIntoView(); } catch (__) {}
    }

    await delay(300);

    highlightElement(safeScrollTarget);
    try { el.focus({ preventScroll: true }); } catch (_) {
      try { el.focus(); } catch (__) {}
    }

    return { success: true };
  }

  async function prepareForScan() {
    const docEl = document.scrollingElement || document.documentElement || document.body;
    const startY = window.scrollY || (docEl ? docEl.scrollTop : 0);
    try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }
    catch (_) { window.scrollTo(0, 0); }
    await delay(80);

    const maxHeight = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0,
      window.innerHeight
    );
    const viewport = window.innerHeight || 600;

    if (maxHeight > viewport * 1.4) {
      const step = Math.max(Math.floor(viewport * 0.85), 200);
      let y = 0;
      const safety = 40;
      let hops = 0;
      while (y < maxHeight && hops < safety) {
        y += step;
        try { window.scrollTo({ top: y, left: 0, behavior: 'instant' }); }
        catch (_) { window.scrollTo(0, y); }
        await delay(35);
        hops += 1;
      }
      try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }
      catch (_) { window.scrollTo(0, 0); }
      await delay(80);
    }

    return { success: true, scrolledFrom: startY, height: maxHeight };
  }

  const ELEMENT_PICKER_LAST_TEXT_KEY = 'element_text_picker_last_text';
  let elementPickerState = null;

  function normalizeExtractedElementText(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function extractElementText(el) {
    if (!el) return '';
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return normalizeExtractedElementText(el.value || el.getAttribute('aria-label') || el.title);
    }
    if (el instanceof HTMLSelectElement) {
      const selected = Array.from(el.selectedOptions).map((option) => option.textContent).join('\n');
      return normalizeExtractedElementText(selected || el.value || el.getAttribute('aria-label'));
    }
    return normalizeExtractedElementText(
      el.innerText
      || el.textContent
      || el.getAttribute?.('aria-label')
      || el.getAttribute?.('title')
    );
  }

  async function copyElementPickerText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (_) {
      /* fall through to execCommand */
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      if (!document.execCommand('copy')) throw new Error('Copy failed.');
    } finally {
      textarea.remove();
    }
  }

  function showElementPickerToast(message, kind = 'success') {
    document.getElementById('__rwh-element-picker-toast')?.remove();
    const toast = document.createElement('div');
    toast.id = '__rwh-element-picker-toast';
    toast.textContent = message;
    toast.style.cssText = [
      'all:initial',
      'position:fixed',
      'right:18px',
      'bottom:18px',
      'z-index:2147483647',
      'max-width:360px',
      'padding:10px 14px',
      'border-radius:9px',
      'box-shadow:0 8px 30px rgba(0,0,0,.32)',
      'font:600 12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif',
      `background:${kind === 'error' ? '#b91c1c' : '#166534'}`,
      'color:#fff'
    ].join(';');
    (document.body || document.documentElement).appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  function positionElementPickerOverlay(target) {
    if (!elementPickerState || !target) return;
    const rect = target.getBoundingClientRect();
    const overlay = elementPickerState.overlay;
    overlay.style.left = `${Math.max(0, rect.left)}px`;
    overlay.style.top = `${Math.max(0, rect.top)}px`;
    overlay.style.width = `${Math.max(0, Math.min(rect.width, window.innerWidth - Math.max(0, rect.left)))}px`;
    overlay.style.height = `${Math.max(0, Math.min(rect.height, window.innerHeight - Math.max(0, rect.top)))}px`;
    overlay.style.display = rect.width > 0 && rect.height > 0 ? 'block' : 'none';
  }

  function stopElementTextPicker({ notify = false } = {}) {
    if (!elementPickerState) return;
    const state = elementPickerState;
    elementPickerState = null;
    document.removeEventListener('pointermove', state.onPointerMove, true);
    document.removeEventListener('click', state.onClick, true);
    document.removeEventListener('keydown', state.onKeyDown, true);
    window.removeEventListener('scroll', state.onViewportChange, true);
    window.removeEventListener('resize', state.onViewportChange, true);
    document.documentElement.classList.remove('__rwh-element-picker-active');
    state.overlay.remove();
    state.banner.remove();
    state.style.remove();
    if (notify) showElementPickerToast('Element text picker cancelled.', 'error');
  }

  function startElementTextPicker() {
    stopElementTextPicker();

    const style = document.createElement('style');
    style.id = '__rwh-element-picker-style';
    style.textContent = `
      @keyframes __rwhRainbowBorder {
        from { filter: hue-rotate(0deg); }
        to { filter: hue-rotate(360deg); }
      }
      html.__rwh-element-picker-active,
      html.__rwh-element-picker-active * {
        cursor: crosshair !important;
      }
      #__rwh-element-picker-overlay {
        position: fixed;
        display: none;
        box-sizing: border-box;
        pointer-events: none;
        z-index: 2147483646;
        border: 4px solid;
        border-image: linear-gradient(90deg, #ff1744, #ff9100, #ffea00, #00e676, #00b0ff, #651fff, #f500d4) 1;
        background: rgba(37, 99, 235, .08);
        animation: __rwhRainbowBorder 1.2s linear infinite;
      }
    `;

    const overlay = document.createElement('div');
    overlay.id = '__rwh-element-picker-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    const banner = document.createElement('div');
    banner.id = '__rwh-element-picker-banner';
    banner.textContent = 'Hover an element and click to copy its text • Esc to cancel';
    banner.style.cssText = [
      'all:initial',
      'position:fixed',
      'top:12px',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:2147483647',
      'pointer-events:none',
      'padding:9px 14px',
      'border-radius:999px',
      'box-shadow:0 6px 24px rgba(0,0,0,.3)',
      'font:600 12px/1.3 system-ui,-apple-system,Segoe UI,sans-serif',
      'background:#1e1e32',
      'color:#fff'
    ].join(';');

    (document.head || document.documentElement).appendChild(style);
    (document.body || document.documentElement).append(overlay, banner);
    document.documentElement.classList.add('__rwh-element-picker-active');

    const state = {
      style,
      overlay,
      banner,
      target: null,
      lastClientX: 0,
      lastClientY: 0,
      onPointerMove: null,
      onClick: null,
      onKeyDown: null,
      onViewportChange: null
    };

    state.onPointerMove = (event) => {
      state.lastClientX = event.clientX;
      state.lastClientY = event.clientY;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!target || target === overlay || target === banner) return;
      state.target = target;
      positionElementPickerOverlay(target);
    };

    state.onViewportChange = () => {
      if (state.target?.isConnected) positionElementPickerOverlay(state.target);
    };

    state.onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      stopElementTextPicker({ notify: true });
    };

    state.onClick = async (event) => {
      const target = state.target || document.elementFromPoint(event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const text = extractElementText(target);
      stopElementTextPicker();
      if (!text) {
        showElementPickerToast('No text found in that element.', 'error');
        return;
      }
      try {
        await copyElementPickerText(text);
        chrome.storage.local.set({
          [ELEMENT_PICKER_LAST_TEXT_KEY]: text,
          element_text_picker_last_url: location.href,
          element_text_picker_last_at: new Date().toISOString()
        });
        showElementPickerToast('Element text copied to clipboard.');
      } catch (error) {
        showElementPickerToast(error?.message || 'Could not copy element text.', 'error');
      }
    };

    elementPickerState = state;
    document.addEventListener('pointermove', state.onPointerMove, true);
    document.addEventListener('click', state.onClick, true);
    document.addEventListener('keydown', state.onKeyDown, true);
    window.addEventListener('scroll', state.onViewportChange, true);
    window.addEventListener('resize', state.onViewportChange, true);
    return { success: true };
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    try {
      if (!request || !request.action) return false;

      if (request.action === 'ping') {
        sendResponse({ success: true, ready: true });
        return true;
      }

      if (request.action === 'getJobFields' || request.action === 'scrapeJobInfo') {
        sendResponse(getJobFields());
        return true;
      }

      if (request.action === 'prepareForScan') {
        prepareForScan()
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
        return true;
      }

      if (request.action === 'startElementTextPicker') {
        sendResponse(startElementTextPicker());
        return true;
      }

      if (request.action === 'focusField') {
        focusField(request.field || {})
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
        return true;
      }

      if (request.action === 'getAdapterDebug') {
        sendResponse(getAdapterDebugInfo());
        return true;
      }

      if (request.action === 'scanApplicationForm') {
        sendResponse(scanApplicationForm());
        return true;
      }

      if (request.action === 'fillApplicationFields') {
        fillApplicationFields(request.fields || [], request.thresholds || {})
          .then((result) => sendResponse(result))
          .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
        return true;
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message || String(error) });
      return true;
    }

    return false;
  });
})();
