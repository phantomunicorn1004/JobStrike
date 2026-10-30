/**
 * Auto-bid runner. Applies to the jobs whose resume AutoGen generated, the way
 * the Bid tab is used by hand, one job at a time in this panel's window:
 *
 *   open the job's form → profile + generated resume JSON → Generate files
 *   (json2docx) → Autofill (AI when a key is set) → check every required field
 *   → Submit → wait for the site's confirmation → Register in Resume DB.
 *
 * Anything it cannot finish safely stops before (or at) Submit and is listed
 * under Needs you, with the tab left open: a CAPTCHA, a required field it has
 * no answer for, a site it does not submit on, no confirmation after Submit.
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
    const toggle = document.getElementById('abToggle');
    if (toggle) toggle.checked = Boolean(state.prefs.enabled);
    document.getElementById('abCard')?.classList.toggle('is-on', Boolean(state.prefs.enabled));
    const submit = document.getElementById('abSubmit');
    if (submit) submit.checked = Boolean(state.prefs.submit);
    const limit = document.getElementById('abDailyLimit');
    if (limit && document.activeElement !== limit) limit.value = String(state.prefs.dailyLimit);

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
        : state.step || (state.prefs.enabled ? 'Waiting for generated resumes…' : 'Applies to jobs whose resume AutoGen generated.');
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
    renderFullAuto();
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

  /** Runs in every frame. What the page says after Submit. */
  function probeApplicationOutcome() {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const text = String(document.body?.innerText || '').slice(0, 30000);
    let path = '';
    try {
      path = new URL(location.href).pathname;
    } catch (_) {
      /* about:blank */
    }
    const confirmed =
      /thank(s| you) for (applying|your application|submitting)|application (has been |was )?(successfully )?(submitted|received)|we('ve| have) received your application|your application (has been|was) (sent|submitted)/i.test(
        text
      ) || /\/(confirmation|thanks|thank-you|thank_you|submitted)(\/|$)/i.test(path);
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
      .map((el) => String(el.innerText || el.getAttribute('aria-label') || el.getAttribute('name') || '').trim())
      .filter((t) => t && t.length < 160);
    return { href: location.href, confirmed, captcha, errors: [...new Set(errors)].slice(0, 6) };
  }

  async function probeOutcome(tabId) {
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: probeApplicationOutcome });
      const frames = results.map((r) => r?.result).filter(Boolean);
      return {
        confirmed: frames.some((f) => f.confirmed),
        captcha: frames.some((f) => f.captcha),
        errors: frames.flatMap((f) => f.errors || []).slice(0, 6),
        hrefs: frames.map((f) => f.href),
      };
    } catch (_) {
      // Navigating after Submit: nothing to read for a moment.
      return { confirmed: false, captcha: false, errors: [], hrefs: [], navigating: true };
    }
  }

  function rowLabel(row) {
    const field = row?.field || {};
    return String(field.questionText || field.labelText || field.name || field.fieldCategory || 'field')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
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
      const health = await window.SmartJobJson2Docx?.checkJson2docxHealth?.({ updateUi: true }).catch(() => null);
      if (health && !health.ok) {
        throw new Stop('pause', `json2docx is ${health.error === 'disabled' ? 'disabled in Settings' : 'offline'}: start it on this machine (start_server.bat).`);
      }
      await bid().generateFilesFromResumeJson(null);
      checkStop();

      const useAi = Boolean(typeof isAiModeEnabled === 'function' && isAiModeEnabled());
      setStep(useAi ? 'Filling the form (AI)…' : 'Filling the form…');
      await autofillThisPage({ useAi });
      checkStop();

      if (!currentFields.length) {
        throw new Stop('needs_you', 'No application form found on the page (it may need a login or an Apply click).', meta);
      }
      const open = currentPlan.filter((row) => row.field?.required && row.fillOutcome !== 'filled');
      meta.fields = currentPlan.length;
      meta.filled = currentPlan.filter((row) => row.fillOutcome === 'filled').length;
      meta.aiAnswers = currentPlan.filter((row) => row.source === 'ai' && row.fillOutcome === 'filled').length;
      if (!useAi) meta.noAiKey = true;
      if (open.length) {
        meta.openFields = open.map(rowLabel);
        throw new Stop(
          'needs_you',
          `Required ${open.length === 1 ? 'field' : 'fields'} not filled: ${meta.openFields.slice(0, 5).join('; ')}${open.length > 5 ? '…' : ''}`,
          meta
        );
      }

      const formHref = (await frameHref(tabId, autofillFrameId)) || url;
      meta.formHost = hostOf(formHref);
      if (!SUBMIT_HOST_RE.test(meta.formHost)) {
        throw new Stop(
          'needs_you',
          `Filled. Auto-submit covers Greenhouse, Lever and Ashby; this form is on ${meta.formHost || 'another site'}. Review it, submit, then Register.`,
          meta
        );
      }
      if (!state.prefs.submit) {
        throw new Stop('needs_you', 'Dry run: filled and checked, not submitted. Review the tab, submit, then Register.', meta);
      }
      checkStop();

      setStep('Submitting…');
      const before = await probeOutcome(tabId);
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
      let outcome = null;
      let errorPolls = 0;
      while (Date.now() < until) {
        await sleep(CONFIRM_POLL_MS);
        outcome = await probeOutcome(tabId);
        // Boilerplate like "thank you for applying" in the posting itself is not a confirmation.
        const newlyConfirmed =
          outcome.confirmed && (!before.confirmed || outcome.hrefs.join('|') !== before.hrefs.join('|'));
        if (newlyConfirmed) break;
        if (outcome.captcha) {
          throw new Stop('needs_you', 'A CAPTCHA appeared after Submit. Solve it in the tab, submit, then Register.', meta);
        }
        errorPolls = outcome.errors.length ? errorPolls + 1 : 0;
        if (errorPolls >= 2) {
          meta.pageErrors = outcome.errors;
          throw new Stop('needs_you', `The site rejected the form: ${outcome.errors.slice(0, 3).join('; ')}`, meta);
        }
      }
      if (!outcome?.confirmed || (before.confirmed && outcome.hrefs.join('|') === before.hrefs.join('|'))) {
        throw new Stop('needs_you', 'Submit was clicked but no confirmation appeared. Check the tab before doing anything else.', meta);
      }

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
      const { job } = await bid().autobidFetch('/api/autobid/next', { method: 'POST' });
      if (!job) {
        setStep('Waiting for generated resumes…');
        return;
      }
      const win = await chrome.windows.getCurrent().catch(() => null);
      state.job = job;
      const dryRun = !state.prefs.submit;
      logLine(`${dryRun ? 'Dry run' : 'Applying'}: ${job.company} · ${job.job_title} (#${job.id}).`);
      const outcome = await applyToJob(job, win?.id);
      next = Math.max(5, Number(state.prefs.gapSeconds) || 30) * 1000;
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
        setStep(`Dry run done for #${job.id}: review the open tab. Turn on "Press Submit" to apply by itself.`);
        toast('Dry run finished one job: review the filled form in the open tab.', 'info');
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
      await bid().autobidFetch('/api/autobid/retry', { method: 'POST', body: { ids: [id] } });
      logLine(`#${id} given back to Auto-bid.`);
      await refreshSummary();
      schedule(1000);
    } catch (error) {
      toast(error?.message || String(error), 'error');
      btn.disabled = false;
    }
  }

  // ───────────────────────────── Full auto ─────────────────────────────
  // One switch for the whole chain: Live finds jobs → they are queued for
  // AutoGen → Auto-bid applies and presses Submit. AutoGen itself runs in its
  // own extension; its windows only need "Run in background" once.

  const HEALTH_EVERY_MS = 2 * 60 * 1000;
  const fullAuto = { json2docx: null, checkedAt: 0, busy: false };

  function live() {
    return window.SmartJobLive || null;
  }

  function isFullAuto() {
    const l = live()?.autoState?.();
    return Boolean(l?.live && l?.autoQueue && state.prefs.enabled && state.prefs.submit);
  }

  async function checkJson2docx(force = false) {
    if (!force && Date.now() - fullAuto.checkedAt < HEALTH_EVERY_MS) return;
    fullAuto.checkedAt = Date.now();
    const health = await window.SmartJobJson2Docx?.checkJson2docxHealth?.({ updateUi: false }).catch(() => null);
    fullAuto.json2docx = health ? Boolean(health.ok) : null;
  }

  function renderFullAuto() {
    const card = document.getElementById('faCard');
    if (!card) return;
    const l = live()?.autoState?.() || {};
    const on = isFullAuto();
    card.classList.toggle('is-on', on);
    const toggle = document.getElementById('faToggle');
    if (toggle && !fullAuto.busy) toggle.checked = on;
    const aiOn = typeof isAiModeEnabled === 'function' && isAiModeEnabled();
    const checks = [
      ['Live checks for new jobs', l.live, l.challenge ? 'Paused: a site asked for a check (Job Scraper tab)' : l.status || ''],
      ['New Greenhouse, Lever and Ashby jobs queued for AutoGen', l.autoQueue, l.profileName ? `for ${l.profileName}` : ''],
      [
        'Auto-bid applies and presses Submit',
        state.prefs.enabled && state.prefs.submit,
        state.prefs.enabled && !state.prefs.submit
          ? 'Dry run: Press Submit is off'
          : state.pauseReason
            ? `Paused: ${state.pauseReason}`
            : '',
      ],
      ['json2docx running', fullAuto.json2docx, fullAuto.json2docx === false ? 'Start it on this machine (start_server.bat)' : ''],
      ['AI answers custom questions', aiOn, aiOn ? '' : 'Settings → Autofill with AI, with an OpenAI key'],
    ];
    const list = document.getElementById('faChecks');
    if (list) {
      list.innerHTML = checks
        .map(([label, ok, note]) => {
          const mark = ok ? 'ok' : ok === null || ok === undefined ? 'unknown' : 'off';
          const sign = mark === 'ok' ? '✓' : mark === 'off' ? '✗' : '?';
          return `<li class="fa-check" data-state="${mark}"><span class="fa-mark" aria-hidden="true">${sign}</span><span class="fa-label">${escapeHtml(label)}${
            note ? ` <em>${escapeHtml(note)}</em>` : ''
          }</span></li>`;
        })
        .join('');
    }
    const status = document.getElementById('faStatus');
    if (status) {
      const s = state.summary;
      status.textContent = !on
        ? 'Off'
        : s
          ? `${s.submittedSince} sent today of ${state.prefs.dailyLimit} · ${s.needsYou.length} need you`
          : 'On';
    }
  }

  async function setFullAuto(on) {
    if (fullAuto.busy) return;
    fullAuto.busy = true;
    try {
      if (!live()?.setAutoQueue) {
        toast('Open the Job Scraper tab once, then turn Full auto on.', 'warn');
        return;
      }
      if (on) {
        const profile = bid()?.getSelectedRegisterProfile?.();
        if (!profile) {
          toast('Choose the profile in the Bid tab first: new jobs are applied to for it.', 'warn');
          return;
        }
        await live().setAutoQueue(profile);
        state.prefs.submit = true;
        await savePrefs();
        await setEnabled(true);
        await checkJson2docx(true);
        toast(`Full auto on for ${profile.name}: new jobs are found, generated and applied to by themselves.`, 'success');
      } else {
        await live().setAutoQueue(null);
        await setEnabled(false);
        toast('Full auto off. Live keeps checking and alerting; nothing is queued or sent.', 'info');
      }
    } finally {
      fullAuto.busy = false;
      renderFullAuto();
    }
  }

  async function init() {
    if (!document.getElementById('abCard')) return;
    await loadPrefs();
    document.getElementById('abToggle')?.addEventListener('change', (event) => void setEnabled(event.target.checked));
    document.getElementById('abSubmit')?.addEventListener('change', async (event) => {
      state.prefs.submit = Boolean(event.target.checked);
      await savePrefs();
      if (state.prefs.submit) toast('Auto-bid will press Submit on Greenhouse, Lever and Ashby forms it filled completely.', 'info');
      render();
    });
    document.getElementById('abDailyLimit')?.addEventListener('change', async (event) => {
      state.prefs.dailyLimit = Math.max(1, Math.min(Number(event.target.value) || DEFAULT_PREFS.dailyLimit, 200));
      await savePrefs();
      render();
    });
    document.getElementById('abRefresh')?.addEventListener('click', () => void refreshSummary());
    document.getElementById('abNeedsYou')?.addEventListener('click', (event) => void onNeedsYouClick(event));
    document.getElementById('faToggle')?.addEventListener('change', (event) => void setFullAuto(event.target.checked));
    setInterval(() => {
      void checkJson2docx().then(renderFullAuto);
    }, 5000);
    render();
    if (state.prefs.enabled) {
      setStep('Starting…');
      schedule(8000);
    } else {
      setTimeout(() => void refreshSummary(), 4000);
    }
  }

  window.addEventListener('DOMContentLoaded', () => void init());

  window.SmartJobAutoBid = { applicationFormUrl, clickSubmitButton, probeApplicationOutcome };
})();
