/**
 * Postings embedded in an iframe: Greenhouse / Lever / Ashby boards hosted on a
 * company's own careers page. The content script runs in the top frame only,
 * so when it finds no usable description the panel reads the embedded frame
 * with the same extraction pipeline.
 */
(function (global) {
  const CONTENT_FILES = ['field-registry.js', 'job-posting-ingest.js', 'content.js'];
  const ATS_FRAME_HOST_RE =
    /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|icims\.com|smartrecruiters\.com|workable\.com|bamboohr\.com|rippling\.com|jobvite\.com|personio\.(com|de)|oraclecloud\.com)$/i;

  /** Below this the top frame is treated as not having the posting. */
  const USABLE_JD_CHARS = 300;
  /** A frame with no known board host must hold at least this much text. */
  const MIN_FRAME_TEXT_CHARS = 500;
  const MAX_FRAMES = 3;
  /** The frame's text must beat the top frame's by this ratio to replace it. */
  const FRAME_WIN_RATIO = 1.5;

  function postingLength(posting) {
    return String(posting?.rawFullText || '').trim().length;
  }

  function needsFrameFallback(posting) {
    return postingLength(posting) < USABLE_JD_CHARS;
  }

  /** Runs inside every frame of the tab. */
  function probeFrame() {
    return {
      href: location.href,
      top: window === window.top,
      textLength: (document.body?.innerText || '').length,
      inputs: document.querySelectorAll('input:not([type="hidden"]), textarea, select').length,
    };
  }

  function hostOf(href) {
    try {
      return new URL(href).hostname.toLowerCase();
    } catch (_) {
      return '';
    }
  }

  async function listCandidateFrames(tabId) {
    if (!chrome.scripting?.executeScript) return [];
    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: probeFrame,
      });
    } catch (_) {
      return [];
    }
    return (Array.isArray(results) ? results : [])
      .filter((r) => r?.result && !r.result.top && /^https?:/i.test(r.result.href))
      .map((r) => ({
        frameId: r.frameId,
        href: r.result.href,
        textLength: Number(r.result.textLength) || 0,
        inputs: Number(r.result.inputs) || 0,
        knownBoard: ATS_FRAME_HOST_RE.test(hostOf(r.result.href)),
      }))
      .filter((f) => f.knownBoard || f.textLength >= MIN_FRAME_TEXT_CHARS || f.inputs >= 3)
      .sort((a, b) => Number(b.knownBoard) - Number(a.knownBoard) || b.textLength - a.textLength)
      .slice(0, MAX_FRAMES);
  }

  /**
   * Message one frame's content script. forFrame: sub-frame content scripts
   * ignore everything else, so the top frame keeps answering the panel's
   * ordinary messages.
   */
  function sendToFrame(tabId, frameId, message) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, { ...message, forFrame: true }, { frameId }, (response) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response || null);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  function askFrame(tabId, frameId) {
    return sendToFrame(tabId, frameId, { action: 'fetchJobPosting' });
  }

  /** A frame needs at least this many inputs to be treated as holding a form. */
  const MIN_FORM_INPUTS = 3;

  /**
   * Application forms embedded in an iframe (a Greenhouse board on a company
   * careers page, iCIMS). Scans each plausible frame and returns the one with
   * the most fields.
   * @returns {Promise<{ frameId: number, frameUrl: string, response: object } | null>}
   */
  async function scanFormInFrames(tabId) {
    const frames = (await listCandidateFrames(tabId)).filter((f) => f.inputs >= MIN_FORM_INPUTS);
    let best = null;
    for (const frame of frames) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frame.frameId] },
          files: CONTENT_FILES,
        });
        const response = await sendToFrame(tabId, frame.frameId, { action: 'scanApplicationForm' });
        const count = Array.isArray(response?.fields) ? response.fields.length : 0;
        if (count && (!best || count > best.count)) {
          best = { frameId: frame.frameId, frameUrl: frame.href, response, count };
        }
      } catch (_) {
        /* frame navigated away or blocks injection */
      }
    }
    return best ? { frameId: best.frameId, frameUrl: best.frameUrl, response: best.response } : null;
  }

  /** @returns {Promise<{ response: object, frameUrl: string } | null>} the fullest embedded posting */
  async function fetchPostingFromFrames(tabId) {
    const frames = await listCandidateFrames(tabId);
    let best = null;
    for (const frame of frames) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frame.frameId] },
          files: CONTENT_FILES,
        });
        const response = await askFrame(tabId, frame.frameId);
        const length = postingLength(response?.posting);
        if (length && (!best || length > best.length)) {
          best = { response, frameUrl: frame.href, length };
        }
      } catch (_) {
        /* frame navigated away or blocks injection */
      }
    }
    return best ? { response: best.response, frameUrl: best.frameUrl } : null;
  }

  /**
   * Combine the top-frame result with an embedded posting.
   *
   * The description comes from the frame. The job link stays the tab's URL —
   * that is the page being bid on. Title and company come from the frame when a
   * board adapter recognised it, since the host page's heading is often just
   * "Careers".
   */
  function mergeFramePosting(topResponse, frameResult) {
    const top = topResponse || {};
    const frame = frameResult?.response;
    const framePosting = frame?.posting;
    if (!framePosting) return top;

    const topLength = postingLength(top.posting);
    const frameLength = postingLength(framePosting);
    if (frameLength < USABLE_JD_CHARS || frameLength < topLength * FRAME_WIN_RATIO) return top;

    const topPosting = top.posting || {};
    const fromBoard = Boolean(frame.adapter && frame.adapter !== 'default');
    const prefer = (frameValue, topValue) =>
      String((fromBoard ? frameValue || topValue : topValue || frameValue) || '').trim();

    const jobTitle = prefer(framePosting.jobTitle, topPosting.jobTitle || top.job_title);
    const companyName = prefer(framePosting.companyName, topPosting.companyName || top.company_name);
    const jobLink = topPosting.jobLink || top.job_link || topPosting.tabUrl || '';

    const posting = {
      ...framePosting,
      jobLink,
      tabUrl: topPosting.tabUrl || jobLink,
      jobTitle,
      companyName,
      meta: {
        ...(framePosting.meta || {}),
        embeddedFrom: frameResult.frameUrl,
      },
    };

    return {
      ...top,
      success: true,
      adapter: frame.adapter || top.adapter,
      posting,
      job_link: jobLink,
      job_title: jobTitle,
      company_name: companyName,
      job_description: posting.rawFullText || '',
    };
  }

  /** Top-frame response, upgraded from an embedded frame when it has no usable JD. */
  async function withFrameFallback(tabId, topResponse) {
    if (!needsFrameFallback(topResponse?.posting)) return topResponse;
    const frameResult = await fetchPostingFromFrames(tabId);
    return frameResult ? mergeFramePosting(topResponse, frameResult) : topResponse;
  }

  const api = {
    USABLE_JD_CHARS,
    needsFrameFallback,
    fetchPostingFromFrames,
    mergeFramePosting,
    withFrameFallback,
    scanFormInFrames,
    sendToFrame,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SmartJobPostingFrames = api;
})(typeof window !== 'undefined' ? window : globalThis);
