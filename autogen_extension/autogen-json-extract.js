/* Extract the most recent generated resume JSON object from a ChatGPT reply.
 * Do not parse a prompt/example object when a later generated response exists
 * but is malformed. The caller should get an explicit parsing failure instead.
 */
const AUTOGEN_RESUME_JSON_KEYS = ["resume_template", "job_title", "company_name", "job_description"];

function autogenResumeFieldFilled(value) {
  if (typeof value === "string") return Boolean(value.trim());
  if (value && typeof value === "object" && "text" in value) {
    return Boolean(String(value.text ?? "").trim());
  }
  return value != null && value !== "";
}

function autogenScoreResumeJson(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return -1;
  return AUTOGEN_RESUME_JSON_KEYS.reduce(
    (score, key) => score + (autogenResumeFieldFilled(obj[key]) ? 1 : 0),
    0,
  );
}

function autogenNormalizeJsonText(text) {
  // Keep typographic quotation marks in valid JSON string VALUES: changing
  // "Used \u201cAgile\u201d, and \u201cScrum\u201d" to ASCII quotes corrupts it.
  // Braces inside Markdown fences can be scanned without removing the fences.
  return String(text ?? "").trim();
}

/** Best-effort repair of unescaped ASCII quotation marks inside JSON strings. */
function autogenRepairJsonQuotes(text) {
  const source = String(text || "");
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      continue;
    }
    if (escape) {
      out += ch;
      escape = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escape = true;
      continue;
    }
    if (ch !== '"') {
      out += ch;
      continue;
    }
    let j = i + 1;
    while (j < source.length && /\s/.test(source[j])) j += 1;
    const next = source[j] || "";
    if (!next || next === "," || next === "}" || next === "]" || next === ":") {
      out += '"';
      inString = false;
    } else {
      out += '\\"';
    }
  }
  return out;
}

/** Return top-level balanced object/array spans WITH positions. */
function autogenBalancedJsonSlices(text) {
  const slices = [];
  const stack = [];
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      if (stack.length === 0) start = i;
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      const expected = ch === "}" ? "{" : "[";
      if (stack[stack.length - 1] !== expected) {
        stack.length = 0;
        start = -1;
        continue;
      }
      stack.pop();
      if (stack.length === 0 && start >= 0) {
        slices.push({ raw: text.slice(start, i + 1), start, end: i + 1 });
        start = -1;
      }
    }
  }
  return slices;
}

function autogenHasResumeContent(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  return Object.keys(obj).some((key) =>
    /^(?:experience|work_experience|education|skills?|projects?|certifications?|contact(?:_info|_information)?|professional_summary|summary|personal_information|candidate|full_name|name)$/i.test(key)
  );
}

function autogenConsiderJsonSlice(slice, best) {
  let obj;
  try {
    obj = JSON.parse(slice.raw);
  } catch (_error) {
    return best;
  }
  const score = autogenScoreResumeJson(obj);
  if (score < 1 && !autogenHasResumeContent(obj)) return best;
  // The generated answer is normally the LAST resume object, not the longest
  // or the one with the highest metadata score (often a prompt example).
  if (!best || slice.start >= best.start) {
    return { raw: slice.raw, score, obj, start: slice.start, end: slice.end };
  }
  return best;
}

function autogenFindBestCandidate(source) {
  const slices = autogenBalancedJsonSlices(source);
  const candidates = slices.length ? slices : [{ raw: source, start: 0, end: source.length }];
  let best = null;
  for (const slice of candidates) best = autogenConsiderJsonSlice(slice, best);
  if (!best) return null;

  // If a later object explicitly starts a built-resume payload, an earlier
  // valid template/example must NEVER be used instead of that broken payload.
  const lastBuiltSignature = Math.max(
    source.lastIndexOf('"resume_template"'),
    source.lastIndexOf('"schema_version"'),
  );
  if (lastBuiltSignature >= best.end) return null;
  return best;
}

function autogenPickResumeJson(text) {
  const normalized = autogenNormalizeJsonText(text);
  if (!normalized) return null;
  const direct = autogenFindBestCandidate(normalized);
  if (direct) return direct;

  // Repair only AFTER checking intact JSON; never modify successful content.
  const repaired = autogenRepairJsonQuotes(normalized);
  if (repaired !== normalized) {
    const recovered = autogenFindBestCandidate(repaired);
    if (recovered) return recovered;
  }

  // Last-resort support for model output using curly quotes for JSON syntax.
  // Valid JSON string content is never changed because direct parsing won.
  const asciiQuotes = normalized.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
  if (asciiQuotes !== normalized) {
    const recovered = autogenFindBestCandidate(autogenRepairJsonQuotes(asciiQuotes));
    if (recovered) return recovered;
  }
  return null;
}

function autogenBlockLooksLikeBuiltResume(text) {
  const raw = String(text || "");
  return /"resume_template"\s*:/.test(raw) || /"schema_version"\s*:/.test(raw);
}
