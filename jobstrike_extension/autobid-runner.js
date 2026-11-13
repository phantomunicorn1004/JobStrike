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
 * no answer for, a site it does not submit on,
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
  const VERIFY_CODE_POLL_MS = 5000;
  const VERIFY_CODE_WAIT_MS = 3 * 60 * 1000;
  /** A problem with this machine (json2docx down, signed out): wait this long, then try again. */
  const PAUSE_RETRY_MS = 5 * 60 * 1000;
  /** Needs-you tabs kept open for the user; older ones are closed (the job stays listed). */
  const MAX_TABS_LEFT_OPEN = 6;
  const MAX_PERSON_TABS_OPEN = 12;
  /** Sites Auto-bid presses Submit on. Others are filled and left for the user. */
  const SUBMIT_HOST_RE = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|rippling\.com|workable\.com|bamboohr\.com|smartrecruiters\.com|pinpointhq\.com|myworkdayjobs\.com|myworkdaysite\.com|workday\.com|icims\.com)$/i;
  /** Sites whose Submit button needs a full pointer-event sequence (bare .click() is ignored). */
  const FULL_CLICK_HOST_RE = /(^|\.)(ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|workday\.com)$/i;
  const WORKDAY_HOST_RE = /(^|\.)(myworkdayjobs\.com|myworkdaysite\.com|workday\.com)$/i;
  const WORKDAY_MAX_PAGES = 8;
  const WORKDAY_PAGE_WAIT_MS = 5000;
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
    /** Tabs waiting for the user to finish a person check (code, CAPTCHA). */
    personTabs: [],
    /** Whether the last job's Submit was pressed, sent or not: the gap after it applies either way. */
    lastSubmitClicked: false,
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
      function reasonOf(row) { return row.needsYouReason || classifyNeedsYouReason(row.reason); }
      const reasonSummary = {};
      for (const row of rows) {
        const r = reasonOf(row);
        reasonSummary[r] = (reasonSummary[r] || 0) + 1;
      }
      const summaryBar = Object.entries(reasonSummary)
        .sort((a, b) => b[1] - a[1])
        .map(([r, n]) => `<span class="ab-need-tag ab-need-tag--${r}">${NEEDS_YOU_REASON_LABELS[r] || r}: ${n}</span>`)
        .join(' ');
      needs.innerHTML = rows.length
        ? `<summary>Needs you (${rows.length})</summary>
          <div class="ab-need-summary">${summaryBar}</div>
          <div class="ab-need-toolbar">
            <button type="button" class="ab-need-btn" data-ab-action="dismiss-all" title="Remove every job from this list">Dismiss all</button>
          </div>${rows
            .slice(0, 20)
            .map(
              (row) => {
              const r = reasonOf(row);
              return `
          <div class="ab-need" data-ab-id="${row.id}">
            <div class="ab-need-main">
              <div class="ab-need-title" title="${escapeHtml(row.jobTitle)}">${escapeHtml(row.company || 'Job')} · ${escapeHtml(row.jobTitle)}</div>
              <div class="ab-need-reason" title="${escapeHtml(row.reason)}"><span class="ab-need-tag ab-need-tag--${r}">${escapeHtml(NEEDS_YOU_REASON_LABELS[r] || '')}</span> ${escapeHtml(row.reason)}</div>
            </div>
            <button type="button" class="ab-need-btn" data-ab-action="open" title="Open the job">Open</button>
            <button type="button" class="ab-need-btn" data-ab-action="retry" title="Give it back to Auto-bid">Retry</button>
            <button type="button" class="ab-need-btn" data-ab-action="dismiss" title="Remove from this list (moves to Finished)">Dismiss</button>
          </div>`; })
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

  /** Lever, Ashby, SmartRecruiters keep the form on its own page: open that page directly. */
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
      // SmartRecruiters: /CompanyName/UUID → /oneclick-ui/company/CompanyName/publication/UUID
      if (host === 'jobs.smartrecruiters.com' && uuidPage.test(path) && !path.includes('/oneclick-ui/')) {
        const parts = path.split('/').filter(Boolean);
        if (parts.length === 2) {
          url.pathname = `/oneclick-ui/company/${parts[0]}/publication/${parts[1]}`;
          url.searchParams.set('oga', 'true');
          return url.toString();
        }
      }
    } catch (_) {
      /* not a URL: opened as it is */
    }
    return link;
  }

  /**
   * Runs in the page's top frame. Clicks a visible "Apply" / "Apply Now"
   * button or link so the application form appears. Returns true when clicked.
   */
  function clickApplyButtonOnPage() {
    const APPLY_RE = /^apply(\s+(now|for this|for this job|here|today))?[.!]?$/i;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    for (const el of document.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="submit"]')) {
      const text = (el.textContent || el.value || '').trim();
      if (!APPLY_RE.test(text) || !visible(el)) continue;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    }
    return false;
  }

  // ───────────────────── Workday page-injected helpers ─────────────────────

  /** Runs in page: detects Workday sign-in/create-account page. */
  function detectWorkdaySignInPage() {
    const signIn = document.querySelector(
      '[data-automation-id="signInLink"], [data-automation-id="createAccountLink"], ' +
      '[data-automation-id="signIn"], [data-automation-id="emailInput"], ' +
      'button[data-automation-id="signInSubmitButton"]'
    );
    const emailInput = document.querySelector(
      'input[data-automation-id="email"], input[data-automation-id="emailInput"], ' +
      'input[data-automation-id="createAccount-email"], input[type="email"]'
    );
    const passwordInput = document.querySelector(
      'input[data-automation-id="password"], input[type="password"]'
    );
    const createLink = document.querySelector('[data-automation-id="createAccountLink"]');
    const applyManually = document.querySelector('[data-automation-id="applyManually"]');
    return {
      isSignIn: Boolean(signIn || (emailInput && !document.querySelector('[data-automation-id="applyFlowPage"]'))),
      hasEmailInput: Boolean(emailInput),
      hasPasswordInput: Boolean(passwordInput),
      hasCreateLink: Boolean(createLink),
      hasApplyManually: Boolean(applyManually),
    };
  }

  /** Runs in page: fills Workday sign-in email and clicks Continue/Create. */
  function fillWorkdaySignIn(email) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    function setVal(el, val) {
      if (setter) setter.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const emailInput = document.querySelector(
      'input[data-automation-id="email"], input[data-automation-id="emailInput"], ' +
      'input[data-automation-id="createAccount-email"], input[type="email"]'
    );
    if (!emailInput) return { filled: false, reason: 'no email field' };
    setVal(emailInput, email);

    const passwordInput = document.querySelector(
      'input[data-automation-id="password"], input[type="password"]'
    );

    const submitBtn = document.querySelector(
      'button[data-automation-id="signInSubmitButton"], ' +
      'button[data-automation-id="createAccountSubmitButton"], ' +
      'button[data-automation-id="utilityButtonContinue"], ' +
      'button[data-automation-id="bottom-navigation-next-button"]'
    ) || [...document.querySelectorAll('button')].find(
      (b) => /sign in|create account|continue|next/i.test(b.textContent || '')
    );
    if (submitBtn) {
      submitBtn.scrollIntoView({ block: 'center' });
      submitBtn.click();
    }
    return { filled: true, hasPassword: Boolean(passwordInput), clickedButton: Boolean(submitBtn) };
  }

  /** Runs in page: clicks "Apply Manually" or "Apply" on Workday posting page. */
  function clickWorkdayApply() {
    const applyManually = document.querySelector('[data-automation-id="applyManually"]');
    if (applyManually) {
      applyManually.scrollIntoView({ block: 'center' });
      applyManually.click();
      return { clicked: true, which: 'applyManually' };
    }
    const applyBtn = document.querySelector(
      'a[data-automation-id="jobPostingApplyButton"], button[data-automation-id="jobPostingApplyButton"], ' +
      'a[data-automation-id="applyButton"], button[data-automation-id="applyButton"]'
    );
    if (applyBtn) {
      applyBtn.scrollIntoView({ block: 'center' });
      applyBtn.click();
      return { clicked: true, which: 'applyButton' };
    }
    return { clicked: false };
  }

  /** Runs in page: detects which Workday wizard page we are on and whether Next/Submit is available. */
  function detectWorkdayWizardState() {
    const progressItems = document.querySelectorAll('[data-automation-id="progressItem"], [data-automation-id="progressBarItem"]');
    const currentStep = [...progressItems].findIndex((el) =>
      el.getAttribute('aria-current') === 'step' || el.classList.contains('css-1dbjc4n') ||
      el.querySelector('[aria-current="step"]')
    );
    const stepLabels = [...progressItems].map((el) => (el.textContent || '').trim());

    const nextBtn = document.querySelector(
      'button[data-automation-id="bottom-navigation-next-button"], ' +
      'button[data-automation-id="nextButton"], ' +
      'button[data-automation-id="continueButton"]'
    ) || [...document.querySelectorAll('button')].find(
      (b) => /^(next|continue|next step|save and continue)$/i.test((b.textContent || '').trim())
    );
    const submitBtn = document.querySelector(
      'button[data-automation-id="bottom-navigation-next-button"][aria-label*="Submit" i], ' +
      'button[data-automation-id="submitButton"]'
    ) || [...document.querySelectorAll('button[data-automation-id="bottom-navigation-next-button"], button')].find(
      (b) => /^submit$/i.test((b.textContent || '').trim())
    );

    const hasFormFields = document.querySelectorAll('[data-automation-id^="formField-"]').length;
    const hasResumeUpload = Boolean(document.querySelector(
      '[data-automation-id="file-upload-drop-zone"], [data-automation-id="resumeUpload"], ' +
      'input[data-automation-id="file-upload-input-ref"]'
    ));
    const hasErrorBanner = Boolean(document.querySelector(
      '[data-automation-id="errorBanner"], [data-automation-id="inlineBanner"], .error-message-container'
    ));
    const errorTexts = [...document.querySelectorAll(
      '[data-automation-id="errorMessage"], [data-automation-id="formField-error"], ' +
      '.css-ferh5a, [role="alert"]'
    )].map((el) => (el.textContent || '').trim()).filter(Boolean);

    const pageTitle = (document.querySelector(
      '[data-automation-id="pageHeaderTitle"], [data-automation-id="stepTitle"], h2'
    ) || {}).textContent || '';

    return {
      currentStep,
      totalSteps: progressItems.length,
      stepLabels,
      pageTitle: pageTitle.trim(),
      hasNextButton: Boolean(nextBtn) && !nextBtn.disabled,
      hasSubmitButton: Boolean(submitBtn),
      hasFormFields,
      hasResumeUpload,
      hasErrorBanner,
      errorTexts,
      isReviewPage: /review/i.test(pageTitle),
    };
  }

  /** Runs in page: clicks Workday Next button. */
  function clickWorkdayNext() {
    const btn = document.querySelector(
      'button[data-automation-id="bottom-navigation-next-button"], ' +
      'button[data-automation-id="nextButton"], ' +
      'button[data-automation-id="continueButton"]'
    ) || [...document.querySelectorAll('button')].find(
      (b) => /^(next|continue|next step|save and continue)$/i.test((b.textContent || '').trim())
    );
    if (!btn || btn.disabled) return { clicked: false, reason: btn ? 'disabled' : 'not found' };
    btn.scrollIntoView({ block: 'center' });
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };
    btn.focus();
    try { btn.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (_) {}
    try { btn.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (_) {}
    try { btn.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (_) {}
    try { btn.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (_) {}
    try { btn.dispatchEvent(new MouseEvent('click', opts)); } catch (_) {}
    return { clicked: true, label: (btn.textContent || '').trim() };
  }

  // clickWorkdaySubmit merged into clickSubmitButton — Workday selectors added there.

  // ───────────── Workday multi-page orchestration (runs in runner) ─────────────

  async function handleWorkdaySignInWall(tabId, job, meta) {
    const [detect] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: detectWorkdaySignInPage,
    });
    const signInState = detect?.result;
    if (!signInState?.isSignIn) return false;

    setStep('Workday sign-in page detected — entering email…');
    meta.workdaySignIn = true;
    const email = currentProfile?.email;
    if (!email) throw new Stop('needs_you', 'No email set in the profile — cannot sign in to Workday.', meta);

    const [fill] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: fillWorkdaySignIn,
      args: [email],
    });
    if (!fill?.result?.filled) {
      throw new Stop('needs_you', 'Could not fill the Workday sign-in form. Sign in manually and re-run.', meta);
    }

    await sleep(3000);

    if (fill.result.hasPassword) {
      throw new Stop('needs_you', 'Workday requires a password (returning applicant). Sign in manually, then re-run.', meta);
    }

    const verifyUntil = Date.now() + VERIFY_CODE_WAIT_MS;
    while (Date.now() < verifyUntil) {
      const href = await frameHref(tabId, 0);
      const [recheck] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: detectWorkdaySignInPage,
      });
      if (!recheck?.result?.isSignIn) return true;

      const [wizard] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: detectWorkdayWizardState,
      });
      if (wizard?.result?.hasFormFields) return true;

      try {
        const { code } = await bid().autobidFetch(
          `/api/autobid/verify-code?profileId=${encodeURIComponent(job.profile_id)}`
        );
        if (code) {
          setStep(`Entering Workday verification code ${code}…`);
          const [entry] = await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            func: enterVerificationCode,
            args: [code],
          });
          if (entry?.result?.entered) {
            meta.workdayCodeEntered = code;
            await sleep(3000);
            return true;
          }
        }
      } catch (_) {}

      await sleep(VERIFY_CODE_POLL_MS);
      checkStop();
    }
    throw new Stop('needs_you', 'Workday sign-in: could not get past the login wall. Sign in manually.', meta);
  }

  async function runWorkdayWizard(tabId, job, meta) {
    meta.workdayPages = [];

    for (let page = 0; page < WORKDAY_MAX_PAGES; page++) {
      checkStop();
      await sleep(2000);

      const [wizard] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: detectWorkdayWizardState,
      });
      const ws = wizard?.result;
      if (!ws) throw new Stop('needs_you', 'Lost contact with the Workday page.', meta);

      meta.workdayPages.push({ page, title: ws.pageTitle, fields: ws.hasFormFields, step: ws.currentStep });
      setStep(`Workday page ${page + 1}: ${ws.pageTitle || 'filling'}…`);

      if (ws.hasErrorBanner && ws.errorTexts.length && page > 0) {
        meta.workdayErrors = ws.errorTexts;
        throw new Stop('needs_you', `Workday rejected a page: ${ws.errorTexts.slice(0, 3).join('; ')}`, meta);
      }

      if (ws.isReviewPage || ws.hasSubmitButton) {
        setStep('Workday review page — submitting…');
        return;
      }

      if (ws.hasFormFields) {
        if (typeof invalidateAiContextCache === 'function') invalidateAiContextCache();
        setAutofillJobAnswers(job.answers || null);
        try { await autofillThisPage({ useAi: true }); } finally { setAutofillJobAnswers(null); }
        checkStop();

        if (ws.hasResumeUpload) {
          meta.workdayResumeUpload = true;
          await sleep(2000);
        }
      }

      if (!ws.hasNextButton && !ws.hasSubmitButton) {
        // Workday pages can render the button late — retry for up to 10 seconds.
        let retryWs = ws;
        const btnUntil = Date.now() + 10_000;
        while (!retryWs.hasNextButton && !retryWs.hasSubmitButton && Date.now() < btnUntil) {
          await sleep(1500);
          const [recheck] = await chrome.scripting.executeScript({
            target: { tabId, frameIds: [0] },
            func: detectWorkdayWizardState,
          });
          if (recheck?.result) retryWs = recheck.result;
        }
        if (retryWs.hasSubmitButton || retryWs.isReviewPage) {
          setStep('Workday review page — submitting…');
          return;
        }
        if (!retryWs.hasNextButton) {
          if (retryWs.hasFormFields) return;
          throw new Stop('needs_you', `Workday page "${ws.pageTitle}" has no Next button. Complete it manually.`, meta);
        }
        // Button appeared after retry — continue to the click below
        ws = retryWs;
      }

      if (ws.hasSubmitButton) return;

      setStep(`Clicking Next on "${ws.pageTitle}"…`);
      const [next] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: clickWorkdayNext,
      });
      if (!next?.result?.clicked) {
        throw new Stop('needs_you', `Could not advance past Workday page "${ws.pageTitle}".`, meta);
      }

      await sleep(WORKDAY_PAGE_WAIT_MS);

      const loadUntil = Date.now() + 15000;
      while (Date.now() < loadUntil) {
        const [check] = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          func: detectWorkdayWizardState,
        });
        if (check?.result?.hasErrorBanner) {
          meta.workdayErrors = check.result.errorTexts;
          setStep('Workday page error — AI-refilling…');
          if (typeof invalidateAiContextCache === 'function') invalidateAiContextCache();
          setAutofillJobAnswers(job.answers || null);
          try { await autofillThisPage({ useAi: true }); } finally { setAutofillJobAnswers(null); }
          await sleep(1000);
          const [retry] = await chrome.scripting.executeScript({
            target: { tabId, frameIds: [0] },
            func: clickWorkdayNext,
          });
          if (!retry?.result?.clicked) {
            throw new Stop('needs_you', `Workday page "${ws.pageTitle}" errors not resolved: ${(check.result.errorTexts || []).slice(0, 3).join('; ')}`, meta);
          }
          await sleep(WORKDAY_PAGE_WAIT_MS);
          break;
        }
        if (check?.result && (check.result.currentStep !== ws.currentStep || check.result.pageTitle !== ws.pageTitle)) {
          break;
        }
        await sleep(1000);
      }
    }

    throw new Stop('needs_you', 'Workday wizard exceeded maximum pages. Complete it manually.', meta);
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

  /**
   * Runs in the form's frame. Clicks the form's own submit button.
   * Uses a full pointer → mouse → click event sequence with coordinates
   * so React/Ashby forms that ignore a bare `.click()` still fire.
   */
  function clickSubmitButton(useFullSequence) {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const label = (el) => String(el.innerText || el.value || el.getAttribute('aria-label') || '').trim();

    function fireClick(el) {
      el.scrollIntoView({ block: 'center' });
      if (useFullSequence) {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };
        el.focus();
        try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (_) {}
        try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (_) {}
        try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (_) {}
        try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (_) {}
        try { el.dispatchEvent(new MouseEvent('click', opts)); } catch (_) {}
        const form = el.closest('form');
        if (form && typeof form.requestSubmit === 'function') {
          try { form.requestSubmit(el); } catch (_) {}
        }
      } else {
        el.click();
      }
    }

    const selectors = [
      '#submit_app',
      'button#btn-submit',
      '[data-qa="btn-submit"]',
      'button.ashby-application-form-submit-button',
      'button[data-automation-id="submitButton"]',
      'button[data-automation="apply-button"]',
      'button[data-automation="submit-application"]',
      'form button[type="submit"]',
      'form input[type="submit"]',
    ];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el) || el.disabled) continue;
        const text = label(el);
        if (text && !/submit|send application/i.test(text)) continue;
        fireClick(el);
        return { clicked: true, label: text || selector };
      }
    }
    for (const el of document.querySelectorAll('button, [role="button"], a.btn, a.button')) {
      const text = label(el);
      if (/^(submit|apply|send)( (your |my )?(application|submission))?$/i.test(text) && visible(el) && !el.disabled) {
        fireClick(el);
        return { clicked: true, label: text };
      }
    }
    // Workday: the wizard's "Next" button on the review page acts as Submit.
    // On some Workday sites the label stays "Next" even on the last page.
    const wdNext = document.querySelector('button[data-automation-id="bottom-navigation-next-button"]');
    if (wdNext && visible(wdNext) && !wdNext.disabled) {
      fireClick(wdNext);
      return { clicked: true, label: label(wdNext) || 'workday-next' };
    }
    return { clicked: false };
  }

  /**
   * Runs in the form's frame. Finds the verification code input, types the
   * code, and clicks the submit/verify button. Returns { entered: true } on
   * success, { entered: false, reason } otherwise.
   */
  function enterVerificationCode(code) {
    const inputs = [...document.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"], input:not([type])')];
    const field = inputs.find((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const label = (el.getAttribute('aria-label') || el.placeholder || el.name || '').toLowerCase();
      return /code|verif|security/i.test(label) || el.maxLength === 8 || el.closest('[class*="verification"], [class*="security"]');
    }) || inputs.find((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !el.value && !el.readOnly && !el.disabled;
    });
    if (!field) return { entered: false, reason: 'no input field found' };
    field.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(field, code);
    else field.value = code;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));

    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const text = (el) => String(el.innerText || el.value || '').trim().toLowerCase();
    for (const btn of document.querySelectorAll('button, input[type="submit"]')) {
      if (!visible(btn) || btn.disabled) continue;
      const t = text(btn);
      if (/submit|verify|confirm|continue/i.test(t)) {
        btn.click();
        return { entered: true };
      }
    }
    for (const btn of document.querySelectorAll('button[type="submit"], form button')) {
      if (visible(btn) && !btn.disabled) {
        btn.click();
        return { entered: true };
      }
    }
    return { entered: true };
  }

  /**
   * Runs in the form's frame. Picks the United States in an empty Greenhouse
   * country react-select, the phone's dialling-code picker first ("United
   * States +1"). Returns { fixed } and a reason when it could not.
   */
  async function fixCountryDropdown() {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const containerOf = (el) => el.closest('.phone-input__country, .select__container, .select-shell') || el.parentElement;
    const picked = (el) => {
      const sv = containerOf(el)?.querySelector('[class*="single-value" i], [class*="singleValue" i]');
      return /united states/i.test(sv?.textContent || '');
    };
    const labelOf = (el) => {
      const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      return [
        el.getAttribute('aria-label') || '',
        ...ids.map((id) => document.getElementById(id)?.textContent || ''),
        ...Array.from(el.labels || []).map((l) => l.textContent || ''),
      ].join(' ');
    };

    // Try native <select> first — some Greenhouse forms use a plain select for country.
    const selects = Array.from(document.querySelectorAll('select'));
    for (const sel of selects) {
      if (sel.disabled || sel.closest('[style*="display:none"], [style*="display: none"]')) continue;
      const lab = labelOf(sel);
      if (!/\bcountry\b/i.test(lab)) continue;
      const opts = Array.from(sel.options);
      const us = opts.find((o) => /^(united states( of america)?|usa|us)$/i.test(o.textContent.trim()));
      if (us && sel.value !== us.value) {
        sel.value = us.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        return { fixed: true };
      }
    }

    const combos = Array.from(document.querySelectorAll('input[role="combobox"]'));
    const input =
      combos.find((el) => el.closest('.phone-input__country, fieldset.phone-input') && !picked(el)) ||
      combos.find((el) => /\bcountry\b/i.test(labelOf(el)) && !picked(el)) ||
      combos.find((el) => {
        const c = containerOf(el);
        const ph = c?.querySelector('[class*="placeholder" i]');
        return ph && /\bcountry\b/i.test(ph.textContent || '') && !picked(el);
      }) ||
      combos.find((el) => {
        const wrapper = el.closest('[class*="field"], [class*="Field"], fieldset, .form-group, [data-field]');
        return wrapper && /\bcountry\b/i.test(wrapper.textContent || '') && !picked(el);
      });
    if (!input) return { fixed: false, reason: 'no empty country picker found' };

    input.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, 'United States');
    else input.value = 'United States';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait for options to appear
    let option = null;
    for (let i = 0; i < 30; i++) {
      await delay(100);
      const opts = document.querySelectorAll('[role="option"]');
      for (const opt of opts) {
        // "United States +1" in the phone picker; never "United States Minor Outlying Islands".
        const t = (opt.textContent || '').replace(/\s*\(?\+?\d+\)?\s*$/, '').trim();
        if (/^(united states( of america)?|usa)$/i.test(t)) {
          option = opt;
          break;
        }
      }
      if (option) break;
    }
    if (!option) return { fixed: false, reason: 'option "United States" not found in dropdown' };

    const evtOpts = { bubbles: true, cancelable: true, button: 0, view: window };
    option.dispatchEvent(new MouseEvent('mousedown', evtOpts));
    option.dispatchEvent(new MouseEvent('mouseup', evtOpts));
    option.click();
    await delay(300);
    if (picked(input)) return { fixed: true };
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    await delay(300);
    return picked(input) ? { fixed: true } : { fixed: false, reason: 'the form did not keep "United States"' };
  }

  /**
   * Runs in the form's frame. Finds and checks the Greenhouse GDPR
   * demographic data consent checkbox.
   */
  function fixGdprConsent() {
    const cbs = document.querySelectorAll('input[type="checkbox"]');
    const tryCheck = (cb) => {
      cb.click();
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      return { fixed: true };
    };
    // Pass 1: checkbox whose name contains gdpr or demographic consent
    for (const cb of cbs) {
      if (cb.checked || cb.disabled) continue;
      const name = cb.getAttribute('name') || cb.id || '';
      if (/gdpr|demographic.?data.?consent/i.test(name)) return tryCheck(cb);
    }
    // Pass 2: wrapper text contains demographic/gdpr AND consent/agree
    for (const cb of cbs) {
      if (cb.checked || cb.disabled) continue;
      const wrapper = cb.closest('[class*="field"], label, fieldset, div');
      const text = (wrapper?.textContent || '').toLowerCase();
      if (/demographic|gdpr/i.test(text) && /consent|agree|accept|acknowledge/i.test(text)) return tryCheck(cb);
    }
    // Pass 3: label or aria-label mentions consent + data/demographic/response
    for (const cb of cbs) {
      if (cb.checked || cb.disabled) continue;
      const label = cb.getAttribute('aria-label') || cb.closest('label')?.textContent || '';
      if (/consent|agree|accept|acknowledge/i.test(label) && /data|demographic|response|information|voluntar/i.test(label)) return tryCheck(cb);
    }
    // Pass 4: any remaining unchecked required checkbox whose ancestor text mentions consent
    for (const cb of cbs) {
      if (cb.checked || cb.disabled) continue;
      if (!cb.required && !cb.getAttribute('aria-required')) continue;
      const section = cb.closest('fieldset, [class*="consent" i], [class*="gdpr" i], [class*="demographic" i]');
      if (section) return tryCheck(cb);
    }
    // Pass 5: toggle switches or buttons for demographic consent (non-checkbox controls)
    for (const el of document.querySelectorAll('[role="switch"], [role="checkbox"], button, [type="button"]')) {
      const name = el.getAttribute('name') || el.id || el.getAttribute('data-field') || '';
      if (/gdpr|demographic.?data.?consent/i.test(name) && el.getAttribute('aria-checked') !== 'true') {
        el.click();
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { fixed: true };
      }
    }
    // Pass 6: any unchecked checkbox whose nearest wrapper mentions terms/consent/agree
    for (const cb of cbs) {
      if (cb.checked || cb.disabled) continue;
      const wrapper = cb.closest('label, li, fieldset, [class*="field" i], div') || document.body;
      const text = (wrapper?.textContent || '').toLowerCase();
      if (/accept.{0,20}terms|accept.*proceed|consent.*demographic|demographic.*consent|agree.*privacy|must.*agree|i (have read|understand|confirm)/i.test(text)) return tryCheck(cb);
    }
    // Pass 7: any unchecked checkbox near an error message (the site rejected and pointed at it)
    for (const cb of cbs) {
      if (cb.checked || cb.disabled) continue;
      const entry = cb.closest('[class*="error" i], [class*="invalid" i], [aria-invalid="true"]')
        || cb.closest('[class*="field" i], li, label');
      if (!entry) continue;
      const hasError = entry.querySelector('[class*="error" i], [role="alert"], .invalid, [aria-invalid="true"]');
      if (hasError) return tryCheck(cb);
    }
    return { fixed: false, reason: 'no GDPR consent checkbox found' };
  }

  /**
   * Runs in the form's frame. Attempts to fill Ashby fields that were reported
   * as missing after submit (location, yes/no, etc.). Returns a summary of
   * what was fixed.
   */
  async function fixAshbyMissingFields(profileCity, requiredOnly = false) {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const NEUTRAL_PRONOUN_RE = /prefer not|decline|rather not|don.t wish/i;
    // Before Submit only required questions are touched: optional ones stay as Autofill left them.
    const wanted = (entry) => {
      if (!requiredOnly) return true;
      if (!entry) return false;
      if (entry.querySelector('[required], [aria-required="true"]')) return true;
      const label = (entry.querySelector('label, [class*="label" i]')?.textContent || '').trim();
      return /\*\s*$/.test(label) || Boolean(entry.querySelector('[class*="required" i]'));
    };
    const fixed = [];

    // Fix unfilled location/city typeahead inputs
    if (profileCity) {
      const entries = document.querySelectorAll('[data-field-path]');
      for (const entry of entries) {
        const path = (entry.getAttribute('data-field-path') || '').toLowerCase();
        const labelEl = entry.querySelector('label, [class*="label" i]');
        const labelText = (labelEl?.textContent || '').toLowerCase();
        const isLocation = /location|city|state|where.*based|reside|work.*from/i.test(path) ||
          /location|city|state|where.*based|reside|work.*from/i.test(labelText);
        if (!isLocation || !wanted(entry)) continue;

        const input = entry.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
        if (!input || !visible(input)) continue;
        const currentVal = (input.value || '').trim();
        if (currentVal && currentVal.length > 2) continue;

        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        const tryTypeahead = async (term) => {
          input.focus();
          if (nativeSetter) nativeSetter.call(input, term);
          else input.value = term;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          for (let i = 0; i < 25; i++) {
            await delay(120);
            const opts = document.querySelectorAll('[role="option"], [role="listbox"] li, [class*="suggestion" i], [class*="option" i]:not(select option)');
            for (const opt of opts) {
              if (!visible(opt)) continue;
              const t = (opt.textContent || '').trim();
              if (!t) continue;
              opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
              opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
              opt.click();
              return true;
            }
          }
          return false;
        };
        // Try full "city, state", then city alone, then "Remote"
        const cityOnly = profileCity.split(',')[0].trim();
        const terms = [profileCity, ...(cityOnly !== profileCity ? [cityOnly] : []), 'Remote'];
        let picked = false;
        for (const term of terms) {
          picked = await tryTypeahead(term);
          if (picked) break;
        }
        if (picked) fixed.push(`location:${labelText.slice(0, 40)}`);
        await delay(200);
      }
    }

    // Fix unfilled yes/no button groups (background check, certify, etc.)
    const yesnoEntries = document.querySelectorAll('[data-field-path]');
    for (const entry of yesnoEntries) {
      const yesno = entry.querySelector('[class*="yesno" i], [class*="_yesno_" i]');
      if (!yesno || !wanted(entry)) continue;
      const buttons = Array.from(entry.querySelectorAll('button')).filter((b) => visible(b) && (b.textContent || '').trim());
      if (!buttons.length) continue;
      const alreadySelected = buttons.some((b) =>
        b.getAttribute('aria-pressed') === 'true' || b.classList.contains('selected') ||
        getComputedStyle(b).backgroundColor !== getComputedStyle(buttons[0]).backgroundColor
      );
      if (alreadySelected) continue;
      const labelText = (entry.querySelector('label, [class*="label" i]')?.textContent || '').toLowerCase();
      const isPositive = /willing|background check|certif|agree|consent|authori[sz]|visa|sponsor|work.*permit|eligible.*work|lawful|confirm/i.test(labelText);
      // A "No" guessed before Submit could be untrue ("Are you located in the US?"): only consent-like Yes.
      if (requiredOnly && !isPositive) continue;
      const target = isPositive
        ? buttons.find((b) => /^yes$/i.test(b.textContent.trim())) || buttons[0]
        : buttons.find((b) => /^no$/i.test(b.textContent.trim())) || buttons[buttons.length - 1];
      if (target) {
        const rect = target.getBoundingClientRect();
        const evtOpts = { bubbles: true, cancelable: true, button: 0, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, view: window };
        target.dispatchEvent(new PointerEvent('pointerdown', evtOpts));
        target.dispatchEvent(new MouseEvent('mousedown', evtOpts));
        target.dispatchEvent(new PointerEvent('pointerup', evtOpts));
        target.dispatchEvent(new MouseEvent('mouseup', evtOpts));
        target.click();
        fixed.push(`yesno:${labelText.slice(0, 40)}`);
        await delay(150);
      }
    }

    // Fix unfilled required select dropdowns (pronouns, etc.)
    const selects = document.querySelectorAll('[data-field-path] select');
    for (const sel of selects) {
      if (sel.disabled || sel.value) continue;
      const entry = sel.closest('[data-field-path]');
      if (!wanted(entry)) continue;
      const labelText = (entry?.querySelector('label, [class*="label" i]')?.textContent || '').toLowerCase();
      // Only pronouns have a neutral answer; any other dropdown would be a guess.
      if (!/pronoun/i.test(labelText)) continue;
      const opts = Array.from(sel.options).filter(o => o.value && o.value !== '');
      const pick = opts.find(o => NEUTRAL_PRONOUN_RE.test(o.text)) || opts.find(o => /they|them/i.test(o.text));
      if (!pick) continue;
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (nativeSetter) nativeSetter.call(sel, pick.value);
      else sel.value = pick.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      fixed.push(`select:${labelText.slice(0, 40)}`);
    }

    // Fix unfilled required custom combobox/dropdown fields (Ashby custom selects)
    const fieldEntries = document.querySelectorAll('[data-field-path]');
    for (const entry of fieldEntries) {
      const combobox = entry.querySelector('[role="combobox"], [role="listbox"]');
      if (!combobox || !wanted(entry)) continue;
      const labelText = (entry.querySelector('label, [class*="label" i]')?.textContent || '').toLowerCase();
      if (!/pronoun/i.test(labelText)) continue;
      if (fixed.some(f => f.includes(labelText.slice(0, 20)))) continue;
      const hasValue = entry.querySelector('[role="option"][aria-selected="true"]') ||
        (combobox.textContent || '').trim().length > 0;
      if (hasValue) continue;
      const trigger = combobox.querySelector('button, [role="button"]') || combobox;
      trigger.click();
      await delay(200);
      const options = Array.from(document.querySelectorAll('[role="option"]'));
      const pick = options.find(o => NEUTRAL_PRONOUN_RE.test(o.textContent || '')) || options.find(o => /they|them/i.test(o.textContent || ''));
      if (pick && visible(pick)) {
        pick.click();
        fixed.push(`combobox:${labelText.slice(0, 40)}`);
      } else {
        trigger.click();
      }
      await delay(150);
    }

    // Fix unfilled consent checkboxes (Socure "Do you consent…", privacy, etc.)
    const CONSENT_LABEL_RE = /consent|agree|acknowledge|certify|authoriz|privacy|terms|background check/i;
    for (const entry of document.querySelectorAll('[data-field-path]')) {
      if (!wanted(entry)) continue;
      const labelText = (entry.querySelector('label, [class*="label" i]')?.textContent || '').toLowerCase();
      if (!CONSENT_LABEL_RE.test(labelText)) continue;
      if (fixed.some(f => f.includes(labelText.slice(0, 20)))) continue;
      const cb = entry.querySelector('input[type="checkbox"]');
      if (cb && !cb.checked && !cb.disabled) {
        cb.click();
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        fixed.push(`consent-cb:${labelText.slice(0, 40)}`);
        await delay(100);
        continue;
      }
      // Radio buttons: pick "Yes" or the affirmative option
      const radios = Array.from(entry.querySelectorAll('input[type="radio"]'));
      if (radios.length && !radios.some(r => r.checked)) {
        const yes = radios.find(r => /^yes$/i.test((r.labels?.[0]?.textContent || r.nextSibling?.textContent || '').trim()));
        const pick = yes || radios[0];
        if (pick) {
          pick.click();
          pick.checked = true;
          pick.dispatchEvent(new Event('change', { bubbles: true }));
          fixed.push(`consent-radio:${labelText.slice(0, 40)}`);
          await delay(100);
        }
      }
    }

    return { fixed: fixed.length > 0, fields: fixed, reason: fixed.length ? undefined : 'no fixable fields found' };
  }

  /**
   * Runs in the form's frame. Checks required consent checkboxes and clicks
   * "Yes" on required Ashby yes/no consent fields (background check, certify,
   * privacy) that Autofill may have missed.
   */
  function fixConsentFields() {
    const CONSENT_RE = /consent|agree|acknowledge|certify|attest|authoriz|background check|privacy|terms|i (have read|understand|confirm)|visa|sponsor|work.*permit|eligible.*work|please confirm/i;
    const fixed = [];
    // 1. Required unchecked checkboxes that look like consent
    for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
      if (cb.checked || cb.disabled) continue;
      if (!cb.matches('[required], [aria-required="true"]')) continue;
      const wrapper = cb.closest('[data-field-path], .ashby-application-form-field-entry, [class*="field"], label, fieldset, li');
      const text = (wrapper?.textContent || cb.getAttribute('aria-label') || '').toLowerCase();
      if (CONSENT_RE.test(text) || text.length < 200) {
        cb.click();
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        fixed.push('checkbox: ' + text.replace(/\s+/g, ' ').trim().slice(0, 60));
      }
    }
    // 1b. Non-required unchecked checkboxes whose label is clearly consent (sites that reject without marking required)
    for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
      if (cb.checked || cb.disabled) continue;
      if (cb.matches('[required], [aria-required="true"]')) continue;
      const wrapper = cb.closest('[data-field-path], .ashby-application-form-field-entry, [class*="field"], label, fieldset, li');
      const text = (wrapper?.textContent || cb.getAttribute('aria-label') || '').toLowerCase();
      if (CONSENT_RE.test(text) && /accept|proceed|submit|continue|agree|i (have read|understand|confirm)/i.test(text)) {
        cb.click();
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        fixed.push('consent-cb: ' + text.replace(/\s+/g, ' ').trim().slice(0, 60));
      }
    }
    // 2. Ashby yes/no button groups where no button is pressed
    for (const entry of document.querySelectorAll('.ashby-application-form-field-entry, [data-field-path]')) {
      const yesno = entry.querySelector('[class*="yesno" i], [class*="_yesno_" i]');
      if (!yesno) continue;
      const buttons = Array.from(entry.querySelectorAll('button')).filter((b) => {
        const t = (b.textContent || '').trim();
        return t && b.offsetWidth > 0 && b.offsetHeight > 0;
      });
      if (!buttons.length) continue;
      const selected = buttons.find((b) =>
        b.getAttribute('aria-pressed') === 'true' || b.classList.contains('selected') ||
        getComputedStyle(b).backgroundColor !== getComputedStyle(buttons.find((x) => x !== b) || b).backgroundColor
      );
      if (selected) continue;
      const label = (entry.querySelector('label, [class*="label" i]')?.textContent || '').trim();
      const yes = buttons.find((b) => /^yes$/i.test((b.textContent || '').trim()));
      if (yes) {
        const rect = yes.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
        yes.dispatchEvent(new PointerEvent('pointerdown', opts));
        yes.dispatchEvent(new MouseEvent('mousedown', opts));
        yes.dispatchEvent(new PointerEvent('pointerup', opts));
        yes.dispatchEvent(new MouseEvent('mouseup', opts));
        yes.dispatchEvent(new MouseEvent('click', opts));
        fixed.push('yes/no: ' + label.slice(0, 60));
      }
    }
    return { fixed };
  }

  const COUNTRY_ERROR_RE = /select a country|country.*required/i;
  const GDPR_ERROR_RE = /gdpr|demographic.*consent|accept.{0,20}terms|consent.{0,20}required|must.{0,20}agree/i;
  const ASHBY_CORRECTIONS_RE = /form needs corrections|missing entry for required field/i;
  const COVER_ERROR_RE = /cover letter.{0,20}(is )?required/i;

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
      if (/^(hidden|file|submit|button)$/i.test(el.type || '')) continue;
      if (el.type === 'checkbox') {
        if (visible(el) && !el.checked) empty.push(labelOf(el));
        continue;
      }
      if (el.type === 'radio') continue;
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
      (frame) => {
        const src = frame.src || '';
        if (!/recaptcha\/(api2|enterprise)\/bframe|hcaptcha\.com\/.*(challenge|hcaptcha)|challenges\.cloudflare\.com/i.test(src)) return false;
        if (visible(frame) && frame.getBoundingClientRect().height > 50) return true;
        // Invisible CAPTCHAs (hCaptcha checkbox-invisible, reCAPTCHA Enterprise) may
        // be 0×0 or hidden. Their presence in the DOM after Submit still means a challenge.
        if (/challenge|bframe/i.test(src)) return true;
        return false;
      }
    );
    const errorEls = [
      ...document.querySelectorAll(
        '[aria-invalid="true"], .field_with_errors, .field-error, .error-message, [class*="error-message"], [class*="errorMessage"], .application-error, .helper-text--error'
      ),
    ];
    // Ashby shows "Your form needs corrections" in a banner with missing-field messages
    const ashbyBanner = document.querySelector('[class*="formCorrections" i], [class*="form-corrections" i], [class*="formError" i]');
    if (ashbyBanner && visible(ashbyBanner)) errorEls.push(ashbyBanner);
    // Fallback: any visible element whose text starts with "Your form needs corrections"
    if (!ashbyBanner) {
      for (const el of document.querySelectorAll('div, section, p, span')) {
        if (/^your form needs corrections/i.test((el.textContent || '').trim()) && visible(el)) {
          errorEls.push(el);
          break;
        }
      }
    }
    const errors = errorEls
      .filter(visible)
      .map((el) => String(el.innerText || el.getAttribute('aria-label') || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim())
      .filter((t) => t && t.length < 500);
    const visibleFields = [...document.querySelectorAll('form input:not([type="hidden"]), form textarea, form select')].filter(visible);
    const formDisabled = visibleFields.length >= 2 && visibleFields.every((el) => el.disabled || el.readOnly);
    return {
      href: location.href,
      lines,
      formPresent: submitButton || fields >= 2,
      formDisabled,
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
        formDisabled: frames.some((f) => f.formDisabled),
        captcha: frames.some((f) => f.captcha),
        errors: frames.flatMap((f) => f.errors || []).slice(0, 6),
      };
    } catch (_) {
      // Navigating after Submit: nothing to read for a moment.
      return { hrefs: [], lines: [], formPresent: false, captcha: false, errors: [], navigating: true };
    }
  }

  const CONFIRM_TEXT_RE =
    /thank(s| you)( so much)? for (applying|your application|submitting|your interest|your submission|taking the time)|application (has been |was )?(successfully )?(submitted|received|sent|complete|recorded)|we('ve| have) received your application|successfully (applied|submitted)|you('ve| have) (successfully )?applied|submission (received|successful|complete)|your (application|submission) (is|has been) (received|submitted|complete|recorded)|we (will|('ll)) (review|be in touch|get back)/i;
  const CONFIRM_PATH_RE = /\/(confirmation|thanks|thankyou|thank-you|thank_you|submitted|success|applied|complete)(\/|$|\?)/i;
  /** A refusal of the whole application (not one field): it was not sent. */
  /**
   * Greenhouse's "A verification code was sent to … enter the 8-character code to
   * confirm you're a human": a person check, so Auto-bid leaves it to the user.
   */
  const VERIFY_CODE_RE =
    /\b(verification code (?:was|has been) sent|enter the \d+-character code|security code)\b/i;

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
    if (VERIFY_CODE_RE.test(text)) return { ...base, verdict: 'verify' };
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
    // Some sites (Workable) hide the form without adding visible text.
    if (before.formPresent && !after.formPresent && sameSite && !(after.errors || []).length && !NOT_CONFIRMATION_RE.test(text)) {
      return { ...base, verdict: 'confirmed', by: 'form_gone' };
    }
    // Workable and similar SPAs disable all fields on submit without removing them.
    if (before.formPresent && after.formPresent && after.formDisabled && sameSite && !NOT_CONFIRMATION_RE.test(text)) {
      return { ...base, verdict: 'confirmed', by: 'form_disabled' };
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

  /**
   * Classify WHY a job landed in needs_you from its error message.
   * Used for notifications, UI grouping, and retry eligibility.
   */
  function classifyNeedsYouReason(detail) {
    const d = String(detail || '').toLowerCase();
    if (/captcha/i.test(d)) return 'captcha';
    if (/verification code|verify your email|enter.*code/i.test(d)) return 'verification';
    if (/in my own words|own words/i.test(d)) return 'own_words';
    if (/not filled|needs your input|not enough facts|missing.*profile|empty on page/i.test(d)) return 'missing_field';
    if (/sign.?in|log.?in|login|password|cannot sign|sign in manually/i.test(d)) return 'login_wall';
    if (/no application form|needs? a login|apply click/i.test(d)) return 'login_wall';
    if (/no submit button|auto-submit does not cover|submit it by hand|dry run/i.test(d)) return 'manual_submit';
    if (/refused.*spam|possible spam|not (?:a )?bot|real human/i.test(d)) return 'spam_block';
    if (/error|rejected|could not advance|errors not resolved/i.test(d)) return 'form_error';
    if (/workday/i.test(d)) return 'form_error';
    return 'other';
  }

  const NEEDS_YOU_REASON_LABELS = {
    captcha: 'CAPTCHA',
    verification: 'Verification code',
    own_words: 'Needs your own words',
    missing_field: 'Missing field answer',
    login_wall: 'Needs login',
    manual_submit: 'Submit manually',
    spam_block: 'Spam detection',
    form_error: 'Form error',
    other: 'Other',
  };

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

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('Could not read the file.'));
      reader.readAsDataURL(blob);
    });
  }

  /** Writes a cover letter for this job, attaches it to the plan row and fills that one field. */
  async function fillGeneratedCoverLetter(row, job) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) throw new Error('no OpenAI key');
    const candidateName = String(currentProfile?.fullName || job.candidate_name || '').trim();
    const body = await window.SmartJobAiFill.writeCoverLetter(apiKey, currentSettings.openaiModel, await getAiContextBlock(), {
      company: job.company,
      jobTitle: job.job_title,
      candidateName,
      baseUrl: getOpenAiBaseUrl(),
    });
    const blob = window.SmartJobCoverLetterDocx.buildCoverLetterDocx({ candidateName, company: job.company, body });
    const name = `${(candidateName || 'Candidate').replace(/[^\w.-]+/g, '_')}_Cover_Letter.docx`;
    row.uploadFile = { name, type: blob.type, size: blob.size, dataUrl: await blobToDataUrl(blob) };
    row.suggestedValue = name;
    row.source = 'kit';
    row.status = `Ready — Cover letter: ${name} (written for this job)`;
    // Staged like a file attached on the Bid tab, so a second Autofill pass uses it too.
    const jobKey = getRegisterFieldValue('regJobLink');
    stagedJobUploads = {
      jobKey,
      resume: stagedJobUploads.jobKey === jobKey ? stagedJobUploads.resume : null,
      coverLetter: row.uploadFile,
    };
    await chrome.storage.local.set({ [JOB_UPLOAD_FILES_KEY]: stagedJobUploads });
    const { response } = await sendToFormFrame({
      action: 'fillApplicationFields',
      fields: [{ ...buildFillPayloadFromRow(row), uploadFile: row.uploadFile }],
      thresholds: {
        selectMatchThreshold: currentSettings.selectMatchThreshold ?? defaultSettings.selectMatchThreshold,
        radioMatchThreshold: currentSettings.radioMatchThreshold ?? defaultSettings.radioMatchThreshold,
      },
    });
    const result = (response?.results || [])[0] || { success: false, error: response?.error || 'No result returned.' };
    applyFillResultToPlanRow(row, result);
  }

  async function applyToJob(job, windowId) {
    const meta = { method: state.prefs.submit ? 'auto' : 'dry_run', startedAt: new Date().toISOString(), lastRunVersion: chrome.runtime?.getManifest?.().version || '' };
    let tabId = null;
    let submitClicked = false;
    try {
      if (!job.built_resume_json) throw new Stop('failed', 'No generated resume JSON.');
      if (/\bExtracted Company\b|\[JD[\s\w]*\]/i.test(job.built_resume_json)) {
        throw new Stop('failed', 'The generated resume JSON contains placeholder text (Extracted Company / [JD …]). Re-queue this job for regeneration.');
      }
      const profileSelect = document.getElementById('regProfileId');
      if (![...(profileSelect?.options || [])].some((o) => o.value === String(job.profile_id))) {
        throw new Stop('pause', `Profile #${job.profile_id} is not in the Bid tab's list. Sign in as the same user, then turn Auto-bid on again.`);
      }

      setStep('Opening the application form…');
      const url = applicationFormUrl(job.job_link);
      try {
        const jobHost = new URL(url).hostname.toLowerCase();
        if (!SUBMIT_HOST_RE.test(jobHost)) {
          throw new Stop('failed', `Filled. Auto-submit does not cover ${jobHost}. It should not have been queued.`);
        }
      } catch (e) {
        if (e instanceof Stop) throw e;
      }
      const tab = await chrome.tabs.create({ url, active: true, windowId });
      tabId = tab.id;
      meta.openedUrl = url;
      await bid().waitForTabLoaded(tabId, PAGE_LOAD_MS);
      await waitForPanelBind(tabId);
      checkStop();

      // ──────────── Workday: multi-page wizard with sign-in ────────────
      const isWorkdayJob = WORKDAY_HOST_RE.test(hostOf(url));
      if (isWorkdayJob) {
        setStep('Workday detected — preparing…');
        meta.workday = true;

        setStep('Applying the generated resume…');
        profileSelect.value = String(job.profile_id);
        profileSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(1000);
        bid().setRegisterFieldValue('regJobLink', job.job_link, 'autobid');
        bid().setRegisterFieldValue('regJobTitle', job.job_title, 'autobid');
        bid().setRegisterFieldValue('regCompany', job.company, 'autobid');
        bid().setRegisterFieldValue('regNote', job.job_description, 'autobid');
        let pretty = job.built_resume_json;
        try { pretty = JSON.stringify(JSON.parse(job.built_resume_json), null, 2); } catch (_) {}
        const jsonBox = document.getElementById('regResumeJson');
        if (jsonBox) jsonBox.value = pretty;
        const applied = bid().applyResumeJsonToRegisterForm(pretty, { silent: true });
        if (!applied?.ok) throw new Stop('failed', `The generated resume JSON was not accepted: ${applied?.error || 'invalid'}.`);

        setStep('Generating Word files (json2docx)…');
        const health = await json2docxHealth();
        if (health && !health.ok) {
          throw new Stop('pause', `json2docx is ${health.error === 'disabled' ? 'disabled in Settings' : 'offline'}: start it on this machine (start_server.bat).`);
        }
        await bid().generateFilesFromResumeJson(null);
        checkStop();

        if (!(typeof isAiModeEnabled === 'function' && isAiModeEnabled())) {
          throw new Stop('pause', 'AI answers are off: turn on Settings → Autofill with AI, with an OpenAI key.');
        }

        // Click Apply on the posting page first.
        try {
          const [applyClick] = await chrome.scripting.executeScript({
            target: { tabId, frameIds: [0] },
            func: clickWorkdayApply,
          });
          if (applyClick?.result?.clicked) {
            meta.workdayApplyClicked = applyClick.result.which;
            await sleep(4000);
            await bid().waitForTabLoaded(tabId, PAGE_LOAD_MS);
          }
        } catch (_) {}
        checkStop();

        // Handle sign-in/account-creation wall.
        await handleWorkdaySignInWall(tabId, job, meta);
        checkStop();

        // Navigate the multi-page wizard: fill each page, click Next.
        await runWorkdayWizard(tabId, job, meta);
        checkStop();

        // At this point we are on the review or final page — fall through to submit.
        meta.fieldReport = fieldReport();
        meta.fields = currentPlan.length;
        meta.filled = currentPlan.filter((row) => row.fillOutcome === 'filled').length;
        meta.aiAnswers = currentPlan.filter((row) => row.source === 'ai' && row.fillOutcome === 'filled').length;
      }

      // ──────────── Standard (non-Workday) flow ────────────
      if (!isWorkdayJob) {
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

      // Fields the form shows only after an answer (Lever's disability
      // signature, Greenhouse's race question): scanned and filled in a second pass.
      if (currentFields.length && typeof fillFieldsShownAfterFill === 'function') {
        const shown = await fillFieldsShownAfterFill();
        if (shown) meta.shownAfterFill = shown;
        checkStop();
      }
      let formFound = typeof scanFoundApplicationForm === 'function' ? scanFoundApplicationForm() : currentFields.length > 0;
      if (!formFound) {
        // Many sites show an "Apply" button before the form. SmartRecruiters
        // navigates to a oneclick-ui page; others overlay it in place.
        try {
          const [clicked] = await chrome.scripting.executeScript({
            target: { tabId, frameIds: [0] },
            func: clickApplyButtonOnPage,
          });
          if (clicked?.result) {
            setStep('Clicked Apply — waiting for the form…');
            await sleep(1500);
            await bid().waitForTabLoaded(tabId, PAGE_LOAD_MS);
            await waitForPanelBind(tabId);
            await sleep(2000);
            await autofillThisPage({ useAi: true });
            formFound = typeof scanFoundApplicationForm === 'function' ? scanFoundApplicationForm() : currentFields.length > 0;
          }
        } catch (_) {}
      }
      if (!formFound) {
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
      // A required cover letter the kit did not provide: written from the resume and posting, uploaded as .docx.
      const coverRow = currentPlan.find(
        (row) => row.field?.fieldCategory === 'cover_letter_upload' && row.field?.required && row.fillOutcome !== 'filled'
      );
      if (coverRow) {
        setStep('Writing a cover letter…');
        try {
          await fillGeneratedCoverLetter(coverRow, job);
          meta.coverLetter = coverRow.fillOutcome === 'filled' ? 'generated' : `generated, upload failed: ${coverRow.fillError || 'unknown'}`;
        } catch (error) {
          meta.coverLetter = `could not write: ${error?.message || error}`;
        }
        meta.fieldReport = fieldReport();
        checkStop();
      }
      // Check consent checkboxes and Ashby yes/no that Autofill may have missed.
      try {
        const [consent] = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [autofillFrameId || 0] },
          func: fixConsentFields,
        });
        if (consent?.result?.fixed?.length) meta.consentFixed = consent.result.fixed;
      } catch (_) {}

      // Ashby only complains after Submit ("Your form needs corrections"): its
      // location typeahead, consent yes/no and pronoun pickers are completed first.
      const preHost = hostOf((await frameHref(tabId, autofillFrameId)) || url);
      if (/(^|\.)ashbyhq\.com$/i.test(preHost)) {
        try {
          const profileCity = [currentProfile?.city, currentProfile?.state].filter(Boolean).join(', ');
          const [pre] = await chrome.scripting.executeScript({
            target: { tabId, frameIds: [autofillFrameId || 0] },
            func: fixAshbyMissingFields,
            args: [profileCity, true],
          });
          if (pre?.result?.fixed) meta.ashbyPreFix = pre.result.fields;
        } catch (_) {}
      }
      if (/(^|\.)(greenhouse\.io)$/i.test(preHost)) {
        try {
          const [fix] = await chrome.scripting.executeScript({
            target: { tabId, frameIds: [autofillFrameId || 0] },
            func: fixCountryDropdown,
          });
          if (fix?.result?.fixed) meta.countryPreFix = true;
        } catch (_) {}
      }

      let open = currentPlan.filter((row) => row.field?.required && row.fillOutcome !== 'filled');
      if (open.length && meta.ashbyPreFix?.length) {
        const fixedLabels = meta.ashbyPreFix.map((f) => f.split(':').slice(1).join(':').trim().slice(0, 20)).filter(Boolean);
        open = open.filter((row) => !fixedLabels.some((label) => rowLabel(row).toLowerCase().startsWith(label)));
      }
      meta.fields = currentPlan.length;
      meta.filled = currentPlan.filter((row) => row.fillOutcome === 'filled').length;
      meta.aiAnswers = currentPlan.filter((row) => row.source === 'ai' && row.fillOutcome === 'filled').length;
      const notFilled = (labels) =>
        `Required ${labels.length === 1 ? 'field' : 'fields'} not filled: ${labels.slice(0, 5).join('; ')}${labels.length > 5 ? '…' : ''}`;
      let emptyOnPage = [];
      if (!open.length) {
        await sleep(1000);
        emptyOnPage = await emptyRequiredOnPage(tabId);
      }
      if ((open.length || emptyOnPage.length) && !meta.preSubmitAiRetried) {
        meta.preSubmitAiRetried = true;
        setStep('AI-filling remaining required fields…');
        try {
          if (typeof invalidateAiContextCache === 'function') invalidateAiContextCache();
          setAutofillJobAnswers(job.answers || null);
          try { await autofillThisPage({ useAi: true }); } finally { setAutofillJobAnswers(null); }
        } catch (_) {}
        open = currentPlan.filter((row) => row.field?.required && row.fillOutcome !== 'filled');
        if (open.length && meta.ashbyPreFix?.length) {
          const fixedLabels = meta.ashbyPreFix.map((f) => f.split(':').slice(1).join(':').trim().slice(0, 20)).filter(Boolean);
          open = open.filter((row) => !fixedLabels.some((label) => rowLabel(row).toLowerCase().startsWith(label)));
        }
        meta.filled = currentPlan.filter((row) => row.fillOutcome === 'filled').length;
        meta.aiAnswers = currentPlan.filter((row) => row.source === 'ai' && row.fillOutcome === 'filled').length;
        emptyOnPage = [];
        if (!open.length) {
          await sleep(1000);
          emptyOnPage = await emptyRequiredOnPage(tabId);
        }
      }
      if (open.length) {
        meta.openFields = open.map(rowLabel);
        throw new Stop('needs_you', notFilled(meta.openFields), meta);
      }
      if (emptyOnPage.length) {
        meta.openFields = emptyOnPage;
        markEmptyOnPage(meta.fieldReport, emptyOnPage);
        throw new Stop('needs_you', notFilled(emptyOnPage), meta);
      }

      } // end if (!isWorkdayJob)

      const formHref = (await frameHref(tabId, autofillFrameId)) || url;
      meta.formHost = hostOf(formHref);
      if (!SUBMIT_HOST_RE.test(meta.formHost)) {
        throw new Stop(
          'needs_you',
          `Filled. Auto-submit does not cover ${meta.formHost || 'another site'}. Review it, submit, then Register.`,
          meta
        );
      }
      if (!state.prefs.submit) {
        throw new Stop('needs_you', 'Dry run: filled and checked, not submitted. Review the tab, submit, then Register.', meta);
      }
      checkStop();

      const useFullSequence = FULL_CLICK_HOST_RE.test(meta.formHost);
      // reCAPTCHA Enterprise scores session timing: pause before Submit to look human.
      // Ashby's threshold is very aggressive — extend the session lifetime so the
      // total time on page exceeds ~25s, which is typical for a real applicant.
      if (/ashbyhq\.com$/i.test(meta.formHost || '')) {
        const pauseMs = 12000 + Math.random() * 10000;
        setStep(`Pausing ${(pauseMs / 1000).toFixed(0)}s before Submit…`);
        await sleep(pauseMs);
        checkStop();
      } else if (/lever\.co$/i.test(meta.formHost || '')) {
        const pauseMs = 3000 + Math.random() * 5000;
        setStep(`Pausing ${(pauseMs / 1000).toFixed(0)}s before Submit…`);
        await sleep(pauseMs);
        checkStop();
      }
      setStep('Submitting…');
      const registerDraft = bid().snapshotRegisterDraft();
      const before = await probeOutcome(tabId);
      if (before.navigating || !before.formPresent) {
        // Nothing to compare the page with after Submit: not pressed.
        throw new Stop('needs_you', 'Filled, but the form could not be read just before Submit. Review the tab and submit it by hand.', meta);
      }
      // Recorded on the server before the click: a runner lost right after it must never re-apply.
      await state.stepPost
        .then(() =>
          bid().autobidFetch(`/api/autobid/${job.id}/step`, {
            method: 'POST',
            body: { claimedAt: job.claimed_at, submitClicked: true },
          })
        )
        .catch((error) => logLine(`Could not record the Submit on the server first: ${error?.message || error}`));
      const [click] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [autofillFrameId || 0] },
        func: clickSubmitButton,
        args: [useFullSequence],
      });
      if (!click?.result?.clicked) {
        await bid()
          .autobidFetch(`/api/autobid/${job.id}/step`, {
            method: 'POST',
            body: { claimedAt: job.claimed_at, submitClicked: false },
          })
          .catch(() => {});
        throw new Stop('needs_you', 'Filled, but no Submit button was found. Submit it by hand.', meta);
      }
      submitClicked = true;
      meta.submitClicked = true;
      meta.submitLabel = click.result.label;

      setStep('Waiting for the confirmation…');
      let until = Date.now() + CONFIRM_WAIT_MS;
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
        if (judged.verdict === 'verify') {
          setStep('Verification code requested — checking mailbox…');
          meta.verifyCodeRequested = true;
          let codeEntered = false;
          const codeUntil = Date.now() + VERIFY_CODE_WAIT_MS;
          while (Date.now() < codeUntil) {
            await sleep(VERIFY_CODE_POLL_MS);
            checkStop();
            try {
              const { code } = await bid().autobidFetch(
                `/api/autobid/verify-code?profileId=${encodeURIComponent(job.profile_id)}`
              );
              if (!code) continue;
              setStep(`Entering verification code ${code}…`);
              const [entry] = await chrome.scripting.executeScript({
                target: { tabId, allFrames: true },
                func: enterVerificationCode,
                args: [code],
              });
              if (entry?.result?.entered) {
                meta.verifyCodeEntered = code;
                codeEntered = true;
                break;
              }
              logLine(`#${job.id}: code ${code} fetched but could not be entered: ${entry?.result?.reason || 'unknown'}.`);
              break;
            } catch (fetchError) {
              // API unreachable or no mailbox connected: fall through to manual.
              if (Date.now() + VERIFY_CODE_POLL_MS >= codeUntil) break;
            }
          }
          if (!codeEntered) {
            toast(`${job.company}: enter the emailed verification code in its tab to finish the application.`, 'error');
            throw new Stop(
              'needs_you',
              `Not sent yet: the site emailed a verification code. Auto-entry did not find it in the mailbox.${shown}`,
              meta
            );
          }
          // Code entered — wait for the confirmation like a normal Submit.
          setStep('Code entered — waiting for confirmation…');
          const codeConfirmUntil = Date.now() + CONFIRM_WAIT_MS;
          let codeJudged = null;
          let codeConfirmPolls = 0;
          while (Date.now() < codeConfirmUntil) {
            await sleep(CONFIRM_POLL_MS);
            const outcome = await probeOutcome(tabId);
            codeJudged = judgeAfterSubmit(before, outcome);
            if (codeJudged.verdict === 'confirmed') {
              codeConfirmPolls = codeJudged.by === 'form_replaced' ? codeConfirmPolls + 1 : 2;
              if (codeConfirmPolls >= 2) break;
              continue;
            }
            codeConfirmPolls = 0;
            if (codeJudged.verdict === 'verify') continue;
          }
          if (codeJudged?.verdict === 'confirmed' && codeConfirmPolls >= 2) {
            judged = codeJudged;
            confirmPolls = codeConfirmPolls;
            break;
          }
          toast(`${job.company}: code entered but confirmation not seen. Check the tab.`, 'warn');
          throw new Stop(
            'needs_you',
            `Verification code entered but the application was not confirmed. Check the tab.`,
            meta
          );
        }
        if (judged.verdict === 'captcha') {
          notify('captcha', `CAPTCHA: ${job.company}`, `Solve the CAPTCHA in the open tab to finish applying to ${job.job_title}.`);
          throw new Stop('needs_you', 'A CAPTCHA appeared after Submit. Solve it in the tab, submit, then Register.', meta);
        }
        if (judged.verdict === 'failed') {
          throw new Stop('needs_you', `The site showed an error after Submit, so it was most likely not sent.${shown}`, meta);
        }
        // Detect errors from standard error elements OR from Ashby “form needs corrections” in new text
        const hasStdErrors = judged.verdict === 'errors';
        const ashbyCorrections = !hasStdErrors && ASHBY_CORRECTIONS_RE.test(judged.newText || '');
        if (ashbyCorrections) errorPolls = 2;
        else errorPolls = hasStdErrors ? errorPolls + 1 : 0;
        if (errorPolls >= 2) {
          const errorText = [...judged.errors, judged.newText || ''].join(' ');
          const isCountry = COUNTRY_ERROR_RE.test(errorText);
          const isGdpr = GDPR_ERROR_RE.test(errorText);
          const isAshby = ashbyCorrections || ASHBY_CORRECTIONS_RE.test(errorText);
          const coverRow = COVER_ERROR_RE.test(errorText)
            ? currentPlan.find((row) => row.field?.fieldCategory === 'cover_letter_upload')
            : null;
          if ((isCountry || isGdpr || isAshby || coverRow) && !meta.formRetried) {
            meta.formRetried = true;
            setStep('Fixing rejected field and resubmitting…');
            try {
              if (isCountry) {
                const [fix] = await chrome.scripting.executeScript({
                  target: { tabId, frameIds: [autofillFrameId || 0] },
                  func: fixCountryDropdown,
                });
                meta.countryRetry = fix?.result || {};
              }
              if (isGdpr) {
                const [fix] = await chrome.scripting.executeScript({
                  target: { tabId, frameIds: [autofillFrameId || 0] },
                  func: fixGdprConsent,
                });
                meta.gdprRetry = fix?.result || {};
              }
              if (isAshby) {
                const profileCity = [
                  currentProfile?.city,
                  currentProfile?.state,
                ].filter(Boolean).join(', ') || '';
                const [fix] = await chrome.scripting.executeScript({
                  target: { tabId, frameIds: [autofillFrameId || 0] },
                  func: fixAshbyMissingFields,
                  args: [profileCity],
                });
                meta.ashbyRetry = fix?.result || {};
                // Mechanical fixer couldn't help: re-run AI-fill on the unfilled fields.
                if (!meta.ashbyRetry?.fixed && !meta.ashbyAiFilled) {
                  meta.ashbyAiFilled = true;
                  try {
                    setStep('AI-filling missing Ashby fields…');
                    if (typeof invalidateAiContextCache === 'function') invalidateAiContextCache();
                    setAutofillJobAnswers(job.answers || null);
                    try { await autofillThisPage({ useAi: true }); } finally { setAutofillJobAnswers(null); }
                    meta.ashbyRetry = { ...meta.ashbyRetry, aiFilled: true };
                  } catch (aiErr) {
                    meta.ashbyRetry = { ...meta.ashbyRetry, aiFilled: false, aiError: String(aiErr?.message || aiErr).slice(0, 120) };
                  }
                }
              }
              if (coverRow) {
                try {
                  await fillGeneratedCoverLetter(coverRow, job);
                  meta.coverRetry = coverRow.fillOutcome === 'filled'
                    ? { fixed: true }
                    : { fixed: false, reason: `cover letter upload failed: ${coverRow.fillError || 'unknown'}` };
                } catch (error) {
                  meta.coverRetry = { fixed: false, reason: `cover letter not written: ${error?.message || error}` };
                }
              }
              if (meta.countryRetry?.fixed || meta.gdprRetry?.fixed || meta.ashbyRetry?.fixed || meta.ashbyRetry?.aiFilled || meta.coverRetry?.fixed) {
                await sleep(500);
                const [reclick] = await chrome.scripting.executeScript({
                  target: { tabId, frameIds: [autofillFrameId || 0] },
                  func: clickSubmitButton,
                  args: [useFullSequence],
                });
                if (reclick?.result?.clicked) {
                  errorPolls = 0;
                  until = Date.now() + CONFIRM_WAIT_MS;
                  setStep('Resubmitted — waiting for confirmation…');
                  continue;
                }
              }
            } catch (_) {}
          }
          meta.pageErrors = judged.errors.length ? judged.errors : [judged.newText?.slice(0, 200) || 'form errors'];
          const retryNote = [meta.countryRetry?.reason, meta.gdprRetry?.reason, meta.ashbyRetry?.reason, meta.coverRetry?.reason].filter(Boolean).join('; ');
          throw new Stop(
            'needs_you',
            `The site rejected the form: ${(meta.pageErrors).slice(0, 3).join('; ')}${retryNote ? ` (auto-fix: ${retryNote})` : ''}`,
            meta
          );
        }
      }
      if (judged?.verdict !== 'confirmed' || confirmPolls < 2) {
        const ashbyNoResponse = /(^|\.)ashbyhq\.com$/i.test(meta.formHost) && !judged?.newText;
        if (!meta.formRetried && (ASHBY_CORRECTIONS_RE.test(judged?.newText || '') || ashbyNoResponse)) {
          meta.formRetried = true;
          setStep(ashbyNoResponse ? 'Ashby did not respond — retrying with AI fill…' : 'Fixing Ashby corrections and resubmitting…');
          try {
            const profileCity = [currentProfile?.city, currentProfile?.state].filter(Boolean).join(', ') || '';
            const [fix] = await chrome.scripting.executeScript({
              target: { tabId, frameIds: [autofillFrameId || 0] },
              func: fixAshbyMissingFields,
              args: [profileCity],
            });
            meta.ashbyRetry = fix?.result || {};
            // Mechanical fixer couldn't help: re-run AI-fill on the unfilled fields.
            if (!meta.ashbyRetry?.fixed && !meta.ashbyAiFilled) {
              meta.ashbyAiFilled = true;
              try {
                setStep('AI-filling missing Ashby fields…');
                if (typeof invalidateAiContextCache === 'function') invalidateAiContextCache();
                setAutofillJobAnswers(job.answers || null);
                try { await autofillThisPage({ useAi: true }); } finally { setAutofillJobAnswers(null); }
                meta.ashbyRetry = { ...meta.ashbyRetry, aiFilled: true };
              } catch (aiErr) {
                meta.ashbyRetry = { ...meta.ashbyRetry, aiFilled: false, aiError: String(aiErr?.message || aiErr).slice(0, 120) };
              }
            }
            if (meta.ashbyRetry?.fixed || meta.ashbyRetry?.aiFilled) {
              await sleep(500);
              const [reclick] = await chrome.scripting.executeScript({
                target: { tabId, frameIds: [autofillFrameId || 0] },
                func: clickSubmitButton,
                args: [useFullSequence],
              });
              if (reclick?.result?.clicked) {
                setStep('Resubmitted — waiting for confirmation…');
                const resubUntil = Date.now() + CONFIRM_WAIT_MS;
                while (Date.now() < resubUntil) {
                  await sleep(CONFIRM_POLL_MS);
                  const outcome = await probeOutcome(tabId);
                  judged = judgeAfterSubmit(before, outcome);
                  if (!outcome.navigating) meta.afterSubmit = { hrefs: outcome.hrefs, newText: judged.newText, formPresent: outcome.formPresent };
                  if (judged.verdict === 'confirmed') {
                    confirmPolls = judged.by === 'form_replaced' ? confirmPolls + 1 : 2;
                    if (confirmPolls >= 2) break;
                    continue;
                  }
                  confirmPolls = 0;
                }
              }
            }
          } catch (_) {}
        }
      }
      if (judged?.verdict !== 'confirmed' || confirmPolls < 2) {
        const shown = judged?.newText
          ? `The page shows: “${judged.newText.slice(0, 200)}”.`
          : 'Nothing new appeared on the page.';
        const retryNote = meta.ashbyRetry?.reason ? ` (auto-fix: ${meta.ashbyRetry.reason})` : '';
        throw new Stop(
          'needs_you',
          `Submit was clicked but no confirmation was recognised. ${shown}${retryNote} Check the tab before doing anything else.`,
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
        await bid().registerForAutobid(registerDraft);
        logLine(`Sent and registered: ${job.company} · ${job.job_title} (#${job.id}).`);
      } catch (error) {
        logLine(`Sent #${job.id}, but Register failed: ${error?.message || error}. Register it from Resume DB / the Bid tab.`);
      }
      await chrome.tabs.remove(tabId).catch(() => {});
      state.lastSubmitClicked = true;
      return 'submitted';
    } catch (error) {
      state.lastSubmitClicked = submitClicked;
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
          await finish(job, 'needs_you', `Stopped after Submit was clicked: ${detail}`, { ...meta, submitClicked: true, needsYouReason: 'manual_submit' });
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
      const needsYouReason = stop.outcome === 'needs_you' ? classifyNeedsYouReason(detail) : undefined;
      await finish(job, stop.outcome, detail, { ...meta, ...stop.meta, submitClicked: submitClicked || undefined, needsYouReason });
      logLine(`Needs you — ${job.company} · ${job.job_title} (#${job.id}): [${NEEDS_YOU_REASON_LABELS[needsYouReason] || stop.outcome}] ${detail}`);
      // Left open for the user (a failed one too: it shows what happened).
      const watchableReasons = new Set(['captcha', 'verification', 'manual_submit', 'missing_field', 'login_wall', 'own_words']);
      const isPerson = PERSON_CHECK_RE.test(detail) || watchableReasons.has(needsYouReason);
      if (tabId) keepTabOpen(tabId, isPerson);
      if (tabId && isPerson && stop.outcome === 'needs_you') {
        const before = await probeOutcome(tabId).catch(() => ({ hrefs: [], lines: [], formPresent: false, captcha: false, errors: [] }));
        watchTab(tabId, job, before);
      }
      return stop.outcome;
    }
  }

  /** A stop the user finishes in the tab: a code, a CAPTCHA, or an unsupported host where Submit is manual. */
  const PERSON_CHECK_RE = /verification code|CAPTCHA|Auto-submit covers/i;

  /**
   * Running all day, stopped jobs would fill the window: only the newest few
   * stay open. Tabs waiting for a person check are kept apart and longer: the
   * code or CAPTCHA can only be finished there.
   */
  function keepTabOpen(tabId, person = false) {
    const list = person ? 'personTabs' : 'tabsLeftOpen';
    const other = person ? 'tabsLeftOpen' : 'personTabs';
    state[other] = state[other].filter((id) => id !== tabId);
    state[list] = [...state[list].filter((id) => id !== tabId), tabId];
    const limit = person ? MAX_PERSON_TABS_OPEN : MAX_TABS_LEFT_OPEN;
    while (state[list].length > limit) {
      chrome.tabs.remove(state[list].shift()).catch(() => {});
    }
  }

  // ───────────────────── Tab watcher (auto-resume) ─────────────────────
  //
  // Person-check tabs (CAPTCHA, verification code) are polled
  // in the background. When the user completes the action and the page shows
  // a confirmation, the watcher promotes the job from needs_you → submitted
  // via the /confirm API, then registers it in Resume DB and closes the tab.

  const TAB_WATCH_POLL_MS = 10_000;
  const TAB_WATCH_TIMEOUT_MS = 30 * 60_000;
  const watchedTabs = new Map();
  let tabWatchTimer = null;

  function watchTab(tabId, job, before) {
    // The Bid form holds this job now; by the time the user acts it may hold
    // the next one, so Register later works from this copy.
    let draft = null;
    try {
      draft = bid().snapshotRegisterDraft();
    } catch (_) {
      /* no snapshot: Register is skipped with a note */
    }
    watchedTabs.set(tabId, {
      job,
      before,
      draft,
      startedAt: Date.now(),
      confirmPolls: 0,
    });
    if (!tabWatchTimer) {
      tabWatchTimer = setInterval(() => void tabWatchTick(), TAB_WATCH_POLL_MS);
    }
  }

  let tabWatchTicking = false;

  async function tabWatchTick() {
    if (tabWatchTicking) return;
    if (!watchedTabs.size) {
      clearInterval(tabWatchTimer);
      tabWatchTimer = null;
      return;
    }
    tabWatchTicking = true;
    try {
      await tabWatchPass();
    } finally {
      tabWatchTicking = false;
    }
  }

  async function tabWatchPass() {
    for (const [tabId, ctx] of watchedTabs) {
      if (Date.now() - ctx.startedAt > TAB_WATCH_TIMEOUT_MS) {
        watchedTabs.delete(tabId);
        logLine(`Tab watcher: timed out on #${ctx.job.id} (${ctx.job.company}).`);
        continue;
      }
      try {
        await chrome.tabs.get(tabId);
      } catch (_) {
        watchedTabs.delete(tabId);
        continue;
      }
      try {
        const outcome = await probeOutcome(tabId);
        const judged = judgeAfterSubmit(ctx.before, outcome);
        if (judged.verdict === 'confirmed') {
          ctx.confirmPolls = judged.by === 'form_replaced' ? ctx.confirmPolls + 1 : 2;
          if (ctx.confirmPolls < 2) continue;
          watchedTabs.delete(tabId);
          state.personTabs = state.personTabs.filter((id) => id !== tabId);
          try {
            await bid().autobidFetch(`/api/autobid/${ctx.job.id}/confirm`, {
              method: 'POST',
              body: { confirmedBy: judged.by, confirmText: judged.newText },
            });
            logLine(`Tab watcher: confirmed #${ctx.job.id} (${ctx.job.company}) — ${judged.by}.`);
            toast(`${ctx.job.company}: application confirmed after your action.`, 'success');
          } catch (e) {
            logLine(`Tab watcher: could not confirm #${ctx.job.id}: ${e?.message || e}`);
          }
          if (ctx.draft) {
            try {
              await bid().registerForAutobid(ctx.draft);
              logLine(`Tab watcher: registered #${ctx.job.id} in Resume DB.`);
            } catch (e) {
              logLine(`Tab watcher: #${ctx.job.id} confirmed but Register failed: ${e?.message || e}`);
            }
          } else {
            logLine(`Tab watcher: #${ctx.job.id} confirmed; no Register draft was kept — register it from the Bid tab.`);
          }
          await chrome.tabs.remove(tabId).catch(() => {});
        } else {
          ctx.confirmPolls = 0;
        }
      } catch (_) {
        // Tab not ready: try next tick.
      }
    }
    if (!watchedTabs.size) {
      clearInterval(tabWatchTimer);
      tabWatchTimer = null;
    }
  }

  chrome.tabs.onRemoved.addListener((tabId) => {
    watchedTabs.delete(tabId);
    state.personTabs = state.personTabs.filter((id) => id !== tabId);
    state.tabsLeftOpen = state.tabsLeftOpen.filter((id) => id !== tabId);
  });

  // ───────────────────────────── Alerts ─────────────────────────────
  // Browser notifications for what needs the user: the day's limit reached,
  // stopped jobs piling up, ChatGPT refusing prompts, a ChatGPT page that keeps
  // failing, and a once-a-day summary of the day before.

  const ALERTS_KEY = 'autobid_alerts';
  const NEEDS_YOU_ALERT_STEP = 3;
  const DIGEST_HOUR = 8;
  const NOT_READY_ALERT_STREAK = 3;
  const NOT_READY_ALERT_MS = 60 * 60 * 1000;

  function notify(id, title, message) {
    if (!chrome.notifications?.create) return;
    try {
      chrome.notifications.create(`jobstrike-ab-${id}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title,
        message: String(message || '').slice(0, 300),
        priority: 1,
      });
    } catch (_) {
      /* notifications off */
    }
  }

  function localDay(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  async function dailyDigest(store) {
    const today = localDay();
    const day = today.toDateString();
    if (store.digestDay === day || new Date().getHours() < DIGEST_HOUR) return;
    store.digestDay = day;
    const since = localDay(-1).toISOString();
    const { digest } =
      (await bid().autobidFetch(
        `/api/autobid/digest?since=${encodeURIComponent(since)}&until=${encodeURIComponent(today.toISOString())}`
      )) || {};
    if (!digest) return;
    const top = (digest.byCategory || [])[0];
    const mins = (v) => (v == null ? '' : v < 60 ? `${Math.round(v)} min` : `${(v / 60).toFixed(1)} h`);
    notify(
      'digest',
      `Auto-bid yesterday: ${digest.sent} sent, ${digest.stopped} stopped`,
      [
        `${digest.resumesWritten} resume${digest.resumesWritten === 1 ? '' : 's'} written${digest.resumesFailed ? `, ${digest.resumesFailed} failed` : ''}.`,
        top ? `Top stop: ${top.label} (${top.count}).` : '',
        digest.avgApplyMin != null ? `Apply → sent ${mins(digest.avgApplyMin)} on average.` : '',
      ].filter(Boolean).join(' ')
    );
  }

  async function checkAlerts(summary) {
    const stored = await chrome.storage.local.get(ALERTS_KEY).catch(() => ({}));
    const store = { ...(stored?.[ALERTS_KEY] || {}) };
    const day = localDay().toDateString();

    if (state.prefs.submit && summary.submittedSince >= state.prefs.dailyLimit && store.limitDay !== day) {
      store.limitDay = day;
      notify('limit', 'Auto-bid reached its daily limit', `${summary.submittedSince} sent today (limit ${state.prefs.dailyLimit}). It starts again tomorrow.`);
    }

    const needs = summary.needsYou?.length || 0;
    const step = Math.floor(needs / NEEDS_YOU_ALERT_STEP);
    if (step > 0 && (store.needsDay !== day || step > (store.needsStep || 0))) {
      store.needsDay = day;
      store.needsStep = step;
      const reasonCounts = {};
      for (const row of summary.needsYou || []) {
        const reason = row.needsYouReason || classifyNeedsYouReason(row.reason);
        const label = NEEDS_YOU_REASON_LABELS[reason] || reason;
        reasonCounts[label] = (reasonCounts[label] || 0) + 1;
      }
      const breakdown = Object.entries(reasonCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => `${count} ${label}`)
        .join(', ');
      notify('needs', `${needs} jobs need you`, breakdown ? `${breakdown}. Check Needs you.` : 'Answer, retry or dismiss them under Needs you.');
    } else if (step === 0) {
      store.needsStep = 0;
    }

    const ag = wf.autogen;
    if (ag?.blocked && store.blockedAt !== ag.blockedAt) {
      store.blockedAt = ag.blockedAt;
      notify('chatgpt', 'AutoGen stopped: ChatGPT is blocked', `${ag.blocked}. Fix ChatGPT in the AutoGen window, then resumes are written again.`);
    }
    const stuck = (ag?.windows || []).filter((w) => (w.notReadyStreak || 0) >= NOT_READY_ALERT_STREAK);
    if (stuck.length && Date.now() - (store.notReadyAt || 0) > NOT_READY_ALERT_MS) {
      store.notReadyAt = Date.now();
      notify(
        'notready',
        'AutoGen cannot use ChatGPT',
        `${stuck.length} ChatGPT window${stuck.length === 1 ? '' : 's'} failed ${NOT_READY_ALERT_STREAK}+ times even after a reload. Check that ChatGPT loads and you are signed in.`
      );
    }

    try {
      await dailyDigest(store);
    } catch (_) {
      /* the summary is tried again on the next check */
      store.digestDay = '';
    }
    await chrome.storage.local.set({ [ALERTS_KEY]: store }).catch(() => {});
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
      void checkAlerts(summary).catch(() => {});
      if (state.prefs.submit && summary.submittedSince >= state.prefs.dailyLimit) {
        setStep(`Daily limit reached (${state.prefs.dailyLimit}). Resumes tomorrow.`);
        return;
      }
      if (summary.needsYou?.length && Date.now() - (state.lastAutoRetry || 0) > 30 * 60_000) {
        state.lastAutoRetry = Date.now();
        try {
          const ver = chrome.runtime?.getManifest?.().version || '';
          const { retried } = await bid().autobidFetch('/api/autobid/auto-retry', { method: 'POST', body: { version: ver } });
          if (retried) {
            logLine(`Auto-retried ${retried} needs-you job(s) with v${ver}.`);
            await refreshSummary();
          }
        } catch (_) {}
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
      next = outcome === 'submitted'
        ? gapAfterSubmitMs()
        : Math.max(5, Number(state.prefs.gapSeconds) || 30) * 1000;
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
      // be applied to at all (closed posting) does not count: the next one is tried.
      if (once && (outcome === 'submitted' || outcome === 'needs_you')) {
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
   * After a sent application, a short random pause so consecutive submissions
   * to the same site don't look automated. The setup's gapMin/gapMax override.
   */
  function gapAfterSubmitMs() {
    const min = Math.max(0, Number(wf.config?.gapMin ?? 0.5));
    const max = Math.max(min, Number(wf.config?.gapMax ?? 1.5));
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
    const action = btn.getAttribute('data-ab-action');
    if (action === 'dismiss-all') {
      const ids = (state.summary?.needsYou || []).map((item) => item.id);
      if (!ids.length) return;
      const ask = `Dismiss ${ids.length} job${ids.length === 1 ? '' : 's'}?\nThey leave Needs you for Finished and are not applied to again.`;
      const ok = typeof window.rwhConfirm === 'function'
        ? await window.rwhConfirm(ask, { confirmLabel: 'Dismiss', danger: true })
        : window.confirm(ask);
      if (ok) await dismissNeedsYou(ids, btn);
      return;
    }
    const id = Number(btn.closest('[data-ab-id]')?.getAttribute('data-ab-id'));
    const row = state.summary?.needsYou?.find((item) => item.id === id);
    if (!row) return;
    if (action === 'open') {
      if (row.jobLink) await chrome.tabs.create({ url: row.jobLink, active: true });
      return;
    }
    if (action === 'dismiss') {
      await dismissNeedsYou([id], btn);
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

  async function dismissNeedsYou(ids, btn) {
    btn.disabled = true;
    try {
      const { dismissed } = (await bid().autobidFetch('/api/autobid/dismiss', { method: 'POST', body: { ids } })) || {};
      logLine(`Dismissed ${dismissed || 0} job(s) from Needs you.`);
      await refreshSummary();
    } catch (error) {
      toast(error?.message || String(error), 'error');
      btn.disabled = false;
    }
  }

  // ───────────────────────────── All-in-one workflow ─────────────────────────────
  // One Start/Stop and one setup for the whole chain, saved on the server: the
  // website's Auto-bid page and this panel's Auto-bid tab edit the same setup,
  // and this panel runs it. Start: Live finds jobs and queues the Greenhouse,
  // Lever and Ashby ones for AutoGen, AutoGen keeps N ChatGPT windows generating,
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
        // This panel stays idle and says why in its own status. The setup is
        // not stopped: other panels that can work carry on (each job goes to one).
        wf.error = `This panel is not working: ${blocker}`;
        wf.appliedVersion = config.version; // handled: nothing was started for it
        render();
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

  window.SmartJobAutoBid = { applicationFormUrl, clickSubmitButton, enterVerificationCode, probeApplicationOutcome, judgeAfterSubmit };
})();
