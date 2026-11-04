/**
 * Auto-bid runner. Applies to the jobs whose resume AutoGen generated, the way
 * the Bid tab is used by hand, one job at a time in this panel's window:
 *
 *   open the job's form → profile + generated resume JSON → Generate files
 *   (json2docx) → Autofill with AI → check every required field (as Autofill
 *   reported it, then on the page) → Submit (Greenhouse, Lever) → wait for the
 *   site's confirmation → Register in Resume DB.
 *
 * Anything it cannot finish safely stops before (or at) Submit and is listed
 * under Needs you, with the tab left open: a CAPTCHA, a required field it has
 * no answer for, a site it does not submit on (Ashby: ready for your click),
 * no confirmation after Submit.
 * A job is never taken again once attempted, so nothing is sent twice.
 *
 * Loaded after sidepanel.js: it drives that file's Autofill (autofillThisPage,
 * currentPlan, autofillFrameId) and register-resume-db.js's Bid tab functions.
 */
(function () {
  const PREFS_KEY = 'autobid_prefs';
  const DEFAULT_PREFS = { enabled: false, submit: false, dailyLimit: 25, gapSeconds: 30 };

  const IDLE_POLL_MS = 60 * 1000;
  /** A job page this slow to load is used as it is. */
  const PAGE_LOAD_MS = 45 * 1000;
  /** The panel reads a newly opened job by itself; wait this long for it to finish. */
  const BIND_WAIT_MS = 25 * 1000;
  const CONFIRM_WAIT_MS = 45 * 1000;
  const CONFIRM_POLL_MS = 2000;
  /** A problem with this machine (json2docx down, signed out): wait this long, then try again. */
  const PAUSE_RETRY_MS = 5 * 60 * 1000;
  /** Needs-you tabs kept open for the user; older ones are closed (the job stays listed). */
  const MAX_TABS_LEFT_OPEN = 8;
  /** Sites Auto-bid presses Submit on. Others are filled and left for the user. */
  const SUBMIT_HOST_RE = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com)$/i;
  /**
   * Ashby has not taken one Submit pressed by Auto-bid (7 of 7 left the form
   * as it was): its forms are filled, checked and left for one click.
   */
  const CLICK_YOURSELF_HOST_RE = /(^|\.)ashbyhq\.com$/i;
  /** Another panel's report newer than this means it is open now (reports go out at least every minute). */
  const OTHER_PANEL_MS = 150 * 1000;
  const INSTANCE_KEY = 'autobid_instance';
  /** Problems with this machine, not the job: the job goes back and the runner pauses. */
  const ENVIRONMENT_ERROR_RE =
    /json2docx|Not signed in|Unauthorized|did not answer|Could not reach|api key|OPENAI|columns are missing/i;

  const state = {
    prefs: { ...DEFAULT_PREFS },
    running: false,
    stop: false,
    timer: null,
    job: null,
    step: '',
    summary: null,
    log: [],
    stepPost: Promise.resolve(),
    lastDetail: '', // why the last job stopped, for the one-job notes
    tabsLeftOpen: [],
  };

  const bid = () => window.SmartJobRegisterResumeDb;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function toast(message, type = 'info') {
    if (typeof window.showStatus === 'function') window.showStatus(message, type, 6000);
  }

  // ───────────────────────────── State and UI ─────────────────────────────

  async function loadPrefs() {
    const stored = await chrome.storage.local.get(PREFS_KEY).catch(() => ({}));
    state.prefs = { ...DEFAULT_PREFS, ...(stored?.[PREFS_KEY] || {}) };
  }

  async function savePrefs() {
    await chrome.storage.local.set({ [PREFS_KEY]: state.prefs }).catch(() => {});
  }

  function logLine(text) {
    const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    state.log = [`${at} ${text}`, ...state.log].slice(0, 30);
    render();
  }

  function setStep(text) {
    state.step = text;
    render();
    // Shown on the Auto-bid page of the site, so the run can be watched from any computer.
    // One at a time, in order: each write adds to the job's step history.
    const job = state.job;
    if (job && text) {
      state.stepPost = state.stepPost.then(() =>
        bid()
          .autobidFetch(`/api/autobid/${job.id}/step`, { method: 'POST', body: { claimedAt: job.claimed_at, step: text } })
          .catch(() => {})
      );
    }
  }

  function render() {
    document.getElementById('abCard')?.classList.toggle('is-on', Boolean(state.prefs.enabled));

    const status = document.getElementById('abStatus');
    if (status) {
      status.textContent = !state.prefs.enabled
        ? 'Off'
        : state.job
          ? `#${state.job.id}`
          : state.prefs.submit
            ? 'On'
            : 'Dry run';
    }
    const step = document.getElementById('abStep');
    if (step) {
      step.textContent = state.job
        ? `${state.job.company || 'Job'} · ${state.job.job_title || ''} — ${state.step}`
        : state.step || (state.prefs.enabled ? 'Waiting for generated resumes…' : 'Not running. Press Start above.');
    }

    const counts = document.getElementById('abCounts');
    if (counts) {
      const s = state.summary;
      counts.textContent = s
        ? `${s.ready} ready · ${s.submittedSince} sent today (limit ${state.prefs.dailyLimit}) · ${s.needsYou.length} need you`
        : '';
    }

    const needs = document.getElementById('abNeedsYou');
    if (needs) {
      const rows = state.summary?.needsYou || [];
      needs.hidden = rows.length === 0;
      needs.innerHTML = rows.length
        ? `<summary>Needs you (${rows.length})</summary>${rows
            .slice(0, 20)
            .map(
              (row) => `
          <div class="ab-need" data-ab-id="${row.id}">
            <div class="ab-need-main">
              <div class="ab-need-title" title="${escapeHtml(row.jobTitle)}">${escapeHtml(row.company || 'Job')} · ${escapeHtml(row.jobTitle)}</div>
              <div class="ab-need-reason" title="${escapeHtml(row.reason)}">${escapeHtml(row.reason)}</div>
            </div>
            <button type="button" class="ab-need-btn" data-ab-action="open" title="Open the job">Open</button>
            <button type="button" class="ab-need-btn" data-ab-action="retry" title="Give it back to Auto-bid">Retry</button>
          </div>`
            )
            .join('')}`
        : '';
    }

    const log = document.getElementById('abLog');
    if (log) log.textContent = state.log.join('\n');
    renderWorkflow();
  }

  function localMidnightIso() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  async function refreshSummary() {
    try {
      state.summary = await bid().autobidFetch(`/api/autobid/summary?since=${encodeURIComponent(localMidnightIso())}`);
    } catch (error) {
      state.summary = null;
      setStep(error?.message || String(error));
    }
    render();
    return state.summary;
  }

  // ───────────────────────────── Page helpers ─────────────────────────────

  /** Lever and Ashby keep the form on its own page: open that page directly. */
  function applicationFormUrl(link) {
    try {
      const url = new URL(link);
      const host = url.hostname.toLowerCase();
      const path = url.pathname.replace(/\/+$/, '');
      const uuidPage = /^\/[^/]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (host === 'jobs.lever.co' && uuidPage.test(path)) {
        url.pathname = `${path}/apply`;
        return url.toString();
      }
      if (host === 'jobs.ashbyhq.com' && uuidPage.test(path)) {
        url.pathname = `${path}/application`;
        return url.toString();
      }
    } catch (_) {
      /* not a URL: opened as it is */
    }
    return link;
  }

  /** The panel binds a newly active tab and reads its job; overriding before it finishes would be undone. */
  async function waitForPanelBind(tabId) {
    const TS = window.SmartJobTabSession;
    const until = Date.now() + BIND_WAIT_MS;
    while (Date.now() < until) {
      if (TS?.getBoundTabId?.() === tabId && TS?.hasSession?.(tabId) && !TS?.needsLoad?.(tabId)) return;
      await sleep(500);
    }
    // No posting on a form-only page: the read never marks it loaded. Mark it, so
    // a later page update does not read it again over the runner's values.
    TS?.markLoaded?.(tabId);
  }

  async function frameHref(tabId, frameId) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId || 0] },
        func: () => location.href,
      });
      return String(result?.result || '');
    } catch (_) {
      return '';
    }
  }

  function hostOf(href) {
    try {
      return new URL(href).hostname.toLowerCase();
    } catch (_) {
      return '';
    }
  }

  /** Runs in the form's frame. Clicks the form's own submit button; never an "Apply" link. */
  function clickSubmitButton() {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const label = (el) => String(el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
    const selectors = [
      '#submit_app',
      'button#btn-submit',
      '[data-qa="btn-submit"]',
      'button.ashby-application-form-submit-button',
      'form button[type="submit"]',
      'form input[type="submit"]',
    ];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el) || el.disabled) continue;
        const text = label(el);
        if (text && !/submit|send application/i.test(text)) continue;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { clicked: true, label: text || selector };
      }
    }
    for (const el of document.querySelectorAll('button')) {
      const text = label(el);
      if (/^submit( (your )?application)?$/i.test(text) && visible(el) && !el.disabled) {
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { clicked: true, label: text };
      }
    }
    return { clicked: false };
  }

  /**
   * Runs in the form's frame. Labels of required fields that are empty on the
   * page, whatever Autofill reported: a dropdown (Greenhouse's react-select)
   * has a value only once an option is chosen, not when text was typed in it.
   */
  function findEmptyRequired() {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const labelOf = (el) => {
      const byIds = String(el.getAttribute('aria-labelledby') || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ');
      const text = byIds || el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || el.id;
      return String(text || 'a required field').replace(/\s+/g, ' ').replace(/\s*\*$/, '').trim().slice(0, 80);
    };
    const empty = [];
    for (const el of document.querySelectorAll('input, select, textarea')) {
      // aria-hidden: react-select's own stand-in, there while its dropdown has no value.
      if (el.disabled || el.getAttribute('aria-hidden') === 'true' || !el.matches('[required], [aria-required="true"]')) continue;
      if (/^(hidden|file|checkbox|radio|submit|button)$/i.test(el.type || '')) continue;
      // react-select: the input holds only search text; a choice is shown beside it.
      const choices = el.closest('[class*="value-container"], [class*="ValueContainer"]');
      if (choices) {
        const chosen = choices.querySelector('[class*="single-value"], [class*="singleValue"], [class*="multi-value"], [class*="multiValue"]');
        if (visible(choices) && !chosen) empty.push(labelOf(el));
        continue;
      }
      if (visible(el) && !String(el.value || '').trim()) empty.push(labelOf(el));
    }
    return empty;
  }

  async function emptyRequiredOnPage(tabId) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [autofillFrameId || 0] },
        func: findEmptyRequired,
      });
      return Array.isArray(result?.result) ? result.result : [];
    } catch (_) {
      return [];
    }
  }

  /** json2docx's health, asked up to 3 times: one slow answer (Word busy making a PDF) is not "offline". */
  async function json2docxHealth() {
    let health = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt) await sleep(3000);
      health = await window.SmartJobJson2Docx?.checkJson2docxHealth?.({ updateUi: true }).catch(() => null);
      if (!health || health.ok || health.error === 'disabled') break;
    }
    return health;
  }

  /**
   * Runs in every frame. The page as the runner judges Submit by: its address,
   * its visible lines (to see what appeared after Submit), whether the form is
   * still there, a CAPTCHA challenge, and field errors.
   */
  function probeApplicationOutcome() {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const lines = [
      ...new Set(
        String(document.body?.innerText || '')
          .split(/\n+/)
          .map((line) => line.replace(/\s+/g, ' ').trim())
          .filter((line) => line.length > 1)
          .map((line) => line.slice(0, 200))
      ),
    ].slice(0, 1500);
    const submitButton = [
      ...document.querySelectorAll('button, input[type="submit"], [data-qa="btn-submit"], #submit_app'),
    ].some((el) => visible(el) && /submit|send application/i.test(String(el.innerText || el.value || el.getAttribute('aria-label') || '')));
    const fields = [...document.querySelectorAll('form input:not([type="hidden"]), form textarea, form select')].filter(visible).length;
    const captcha = [...document.querySelectorAll('iframe')].some(
      (frame) =>
        /recaptcha\/(api2|enterprise)\/bframe|hcaptcha\.com\/.*(challenge|hcaptcha)|challenges\.cloudflare\.com/i.test(frame.src || '') &&
        visible(frame) &&
        frame.getBoundingClientRect().height > 100
    );
    const errors = [
      ...document.querySelectorAll(
        '[aria-invalid="true"], .field_with_errors, .field-error, .error-message, [class*="error-message"], [class*="errorMessage"], .application-error, .helper-text--error'
      ),
    ]
      .filter(visible)
      .map((el) => String(el.innerText || el.getAttribute('aria-label') || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim())
      .filter((t) => t && t.length < 200);
    return {
      href: location.href,
      lines,
      formPresent: submitButton || fields >= 2,
      captcha,
      errors: [...new Set(errors)].slice(0, 6),
    };
  }

  async function probeOutcome(tabId) {
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: probeApplicationOutcome });
      const frames = results.map((r) => r?.result).filter(Boolean);
      return {
        hrefs: frames.map((f) => f.href),
        lines: frames.flatMap((f) => f.lines || []),
        formPresent: frames.some((f) => f.formPresent),
        captcha: frames.some((f) => f.captcha),
        errors: frames.flatMap((f) => f.errors || []).slice(0, 6),
      };
    } catch (_) {
      // Navigating after Submit: nothing to read for a moment.
      return { hrefs: [], lines: [], formPresent: false, captcha: false, errors: [], navigating: true };
    }
  }

  const CONFIRM_TEXT_RE =
    /thank(s| you)( so much)? for (applying|your application|submitting|your interest)|application (has been |was )?(successfully )?(submitted|received|sent|complete)|we('ve| have) received your application|successfully (applied|submitted)|you('ve| have) (successfully )?applied|submission (received|successful)/i;
  const CONFIRM_PATH_RE = /\/(confirmation|thanks|thank-you|thank_you|submitted|success)(\/|$)/i;
  /** A refusal of the whole application (not one field): it was not sent. */
  const SPAM_TEXT_RE =
    /flagged as (possible |potential )?spam|possible spam|suspicious activity|unusual activity|automated (submission|traffic|activity)|verify (that )?you('re| are) (a )?human|bot detected/i;
  const FAILURE_TEXT_RE =
    /something went wrong|an error occurred|could not be submitted|couldn't be submitted|failed to submit|unable to submit|there (was|were) (an |a )?(error|problem)|no longer (accepting|available)|(job|position|role|opening) (has been |is |was )?(closed|filled)|page not found|job not found|(session|link) (has )?expired|too many requests|try again later|access denied/i;
  /**
   * Text that means the page after Submit is not a confirmation, even though
   * the form is gone: a sign-in wall, an error or a rate limit.
   */
  const NOT_CONFIRMATION_RE =
    /\b(sign|log) ?in\b|password|\berror\b|\boops\b|try again|expired|denied|forbidden|not found|unavailable|\b(403|404|429|500|502|503)\b/i;

  function pathOf(href) {
    try {
      return new URL(href).pathname;
    } catch (_) {
      return '';
    }
  }


  /**
   * Compares the page before Submit with the page now. Only what appeared after
   * Submit counts, so a posting that itself says "thank you for applying" is
   * not a confirmation. Returns { verdict, by, newText, errors }, verdict one of:
   *   confirmed  a success message appeared, the address became a confirmation
   *              page, or the form was replaced by new text (`by` says which)
   *   spam       the site refused the application as spam or a bot
   *   failed     the site showed an error for the whole application
   *   captcha    a CAPTCHA challenge is open
   *   errors     field errors are showing
   *   wait       nothing decisive yet
   * `newText` is what appeared after Submit, kept in the job's history.
   */
  function judgeAfterSubmit(before, after) {
    const seen = new Set(before.lines || []);
    const added = (after.lines || []).filter((line) => !seen.has(line));
    // Every new line is judged; the lines that decided come first in newText.
    const text = added.join(' · ');
    const telling = added.filter((line) => SPAM_TEXT_RE.test(line) || FAILURE_TEXT_RE.test(line) || CONFIRM_TEXT_RE.test(line));
    const newText = [...telling, ...added.filter((line) => !telling.includes(line))].join(' · ').slice(0, 400);
    const base = { newText, errors: after.errors || [] };
    if (after.navigating) return { ...base, verdict: 'wait' };
    if (SPAM_TEXT_RE.test(text)) return { ...base, verdict: 'spam' };
    if (after.captcha) return { ...base, verdict: 'captcha' };
    const urlChanged = (after.hrefs || []).join('|') !== (before.hrefs || []).join('|');
    if (urlChanged && (after.hrefs || []).some((href) => CONFIRM_PATH_RE.test(pathOf(href)))) {
      return { ...base, verdict: 'confirmed', by: 'address' };
    }
    // An error beats a thank-you: "Thank you for your interest. This position
    // has been filled." was not sent.
    if (FAILURE_TEXT_RE.test(text)) return { ...base, verdict: 'failed' };
    if (CONFIRM_TEXT_RE.test(text)) return { ...base, verdict: 'confirmed', by: 'message' };
    if ((after.errors || []).length) return { ...base, verdict: 'errors' };
    // Some sites (Ashby) let each company write its own message: the form is
    // simply replaced by it, on the same site. Not when the new text looks like
    // a sign-in wall or an error page. The caller wants this on two looks in a row.
    const sameSite = hostOf((before.hrefs || [])[0]) === hostOf((after.hrefs || [])[0]);
    if (before.formPresent && !after.formPresent && added.length > 0 && sameSite && !NOT_CONFIRMATION_RE.test(text)) {
      return { ...base, verdict: 'confirmed', by: 'form_replaced' };
    }
    return { ...base, verdict: 'wait' };
  }

  function rowLabel(row) {
    const field = row?.field || {};
    return String(field.questionText || field.labelText || field.name || field.fieldCategory || 'field')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  /** The field's whole question, for matching (rowLabel is cut to 80 characters). */
  function rowText(row) {
    const field = row?.field || {};
    return [field.questionText, field.labelText].filter(Boolean).join(' ').replace(/\s+/g, ' ');
  }

  /** "I confirm that I am a real human being and not an automated bot…" */
  const BOT_CHECK_RE =
    /\b(real human|human being|i am not a (?:bot|robot)|not (?:an? )?(?:automated|bot|robot)\b|not (?:using|submitted by) (?:an? )?(?:automated|ai|bot))/i;
  const BOT_CHECK_STOP =
    'This company asks you to confirm you are a person, not an automated tool, so Auto-bid does not apply here. Apply by hand if you want this job.';

  /**
   * "During this application process I agree to use only my own words … the use
   * of AI will disqualify my application" (Canonical): Auto-bid's answers are
   * written with AI, so agreeing would be untrue. A rule about later interviews
   * (Airbnb's AI attestation) is a promise the candidate can keep and is agreed to.
   */
  const OWN_WORDS_RE =
    /\b(?:only my own words|in my own words|plagiari\w*)\b[\s\S]{0,240}\b(?:AI|artificial intelligence|generated)\b|\b(?:AI|artificial intelligence|generated content)\b[\s\S]{0,240}\b(?:only my own words|in my own words)\b/i;
  const OWN_WORDS_STOP =
    'This company asks you to confirm the application is in your own words, without AI. Auto-bid writes its answers with AI, so it does not apply here. Apply by hand if you want this job.';

  /**
   * Every field of the form as Autofill planned and filled it: what was
   * entered, where the value came from, and how filling went. Saved with the
   * job's result and shown on the website's Auto-bid page.
   */
  function fieldReport() {
    return currentPlan.map((row) => {
      const field = row.field || {};
      const value = String(row.suggestedValue ?? '').replace(/\s+/g, ' ').trim();
      const entry = {
        label: rowLabel(row),
        type: String(field.fieldType || ''),
        category: String(field.fieldCategory || ''),
        required: Boolean(field.required),
        source: String(row.source || ''),
        value: value.slice(0, 120),
        outcome: String(row.fillOutcome || ''),
        status: String(row.status || '').slice(0, 120),
        error: String(row.fillError || '').slice(0, 200),
      };
      const options = Array.isArray(field.options) ? field.options : [];
      if (options.length && row.fillOutcome !== 'filled') {
        // A dropdown that did not take the value: its first options show why.
        entry.optionCount = options.length;
        entry.options = options.slice(0, 8).map((o) => String(o?.text ?? o?.label ?? o ?? '').slice(0, 60));
      }
      return entry;
    });
  }

  /** Fields Autofill counted as filled but that are empty on the page. */
  function markEmptyOnPage(report, labels) {
    if (!Array.isArray(report)) return;
    for (const label of labels) {
      const key = String(label || '').slice(0, 40).toLowerCase();
      const entry = report.find((e) => e.label.toLowerCase().startsWith(key) || key.startsWith(e.label.slice(0, 40).toLowerCase()));
      if (entry) {
        entry.outcome = 'empty on page';
        entry.error = entry.error || 'Counted as filled, but the page shows it empty (no option was chosen).';
      }
    }
  }

  // ───────────────────────────── One job ─────────────────────────────

  class Stop extends Error {
    constructor(outcome, detail, meta = {}) {
      super(detail);
      this.outcome = outcome; // 'needs_you' | 'failed' | 'release' | 'pause'
      this.meta = meta;
    }
  }

  function checkStop() {
    if (state.stop || !state.prefs.enabled) throw new Stop('release', 'Auto-bid was stopped.');
  }

  async function finish(job, outcome, detail, meta) {
    await state.stepPost;
    try {
      await bid().autobidFetch(`/api/autobid/${job.id}/finish`, {
        method: 'POST',
        body: { claimedAt: job.claimed_at, outcome, detail, meta },
      });
    } catch (error) {
      logLine(`#${job.id}: could not record the result (${error?.message || error}).`);
    }
  }

  async function release(job) {
    await state.stepPost;
    try {
      await bid().autobidFetch(`/api/autobid/${job.id}/release`, { method: 'POST', body: { claimedAt: job.claimed_at } });
    } catch (_) {
      /* the claim goes stale and the job is taken again later */
    }
  }

  async function applyToJob(job, windowId) {
    const meta = { method: state.prefs.submit ? 'auto' : 'dry_run', startedAt: new Date().toISOString() };
    let tabId = null;
    let submitClicked = false;
    try {
      if (!job.built_resume_json) throw new Stop('failed', 'No generated resume JSON.');
      const profileSelect = document.getElementById('regProfileId');
      if (![...(profileSelect?.options || [])].some((o) => o.value === String(job.profile_id))) {
        throw new Stop('pause', `Profile #${job.profile_id} is not in the Bid tab's list. Sign in as the same user, then turn Auto-bid on again.`);
      }

      setStep('Opening the application form…');
      const url = applicationFormUrl(job.job_link);
      const tab = await chrome.tabs.create({ url, active: true, windowId });
      tabId = tab.id;
      meta.openedUrl = url;
      await bid().waitForTabLoaded(tabId, PAGE_LOAD_MS);
      await waitForPanelBind(tabId);
      checkStop();

      setStep('Applying the generated resume…');
      profileSelect.value = String(job.profile_id);
      profileSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(1000);
      // The job as it was queued: the stored link makes Register complete that row.
      bid().setRegisterFieldValue('regJobLink', job.job_link, 'autobid');
      bid().setRegisterFieldValue('regJobTitle', job.job_title, 'autobid');
      bid().setRegisterFieldValue('regCompany', job.company, 'autobid');
      bid().setRegisterFieldValue('regNote', job.job_description, 'autobid');
      let pretty = job.built_resume_json;
      try {
        pretty = JSON.stringify(JSON.parse(job.built_resume_json), null, 2);
      } catch (_) {
        /* saved as checked text: used as it is */
      }
      const jsonBox = document.getElementById('regResumeJson');
      if (jsonBox) jsonBox.value = pretty;
      const applied = bid().applyResumeJsonToRegisterForm(pretty, { silent: true });
      if (!applied?.ok) throw new Stop('failed', `The generated resume JSON was not accepted: ${applied?.error || 'invalid'}.`);

      setStep('Generating Word files (json2docx)…');
      // Generate trusts the connection dot: make it current first.
      const health = await json2docxHealth();
      if (health && !health.ok) {
        throw new Stop('pause', `json2docx is ${health.error === 'disabled' ? 'disabled in Settings' : 'offline'}: start it on this machine (start_server.bat).`);
      }
      await bid().generateFilesFromResumeJson(null);
      checkStop();

      // Without AI most forms stop at their own questions: the job waits for it instead.
      if (!(typeof isAiModeEnabled === 'function' && isAiModeEnabled())) {
        throw new Stop('pause', 'AI answers are off: turn on Settings → Autofill with AI, with an OpenAI key.');
      }
      setStep('Filling the form (AI)…');
      // This job's own answers (from its resume and posting) over the profile's.
      if (job.answers && Object.keys(job.answers).length) meta.answers = job.answers;
      setAutofillJobAnswers(job.answers || null);
      // The posting and resume were just set by code, which does not clear the AI's
      // cached context: without this, a job right after another is answered from the last one.
      if (typeof invalidateAiContextCache === 'function') invalidateAiContextCache();
      try {
        await autofillThisPage({ useAi: true });
      } finally {
        setAutofillJobAnswers(null);
      }
      checkStop();

      if (!currentFields.length) {
        // The scan's own error, when it had one, says more than "no form".
        const why = typeof lastAutofillError === 'string' && lastAutofillError ? ` Scan: ${lastAutofillError.slice(0, 160)}` : '';
        throw new Stop('needs_you', `No application form found on the page (it may need a login or an Apply click).${why}`, meta);
      }
      meta.fieldReport = fieldReport();
      // A form that asks the applicant to confirm they are a person, not an
      // automated tool: answering it would be untrue, so Auto-bid stops here.
      const botCheck = currentPlan.find((row) => BOT_CHECK_RE.test(rowText(row)));
      if (botCheck) {
        meta.botCheck = rowLabel(botCheck);
        throw new Stop(
          'needs_you',
          `${BOT_CHECK_STOP} ("${rowLabel(botCheck)}")`,
          meta
        );
      }
      const ownWords = currentPlan.find((row) => OWN_WORDS_RE.test(rowText(row)));
      if (ownWords) {
        meta.botCheck = rowLabel(ownWords);
        throw new Stop('needs_you', `${OWN_WORDS_STOP} ("${rowLabel(ownWords)}")`, meta);
      }
      const open = currentPlan.filter((row) => row.field?.required && row.fillOutcome !== 'filled');
      meta.fields = currentPlan.length;
      meta.filled = currentPlan.filter((row) => row.fillOutcome === 'filled').length;
      meta.aiAnswers = currentPlan.filter((row) => row.source === 'ai' && row.fillOutcome === 'filled').length;
      const notFilled = (labels) =>
        `Required ${labels.length === 1 ? 'field' : 'fields'} not filled: ${labels.slice(0, 5).join('; ')}${labels.length > 5 ? '…' : ''}`;
      if (open.length) {
        meta.openFields = open.map(rowLabel);
        throw new Stop('needs_you', notFilled(meta.openFields), meta);
      }
      // What Autofill counted as filled, read back from the page (a dropdown
      // with typed text but no option chosen is still empty).
      await sleep(1000);
      const emptyOnPage = await emptyRequiredOnPage(tabId);
      if (emptyOnPage.length) {
        meta.openFields = emptyOnPage;
        markEmptyOnPage(meta.fieldReport, emptyOnPage);
        throw new Stop('needs_you', notFilled(emptyOnPage), meta);
      }

      const formHref = (await frameHref(tabId, autofillFrameId)) || url;
      meta.formHost = hostOf(formHref);
      if (!SUBMIT_HOST_RE.test(meta.formHost)) {
        throw new Stop(
          'needs_you',
          `Filled. Auto-submit covers Greenhouse and Lever; this form is on ${meta.formHost || 'another site'}. Review it, submit, then Register.`,
          meta
        );
      }
      if (!state.prefs.submit) {
        throw new Stop('needs_you', 'Dry run: filled and checked, not submitted. Review the tab, submit, then Register.', meta);
      }
      if (CLICK_YOURSELF_HOST_RE.test(meta.formHost)) {
        meta.readyForClick = true;
        throw new Stop(
          'needs_you',
          'Ready for your click: filled and checked. Ashby does not take a Submit pressed by Auto-bid, so press Submit in the tab yourself.',
          meta
        );
      }
      checkStop();

      setStep('Submitting…');
      const before = await probeOutcome(tabId);
      if (before.navigating || !before.formPresent) {
        // Nothing to compare the page with after Submit: not pressed.
        throw new Stop('needs_you', 'Filled, but the form could not be read just before Submit. Review the tab and submit it by hand.', meta);
      }
      const [click] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [autofillFrameId || 0] },
        func: clickSubmitButton,
      });
      if (!click?.result?.clicked) throw new Stop('needs_you', 'Filled, but no Submit button was found. Submit it by hand.', meta);
      submitClicked = true;
      meta.submitClicked = true;
      meta.submitLabel = click.result.label;

      setStep('Waiting for the confirmation…');
      const until = Date.now() + CONFIRM_WAIT_MS;
      let judged = null;
      let errorPolls = 0;
      let confirmPolls = 0;
      while (Date.now() < until) {
        await sleep(CONFIRM_POLL_MS);
        const outcome = await probeOutcome(tabId);
        judged = judgeAfterSubmit(before, outcome);
        if (!outcome.navigating) {
          // What the page showed after Submit, kept with the job either way.
          meta.afterSubmit = { hrefs: outcome.hrefs, newText: judged.newText, formPresent: outcome.formPresent };
        }
        const shown = judged.newText ? ` The page shows: “${judged.newText.slice(0, 200)}”.` : '';
        if (judged.verdict === 'confirmed') {
          // A replaced form must still be gone on the next look (not a re-render).
          confirmPolls = judged.by === 'form_replaced' ? confirmPolls + 1 : 2;
          if (confirmPolls >= 2) break;
          continue;
        }
        confirmPolls = 0;
        if (judged.verdict === 'spam') {
          throw new Stop('needs_you', `The site refused the application as possible spam, so it was most likely not sent.${shown}`, meta);
        }
        if (judged.verdict === 'captcha') {
          throw new Stop('needs_you', 'A CAPTCHA appeared after Submit. Solve it in the tab, submit, then Register.', meta);
        }
        if (judged.verdict === 'failed') {
          throw new Stop('needs_you', `The site showed an error after Submit, so it was most likely not sent.${shown}`, meta);
        }
        errorPolls = judged.verdict === 'errors' ? errorPolls + 1 : 0;
        if (errorPolls >= 2) {
          meta.pageErrors = judged.errors;
          throw new Stop('needs_you', `The site rejected the form: ${judged.errors.slice(0, 3).join('; ')}`, meta);
        }
      }
      if (judged?.verdict !== 'confirmed' || confirmPolls < 2) {
        const shown = judged?.newText
          ? `The page shows: “${judged.newText.slice(0, 200)}”.`
          : 'Nothing new appeared on the page.';
        throw new Stop(
          'needs_you',
          `Submit was clicked but no confirmation was recognised. ${shown} Check the tab before doing anything else.`,
          meta
        );
      }
      meta.confirmedBy = judged.by;
      setStep(
        `Confirmed (${judged.by === 'form_replaced' ? 'the form was replaced' : `by the ${judged.by}`}): ${
          judged.newText.slice(0, 160) || 'confirmation page'
        }`
      );

      // Recorded first: whatever happens to Register, this job is never sent again.
      meta.confirmedAt = new Date().toISOString();
      await finish(job, 'submitted', '', meta);
      setStep('Registering in Resume DB…');
      try {
        await bid().registerForAutobid();
        logLine(`Sent and registered: ${job.company} · ${job.job_title} (#${job.id}).`);
      } catch (error) {
        logLine(`Sent #${job.id}, but Register failed: ${error?.message || error}. Register it from Resume DB / the Bid tab.`);
      }
      await chrome.tabs.remove(tabId).catch(() => {});
      return 'submitted';
    } catch (error) {
      const stop =
        error instanceof Stop
          ? error
          : ENVIRONMENT_ERROR_RE.test(error?.message || '') && !submitClicked
            ? new Stop('pause', error?.message || String(error))
            : new Stop(submitClicked ? 'needs_you' : 'failed', error?.message || String(error));
      const detail = stop.message;
      state.lastDetail = detail;
      if (stop.outcome === 'release' || stop.outcome === 'pause') {
        // Nothing was sent: the job waits for the next run, untouched.
        if (submitClicked) {
          await finish(job, 'needs_you', `Stopped after Submit was clicked: ${detail}`, { ...meta, submitClicked: true });
        } else {
          await release(job);
          if (tabId) await chrome.tabs.remove(tabId).catch(() => {});
        }
        logLine(`#${job.id}: ${detail}`);
        if (stop.outcome === 'pause') {
          // Unattended runs recover by themselves (json2docx restarted, signed in again).
          state.pauseReason = detail;
          toast(`Auto-bid paused: ${detail} It tries again in 5 minutes.`, 'error');
        }
        return stop.outcome;
      }
      await finish(job, stop.outcome, detail, { ...meta, ...stop.meta, submitClicked: submitClicked || undefined });
      logLine(`Needs you — ${job.company} · ${job.job_title} (#${job.id}): ${detail}`);
      // Left open for the user (a failed one too: it shows what happened).
      if (tabId) keepTabOpen(tabId);
      return stop.outcome;
    }
  }

  /** Running all day, stopped jobs would fill the window: only the newest few stay open. */
  function keepTabOpen(tabId) {
    state.tabsLeftOpen = [...state.tabsLeftOpen.filter((id) => id !== tabId), tabId];
    while (state.tabsLeftOpen.length > MAX_TABS_LEFT_OPEN) {
      chrome.tabs.remove(state.tabsLeftOpen.shift()).catch(() => {});
    }
  }

  // ───────────────────────────── Loop ─────────────────────────────

  function schedule(ms) {
    if (state.timer) clearTimeout(state.timer);
    state.timer = state.prefs.enabled ? setTimeout(() => void tick(), ms) : null;
  }

  async function tick() {
    if (!state.prefs.enabled || state.running) return;
    state.running = true;
    state.stop = false;
    let next = IDLE_POLL_MS;
    try {
      const summary = await refreshSummary();
      if (!summary) return;
      if (state.prefs.submit && summary.submittedSince >= state.prefs.dailyLimit) {
        setStep(`Daily limit reached (${state.prefs.dailyLimit}). Resumes tomorrow.`);
        return;
      }
      if (!summary.ready) {
        setStep('Waiting for generated resumes…');
        return;
      }
      // The server picks the freshest job and enforces the day's limit for every panel.
      const { job, reason } = await bid().autobidFetch('/api/autobid/next', { method: 'POST' });
      if (!job) {
        setStep(reason || 'Waiting for generated resumes…');
        return;
      }
      const win = await chrome.windows.getCurrent().catch(() => null);
      state.job = job;
      state.lastDetail = '';
      const dryRun = !state.prefs.submit;
      // A test run of the whole chain on one job (the setup's "one job" mode).
      const once = !dryRun && Boolean(isRunning() && wf.config?.once);
      logLine(`${dryRun ? 'Dry run' : once ? 'Test run (one job)' : 'Applying'}: ${job.company} · ${job.job_title} (#${job.id}).`);
      const outcome = await applyToJob(job, win?.id);
      next = outcome === 'submitted' ? gapAfterSubmitMs() : Math.max(5, Number(state.prefs.gapSeconds) || 30) * 1000;
      if (outcome === 'pause') {
        next = PAUSE_RETRY_MS;
        const at = new Date(Date.now() + next).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        state.job = null;
        setStep(`Paused: ${state.pauseReason} Trying again at ${at}.`);
        return;
      }
      state.pauseReason = '';
      if (dryRun && outcome !== 'release' && outcome !== 'pause') {
        // One form at a time to review, not a window full of them.
        state.prefs.enabled = false;
        await savePrefs();
        setStep(`Dry run done for #${job.id}: review the open tab. Choose Submit and press Start to apply by itself.`);
        toast('Dry run finished one job: review the filled form in the open tab.', 'info');
        void stopAfterOneJob(job, 'dry', state.lastDetail);
      }
      // A test run stops once a job was sent or needs you; a job that could not
      // be applied to at all (closed posting), or an Ashby form left for your
      // click, does not count: the next one is tried.
      const leftForClick = /^Ready for your click/.test(state.lastDetail);
      if (once && (outcome === 'submitted' || (outcome === 'needs_you' && !leftForClick))) {
        state.prefs.enabled = false;
        await savePrefs();
        setStep(
          outcome === 'submitted'
            ? `Test run done: #${job.id} was sent, confirmed and registered. Choose Submit and press Start to keep going.`
            : `Test run stopped at #${job.id}: it needs you (see Needs you). Nothing else was applied to.`
        );
        toast(outcome === 'submitted' ? 'Test run: one job sent and registered.' : 'Test run: the job needs you.', outcome === 'submitted' ? 'success' : 'warn');
        void stopAfterOneJob(job, outcome, state.lastDetail);
      }
    } catch (error) {
      setStep(error?.message || String(error));
      logLine(error?.message || String(error));
    } finally {
      state.job = null;
      state.running = false;
      if (state.prefs.enabled) await refreshSummary();
      render();
      schedule(next);
    }
  }

  /**
   * After a sent application, a pause picked at random in the setup's range
   * (2–5 minutes by default): a person's pace, not 30 applications an hour.
   */
  function gapAfterSubmitMs() {
    const min = Math.max(0, Number(wf.config?.gapMin ?? 2));
    const max = Math.max(min, Number(wf.config?.gapMax ?? 5));
    const minutes = min + Math.random() * (max - min);
    return Math.max(5000, Math.round(minutes * 60 * 1000));
  }

  async function setEnabled(on) {
    state.prefs.enabled = Boolean(on);
    await savePrefs();
    if (!on) {
      state.stop = true;
      setStep(state.running ? 'Stopping after this step…' : 'Off');
      schedule(0);
      return;
    }
    if (!state.prefs.submit) toast('Auto-bid dry run: it fills one form, stops before Submit and leaves it open for you.', 'info');
    render();
    schedule(1000);
  }

  async function onNeedsYouClick(event) {
    const btn = event.target.closest('[data-ab-action]');
    if (!btn) return;
    const id = Number(btn.closest('[data-ab-id]')?.getAttribute('data-ab-id'));
    const row = state.summary?.needsYou?.find((item) => item.id === id);
    if (!row) return;
    if (btn.getAttribute('data-ab-action') === 'open') {
      if (row.jobLink) await chrome.tabs.create({ url: row.jobLink, active: true });
      return;
    }
    btn.disabled = true;
    try {
      const { retried } = (await bid().autobidFetch('/api/autobid/retry', { method: 'POST', body: { ids: [id] } })) || {};
      if (!retried) {
        // The server keeps a job where Submit was pressed: it may already be sent.
        toast('Not retried: Submit was already pressed on this job. Check the site, and register it by hand if it was sent.', 'warn');
        btn.disabled = false;
        return;
      }
      logLine(`#${id} given back to Auto-bid.`);
      await refreshSummary();
      schedule(1000);
    } catch (error) {
      toast(error?.message || String(error), 'error');
      btn.disabled = false;
    }
  }

  // ───────────────────────────── All-in-one workflow ─────────────────────────────
  // One Start/Stop and one setup for the whole chain, saved on the server: the
  // website's Auto-bid page and this panel's Auto-bid tab edit the same setup,
  // and this panel runs it. Start: Live finds jobs and queues the Greenhouse /
  // Lever / Ashby ones for AutoGen, AutoGen keeps N ChatGPT windows generating,
  // and the runner above applies and registers. Stop undoes all three.

  const CONFIG_POLL_MS = 20 * 1000;
  const AUTOGEN_CHECK_MS = 2 * 60 * 1000;
  /** Opening several ChatGPT windows can take a while. */
  const AUTOGEN_REPLY_MS = 3 * 60 * 1000;
  const HEALTH_EVERY_MS = 2 * 60 * 1000;
  const APPLIED_KEY = 'autobid_workflow_applied';

  const wf = {
    config: null,
    appliedVersion: -1,
    /** The last setup applied here was running: Stop must also stop AutoGen. */
    appliedRunning: false,
    /** This panel has started the running setup in this session (Live, runner, AutoGen are on). */
    active: false,
    /** The apply in progress; a setup that arrives meanwhile is applied right after it. */
    applying: null,
    reapply: false,
    saving: false,
    error: '',
    configError: '',
    json2docx: null,
    checkedAt: 0,
    autogen: null,
    autogenId: '',
    autogenCheckedAt: 0,
    autogenSync: null,
    autogenResync: false,
    /** This panel, across reloads; another Chrome profile or computer has its own. */
    instanceId: '',
    /** When another panel's report was last seen (each report replaces the one before). */
    otherPanelAt: 0,
    openedAt: Date.now(),
  };

  function live() {
    return window.SmartJobLive || null;
  }

  function isRunning() {
    return Boolean(wf.config?.running);
  }

  async function checkJson2docx(force = false) {
    if (!force && Date.now() - wf.checkedAt < HEALTH_EVERY_MS) return;
    wf.checkedAt = Date.now();
    const health = await window.SmartJobJson2Docx?.checkJson2docxHealth?.({ updateUi: false }).catch(() => null);
    wf.json2docx = health ? Boolean(health.ok) : null;
  }

  // AutoGen is its own extension: found by name, driven by message.

  async function findAutogen() {
    if (wf.autogenId) return wf.autogenId;
    const all = (await chrome.management?.getAll?.().catch(() => [])) || [];
    const ext = all.find((e) => e.enabled && e.type === 'extension' && e.id !== chrome.runtime.id && /autogen/i.test(e.name));
    wf.autogenId = ext?.id || '';
    return wf.autogenId;
  }

  async function askAutogen(message) {
    const id = await findAutogen();
    if (!id) return { ok: false, missing: true };
    try {
      const reply = await Promise.race([
        chrome.runtime.sendMessage(id, message),
        sleep(AUTOGEN_REPLY_MS).then(() => null),
      ]);
      return reply || { ok: false, error: 'AutoGen did not answer.' };
    } catch (error) {
      wf.autogenId = ''; // reloaded or removed: looked up again next time
      return { ok: false, error: error?.message || String(error) };
    }
  }

  /**
   * While the setup runs here, AutoGen is asked to keep the set number of
   * windows (a closed one is replaced). One request at a time: a forced one
   * that arrives meanwhile is sent after it, so windows are never opened twice.
   */
  function syncAutogen(force = false) {
    if (wf.autogenSync) {
      if (force) wf.autogenResync = true;
      return wf.autogenSync;
    }
    if (!force && Date.now() - wf.autogenCheckedAt < AUTOGEN_CHECK_MS) return Promise.resolve();
    wf.autogenSync = (async () => {
      do {
        wf.autogenResync = false;
        wf.autogenCheckedAt = Date.now();
        wf.autogen =
          wf.active && isRunning()
            ? await askAutogen({ type: 'AUTOGEN_EXT_ENSURE_WINDOWS', count: wf.config.windows })
            : await askAutogen({ type: 'AUTOGEN_EXT_STATUS' });
      } while (wf.autogenResync);
    })().finally(() => {
      wf.autogenSync = null;
      renderWorkflow();
    });
    return wf.autogenSync;
  }

  /**
   * Makes this panel do what the setup says. A version is applied once; one
   * that cannot be applied yet (profile list still loading) is tried again on
   * the next poll. A setup older than the one already known (a slow poll that
   * started before a save) is ignored. While an apply runs, a newer setup is
   * applied right after it, and the caller waits for that too.
   */
  function applyConfig(config, { force = false } = {}) {
    if (wf.config && config.version < wf.config.version) return wf.applying || Promise.resolve();
    wf.config = config;
    if (wf.applying) {
      wf.reapply = true;
      renderWorkflow();
      return wf.applying;
    }
    if (!force && config.version === wf.appliedVersion) {
      renderWorkflow();
      return Promise.resolve();
    }
    wf.applying = (async () => {
      do {
        wf.reapply = false;
        await applyOneConfig(wf.config);
      } while (wf.reapply && wf.config.version !== wf.appliedVersion);
    })().finally(() => {
      wf.applying = null;
      renderWorkflow();
    });
    return wf.applying;
  }

  /** Why this machine cannot start the setup, or '' when it can. */
  async function startBlocker() {
    if (!(typeof isAiModeEnabled === 'function' && isAiModeEnabled())) {
      return 'AI answers are off in this panel. Turn on Settings → Autofill with AI, with an OpenAI key, then press Start.';
    }
    const health = await json2docxHealth();
    wf.json2docx = health ? Boolean(health.ok) : wf.json2docx;
    if (health && !health.ok) return 'json2docx is not running on this machine. Start it (start_server.bat), then press Start.';
    try {
      const { autobid: report } = (await bid().autobidFetch('/api/autobid/status')) || {};
      noteReport(report);
    } catch (_) {
      /* the status columns are optional: only the duplicate check is skipped */
    }
    // Another open panel no longer blocks Start: the server hands each job to
    // one panel only and counts the day's limit for all of them.
    return '';
  }

  /**
   * Remembers a report written by another panel. An older panel sends no
   * instanceId, so one without it counts only if written after this panel
   * opened: before that it may be this panel's own, from before an update.
   */
  function noteReport(report) {
    const at = Date.parse(report?.reportedAt || '');
    if (!report || !at || report.instanceId === wf.instanceId) return;
    if (!report.instanceId && at <= wf.openedAt) return;
    wf.otherPanelAt = Math.max(wf.otherPanelAt, at);
  }

  function otherPanelOpen() {
    return Date.now() - wf.otherPanelAt < OTHER_PANEL_MS;
  }

  async function applyOneConfig(config) {
    if (config.running && !wf.appliedRunning) {
      // Only on Start: a panel reopened while the setup runs carries on.
      const blocker = await startBlocker();
      if (blocker) {
        wf.error = blocker;
        wf.appliedVersion = config.version; // handled: nothing was started for it
        // Not awaited: the saved (stopped) setup is applied after this apply ends.
        void saveConfig({ running: false, note: `Not started: ${blocker}` });
        return;
      }
    }
    if (config.running) {
      const profile = bid()?.profileById?.(config.profileId);
      if (!profile) {
        wf.error = `Profile ${config.profileName || `#${config.profileId}`} is not in this panel's list yet (sign in as the same user).`;
        return;
      }
      if (!live()?.applyWorkflow) {
        wf.error = 'The Job Scraper part of the panel has not loaded yet.';
        return;
      }
      await live().applyWorkflow({
        profile,
        hours: config.hours,
        everyMinutes: config.everyMinutes,
        hiringCafe: config.hiringCafe,
        jobright: config.jobright,
        freshnessHours: config.freshnessHours,
      });
      state.prefs.submit = Boolean(config.submit);
      state.prefs.dailyLimit = config.dailyLimit;
      await savePrefs();
      if (!state.prefs.enabled) await setEnabled(true);
      else {
        render();
        schedule(1000);
      }
      wf.active = true;
      void checkJson2docx(true);
      void syncAutogen(true);
    } else {
      // Only what a running setup switched on is switched off: Live's own
      // auto-queue, set by hand while Auto-bid is stopped, is left alone.
      if (wf.appliedRunning || wf.active) await live()?.applyWorkflow?.(null);
      if (state.prefs.enabled) await setEnabled(false);
      state.prefs.submit = Boolean(config.submit);
      state.prefs.dailyLimit = config.dailyLimit;
      await savePrefs();
      const stopAutogen = wf.appliedRunning || wf.active;
      wf.active = false;
      if (stopAutogen) wf.autogen = await askAutogen({ type: 'AUTOGEN_EXT_STOP_ALL' });
    }
    wf.error = '';
    wf.appliedVersion = config.version;
    wf.appliedRunning = Boolean(config.running);
    await chrome.storage.local.set({ [APPLIED_KEY]: { version: wf.appliedVersion, running: wf.appliedRunning } });
  }

  async function pollConfig() {
    try {
      const { config } = await bid().autobidFetch('/api/autobid/config');
      wf.configError = '';
      await applyConfig(config);
    } catch (error) {
      wf.configError = error?.message || String(error);
      renderWorkflow();
    }
  }

  /** Saves a change to the shared setup, then applies the result here. */
  async function saveConfig(edit) {
    wf.saving = true;
    renderWorkflow();
    try {
      const { config } = await bid().autobidFetch('/api/autobid/config', { method: 'PUT', body: { ...edit, by: 'panel' } });
      wf.configError = '';
      await applyConfig(config);
      return true;
    } catch (error) {
      toast(error?.message || String(error), 'error');
      return false;
    } finally {
      wf.saving = false;
      renderWorkflow();
    }
  }

  async function stopAfterOneJob(job, outcome, detail = '') {
    if (!isRunning()) return;
    const name = `#${job.id} ${job.company || ''}`.trim();
    // A clean dry run ends with "Dry run: filled and checked…"; anything else
    // is what would have stopped this job with Submit on.
    const clean = /^Dry run:/.test(detail);
    const note = {
      dry: clean || !detail
        ? `Dry run done for ${name}: every field was filled and checked. Review the open tab; to apply for real, choose Test run or Submit and press Start.`
        : `Dry run stopped at ${name}: ${detail} With Submit on, this job would go to Needs you. The form is left open.`,
      submitted: `Test run done: ${name} was sent, confirmed and registered (see Resume DB). To keep going, choose Submit and press Start.`,
      needs_you: `Test run stopped: ${name} needs you${detail ? ` (${detail})` : ''}. Nothing else was applied to.`,
    }[outcome];
    await saveConfig({ running: false, note });
  }

  function formSetup() {
    const value = (id) => document.getElementById(id)?.value ?? '';
    const checked = (id) => Boolean(document.getElementById(id)?.checked);
    const profileId = value('wfProfile');
    const profile = profileId ? bid()?.profileById?.(profileId) : null;
    // An emptied number is sent as '': the server keeps the current value.
    const number = (id) => (String(value(id)).trim() === '' ? '' : Number(value(id)));
    return {
      profileId: profileId ? Number(profileId) : null,
      profileName: profile?.name || '',
      submit: value('wfMode') !== 'dry',
      once: value('wfMode') === 'once',
      dailyLimit: number('wfDailyLimit'),
      windows: number('wfWindows'),
      hours: value('wfHours'),
      everyMinutes: number('wfEvery'),
      hiringCafe: checked('wfHc'),
      jobright: checked('wfJr'),
    };
  }

  async function onStartClick() {
    if (isRunning()) {
      await saveConfig({ running: false, note: '' });
      toast('Auto-bid stopped: nothing is found, generated or sent.', 'info');
      return;
    }
    const setup = formSetup();
    if (!setup.profileId) {
      toast('Choose the profile first.', 'warn');
      return;
    }
    if (await saveConfig({ ...setup, running: true })) {
      toast(
        !setup.submit
          ? `Auto-bid dry run for ${setup.profileName}: it fills one job, leaves it open for you, then stops.`
          : setup.once
            ? `Auto-bid test run for ${setup.profileName}: it applies to one job (Submit, confirmation, Register), then stops.`
            : `Auto-bid started for ${setup.profileName}: new jobs are found, generated and applied to by themselves.`,
        'success'
      );
    }
  }

  /** A setting changed in the form: saved at once (and applied while running). */
  async function onSetupChange(event) {
    const id = event.target?.id || '';
    const fields = {
      wfProfile: ['profileId', 'profileName'],
      wfMode: ['submit', 'once'],
      wfDailyLimit: ['dailyLimit'],
      wfWindows: ['windows'],
      wfHours: ['hours'],
      wfEvery: ['everyMinutes'],
      wfHc: ['hiringCafe'],
      wfJr: ['jobright'],
    }[id];
    if (!fields) return;
    const setup = formSetup();
    const edit = Object.fromEntries(fields.map((key) => [key, setup[key]]));
    if (Object.values(edit).some((v) => v === '') && event.target.type === 'number') {
      fillSetupForm(true); // emptied: the current value comes back, nothing is saved
      return;
    }
    if (!(await saveConfig(edit))) fillSetupForm(true);
  }

  /** What the whole chain needs, as [label, ok (true / false / null = unknown), note]. */
  function workflowChecks() {
    const l = live()?.autoState?.() || {};
    const c = wf.config;
    const running = isRunning();
    const aiOn = typeof isAiModeEnabled === 'function' && isAiModeEnabled();
    const ag = wf.autogen;
    const agWindows = ag?.windows || [];
    const want = c?.windows || 0;
    const agNote = !ag
      ? 'checking…'
      : ag.missing
        ? 'AutoGen extension not found: install and enable it in this Chrome'
        : ag.ok === false
          ? /receiving end does not exist/i.test(ag.error || '')
            ? 'This AutoGen is an older version: reload it in chrome://extensions after updating its folder'
            : ag.error || 'AutoGen did not answer'
          : !ag.signedIn
            ? 'Sign AutoGen in to the same JobStrike site (AutoGen → Settings)'
            : `${agWindows.length}${running ? ` of ${want}` : ''} ChatGPT window${agWindows.length === 1 ? '' : 's'} generating${
                agWindows.some((w) => w.minimized) ? ' · one is minimized (it cannot generate)' : ''
              }`;
    const agOk = !ag ? null : ag.missing || ag.ok === false || !ag.signedIn ? false : running ? agWindows.length >= want : null;
    return [
      ['Live finds new jobs and queues them for AutoGen', running ? Boolean(l.live && l.autoQueue) : null,
        l.challenge ? 'Paused: a site asked for a check (Job Scraper tab)' : l.live ? l.status || '' : 'off'],
      ['AutoGen generates resumes', agOk, agNote],
      [
        !state.prefs.submit
          ? 'Auto-bid fills one job (dry run)'
          : c?.once
            ? 'Auto-bid applies to one job and presses Submit (test run)'
            : 'Auto-bid applies and presses Submit',
        running ? Boolean(state.prefs.enabled) : null,
        state.pauseReason ? `Paused: ${state.pauseReason}` : '',
      ],
      ['json2docx running', wf.json2docx, wf.json2docx === false ? 'Start it on this machine (start_server.bat)' : ''],
      ['AI answers custom questions', aiOn, aiOn ? '' : 'Settings → Autofill with AI, with an OpenAI key'],
      ['Only this JobStrike panel is open', otherPanelOpen() ? null : true,
        otherPanelOpen()
          ? 'Another panel (another Chrome profile or computer) is open too. Safe: each job goes to one panel. But both read Jobright, which doubles its requests.'
          : ''],
    ];
  }

  function fillProfileOptions() {
    const select = document.getElementById('wfProfile');
    if (!select) return;
    const profiles = bid()?.listRegisterProfiles?.() || [];
    const signature = profiles.map((p) => `${p.id}:${p.name}`).join('|');
    if (select.dataset.signature === signature) return;
    select.dataset.signature = signature;
    select.innerHTML =
      `<option value="">Choose a profile…</option>` +
      profiles.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
  }

  /** The form shows the saved setup (not while the user is typing in a field). */
  function fillSetupForm(force = false) {
    const c = wf.config;
    if (!c) return;
    fillProfileOptions();
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (!el || (!force && document.activeElement === el)) return;
      if (el.type === 'checkbox') el.checked = Boolean(value);
      else el.value = value == null ? '' : String(value);
    };
    set('wfProfile', c.profileId || '');
    set('wfMode', !c.submit ? 'dry' : c.once ? 'once' : 'submit');
    set('wfDailyLimit', c.dailyLimit);
    set('wfWindows', c.windows);
    set('wfHours', c.hours);
    set('wfEvery', c.everyMinutes);
    set('wfHc', c.hiringCafe);
    set('wfJr', c.jobright);
  }

  function renderWorkflow() {
    const card = document.getElementById('wfCard');
    if (!card) return;
    const running = isRunning();
    card.classList.toggle('is-on', running);
    fillSetupForm();

    const start = document.getElementById('wfStart');
    if (start) {
      start.textContent = wf.saving ? 'Saving…' : running ? 'Stop' : 'Start';
      start.disabled = wf.saving || !wf.config;
      start.classList.toggle('is-stop', running);
    }
    const status = document.getElementById('wfStatus');
    if (status) {
      const s = state.summary;
      status.textContent = !wf.config
        ? 'Not connected'
        : !running
          ? 'Stopped'
          : `${!wf.config.submit ? 'Dry run' : wf.config.once ? 'Test run' : 'Running'}${s ? ` · ${s.submittedSince} sent today of ${state.prefs.dailyLimit}` : ''}`;
    }
    const summary = document.getElementById('wfSummary');
    if (summary) {
      const c = wf.config;
      summary.textContent = wf.configError
        ? wf.configError
        : wf.error
          ? wf.error
          : c?.updatedAt
            ? `Changed ${new Date(c.updatedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} from the ${
                c.updatedBy === 'web' ? 'website' : 'panel'
              }. The website's Auto-bid page shows and changes the same setup.`
            : 'The website’s Auto-bid page shows and changes the same setup.';
      summary.classList.toggle('is-error', Boolean(wf.configError || wf.error));
    }
    const note = document.getElementById('wfNote');
    if (note) {
      note.hidden = !wf.config?.note || running;
      note.textContent = wf.config?.note || '';
    }
    const list = document.getElementById('wfChecks');
    if (list) {
      list.innerHTML = workflowChecks()
        .map(([label, ok, text]) => {
          const mark = ok ? 'ok' : ok === null || ok === undefined ? 'unknown' : 'off';
          const sign = mark === 'ok' ? '✓' : mark === 'off' ? '✗' : '·';
          return `<li class="fa-check" data-state="${mark}"><span class="fa-mark" aria-hidden="true">${sign}</span><span class="fa-label">${escapeHtml(label)}${
            text ? ` <em>${escapeHtml(text)}</em>` : ''
          }</span></li>`;
        })
        .join('');
    }
  }

  // ───────────────────────────── Report to the website ─────────────────────────────
  // The site's Auto-bid page shows this panel's state. Sent when it changes,
  // and at least every minute so the page can tell a closed panel from an idle one.

  const REPORT_EVERY_MS = 60 * 1000;
  const report = { last: '', at: 0, sending: false };

  function runnerState() {
    if (!state.prefs.enabled) return 'off';
    if (state.job) return 'applying';
    if (state.pauseReason) return 'paused';
    if (state.prefs.submit && state.summary && state.summary.submittedSince >= state.prefs.dailyLimit) return 'limit';
    return 'waiting';
  }

  function statusReport() {
    const l = live()?.autoState?.() || null;
    const s = state.summary;
    return {
      version: chrome.runtime?.getManifest?.().version || '',
      instanceId: wf.instanceId,
      state: runnerState(),
      fullAuto: wf.active,
      configVersion: wf.appliedVersion,
      setupError: wf.configError || wf.error || '',
      enabled: Boolean(state.prefs.enabled),
      submit: Boolean(state.prefs.submit),
      dailyLimit: state.prefs.dailyLimit,
      step: state.step,
      pauseReason: state.pauseReason || '',
      job: state.job ? { id: state.job.id, company: state.job.company, jobTitle: state.job.job_title } : null,
      summary: s ? { ready: s.ready, sentToday: s.submittedSince, needsYou: s.needsYou.length } : null,
      checks: workflowChecks().map(([label, ok, note]) => ({ label, ok: ok === undefined ? null : ok, note })),
      live: l,
      log: state.log.slice(0, 15),
    };
  }

  async function reportStatus() {
    if (report.sending) return;
    const body = statusReport();
    const text = JSON.stringify(body);
    if (text === report.last && Date.now() - report.at < REPORT_EVERY_MS) return;
    report.sending = true;
    try {
      const saved = await bid().autobidFetch('/api/autobid/status', { method: 'POST', body: { kind: 'autobid', status: body } });
      // The report this one replaced: another panel's means two are open.
      noteReport(saved?.previous);
      report.last = text;
      report.at = Date.now();
    } catch (_) {
      /* not signed in or the migration has not run: the next round tries again */
      report.at = Date.now();
    } finally {
      report.sending = false;
    }
  }

  async function openWebsitePage(event) {
    event.preventDefault();
    const base = await bid()?.backendBaseUrl?.().catch(() => '');
    if (base) await chrome.tabs.create({ url: `${base}/autobid`, active: true });
  }

  async function init() {
    if (!document.getElementById('abCard')) return;
    await loadPrefs();
    wf.instanceId = (await chrome.storage.local.get(INSTANCE_KEY).catch(() => ({})))?.[INSTANCE_KEY] || '';
    if (!wf.instanceId) {
      wf.instanceId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await chrome.storage.local.set({ [INSTANCE_KEY]: wf.instanceId }).catch(() => {});
    }
    const applied = (await chrome.storage.local.get(APPLIED_KEY).catch(() => ({})))?.[APPLIED_KEY];
    // A fresh panel applies the setup once, whatever version it last saw.
    wf.appliedRunning = Boolean(applied?.running);
    document.getElementById('abRefresh')?.addEventListener('click', () => void refreshSummary());
    document.getElementById('abNeedsYou')?.addEventListener('click', (event) => void onNeedsYouClick(event));
    document.getElementById('wfStart')?.addEventListener('click', () => void onStartClick());
    document.getElementById('wfSetup')?.addEventListener('change', (event) => void onSetupChange(event));
    document.getElementById('wfWebsite')?.addEventListener('click', (event) => void openWebsitePage(event));
    setInterval(() => {
      void checkJson2docx()
        .then(() => (wf.active ? syncAutogen() : null))
        .then(renderWorkflow)
        .then(reportStatus);
    }, 5000);
    setInterval(() => void pollConfig(), CONFIG_POLL_MS);
    render();
    // Profiles and the sign-in load first; then the setup is read and applied.
    setTimeout(() => {
      void pollConfig().then(() => syncAutogen(true));
    }, 3000);
    if (state.prefs.enabled) {
      setStep('Starting…');
      schedule(8000);
    } else {
      setTimeout(() => void refreshSummary(), 4000);
    }
  }

  window.addEventListener('DOMContentLoaded', () => void init());

  window.SmartJobAutoBid = { applicationFormUrl, clickSubmitButton, probeApplicationOutcome, judgeAfterSubmit };
})();
