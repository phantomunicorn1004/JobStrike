import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const STATE_FILE = path.join(__dirname, ".audit-state.json");

interface AuditState {
  lastCheckedAt: string;
  lastRunAt: string;
}

function loadState(): AuditState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { lastCheckedAt: "2020-01-01T00:00:00Z", lastRunAt: "" };
  }
}

function saveState(state: AuditState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

interface Field {
  label: string;
  value: string;
  source: string;
  outcome: string;
  category: string;
  required: boolean;
  error: string;
  maxLength?: number;
}

interface Finding {
  jobId: number;
  company: string;
  ats: string;
  severity: "high" | "medium" | "low";
  rule: string;
  field: string;
  value: string;
  detail: string;
}

function auditField(
  f: Field,
  jobId: number,
  company: string,
  ats: string,
): Finding[] {
  const findings: Finding[] = [];
  const label = String(f.label || "");
  const value = String(f.value || "");
  const source = String(f.source || "");
  const outcome = String(f.outcome || "");
  const category = String(f.category || "");
  const required = Boolean(f.required);

  // 1. Resume-length text in a short-answer field
  if (
    value.length > 120 &&
    !/describe|tell|explain|experience with|why do you|what excites|about you/i.test(label) &&
    !/custom_question/.test(category)
  ) {
    findings.push({
      jobId, company, ats,
      severity: "high",
      rule: "long-text-in-short-field",
      field: label,
      value: value.substring(0, 80) + "...",
      detail: `${value.length}-char answer in a non-essay field (category: ${category})`,
    });
  }

  // 2. Boolean answer to a date/expiration question
  if (
    /expir|date.*(?:authori|visa|permit)|when does|valid until/i.test(label) &&
    /^(yes|no|true|false)$/i.test(value.trim())
  ) {
    findings.push({
      jobId, company, ats,
      severity: "high",
      rule: "boolean-for-date",
      field: label,
      value,
      detail: `Boolean "${value}" given for a date/expiration question`,
    });
  }

  // 3. Incomplete address for full-address fields
  if (
    /full.*address|mailing.*address|address.*city.*state|address.*zip/i.test(label) &&
    value &&
    !/\d{5}/.test(value) &&
    !/,/.test(value)
  ) {
    findings.push({
      jobId, company, ats,
      severity: "high",
      rule: "incomplete-address",
      field: label,
      value,
      detail: "Full address requested but value has no city/state/zip",
    });
  }

  // 4. Single name for full-name fields
  if (
    /legal.*first.*last|first.*and.*last.*name|full.*legal.*name/i.test(label) &&
    value &&
    !value.includes(" ")
  ) {
    findings.push({
      jobId, company, ats,
      severity: "high",
      rule: "single-name-for-fullname",
      field: label,
      value,
      detail: "Full name requested but got only one name",
    });
  }

  // 5. Salary field with non-numeric prose
  if (
    /salary|compensation|pay.*expect|expected.*pay|desired.*pay/i.test(label) &&
    value.length > 30 &&
    !/^\$?[\d,]+/.test(value.trim())
  ) {
    findings.push({
      jobId, company, ats,
      severity: "high",
      rule: "salary-prose",
      field: label,
      value: value.substring(0, 80) + "...",
      detail: `Salary field got ${value.length}-char prose instead of a number`,
    });
  }

  // 6. MaxLength exceeded
  if (f.maxLength && f.maxLength > 0 && value.length > f.maxLength) {
    findings.push({
      jobId, company, ats,
      severity: "medium",
      rule: "exceeds-maxlength",
      field: label,
      value: value.substring(0, 40) + "...",
      detail: `Value is ${value.length} chars but field limit is ${f.maxLength}`,
    });
  }

  // 7. Required field failed to fill
  if (required && outcome === "failed") {
    findings.push({
      jobId, company, ats,
      severity: "medium",
      rule: "required-field-failed",
      field: label,
      value: String(f.error || ""),
      detail: `Required field (${category}) could not be filled`,
    });
  }

  // 8. AI wrote "I have..." essay for non-essay fields
  if (
    source === "ai" &&
    /^I have\b/.test(value) &&
    value.length > 100 &&
    !/describe|tell|explain|experience|why|what/i.test(label)
  ) {
    findings.push({
      jobId, company, ats,
      severity: "medium",
      rule: "ai-essay-in-short-field",
      field: label,
      value: value.substring(0, 80) + "...",
      detail: "AI wrote an essay-style answer for a non-essay field",
    });
  }

  // 9. Sanctions/territory answered with a country name
  if (
    /sanction|embargo|cuba|iran|north korea|crimea/i.test(label) &&
    value.length > 0 &&
    !/^(no|none|n\/a|false)$/i.test(value.trim())
  ) {
    findings.push({
      jobId, company, ats,
      severity: "high",
      rule: "sanctions-wrong-answer",
      field: label,
      value,
      detail: "Sanctions question not answered with No/None",
    });
  }

  // 10. Combobox match failure (AI tried but no matching option)
  if (
    outcome === "failed" &&
    /no matching.*option|best score 0/i.test(String(f.error || ""))
  ) {
    findings.push({
      jobId, company, ats,
      severity: "low",
      rule: "combobox-mismatch",
      field: label,
      value: value || String(f.error || ""),
      detail: `AI answer didn't match any dropdown option`,
    });
  }

  return findings;
}

async function main() {
  const state = loadState();
  const since = state.lastCheckedAt;
  const now = new Date().toISOString();

  console.log(`\n=== Post-Batch Audit ===`);
  console.log(`Checking submissions since: ${since}\n`);

  const { data, error } = await sb
    .from("resume_db_applications")
    .select("id, company, ats_platform, bid_fields, applied_at")
    .eq("bid_state", "submitted")
    .gt("applied_at", since)
    .order("applied_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Query error:", error.message);
    return;
  }

  if (!data?.length) {
    console.log("No new submissions since last audit.");
    saveState({ lastCheckedAt: now, lastRunAt: now });
    return;
  }

  console.log(`Found ${data.length} new submission(s) to audit.\n`);

  let totalFields = 0;
  let totalAi = 0;
  const allFindings: Finding[] = [];

  for (const r of data) {
    const fields = r.bid_fields as Field[] | null;
    if (!fields) {
      console.log(`[#${r.id}] ${r.company} — no field data recorded`);
      continue;
    }

    for (const f of fields) {
      totalFields++;
      if (f.source === "ai") totalAi++;
      const findings = auditField(f, r.id, r.company, r.ats_platform);
      allFindings.push(...findings);
    }
  }

  // Summary
  console.log(`Audited: ${data.length} jobs, ${totalFields} fields, ${totalAi} AI-answered\n`);

  if (allFindings.length === 0) {
    console.log("No issues found — all submissions look clean.\n");
  } else {
    const high = allFindings.filter((f) => f.severity === "high");
    const medium = allFindings.filter((f) => f.severity === "medium");
    const low = allFindings.filter((f) => f.severity === "low");

    console.log(`FINDINGS: ${allFindings.length} total — ${high.length} high, ${medium.length} medium, ${low.length} low\n`);

    for (const f of allFindings) {
      const icon = f.severity === "high" ? "!!!" : f.severity === "medium" ? " ! " : " . ";
      console.log(`  [${icon}] #${f.jobId} ${f.company} (${f.ats})`);
      console.log(`        Rule: ${f.rule}`);
      console.log(`        Field: "${f.field}"`);
      console.log(`        Value: "${f.value}"`);
      console.log(`        ${f.detail}\n`);
    }
  }

  // Stats by ATS platform
  const byAts: Record<string, { total: number; issues: number }> = {};
  for (const r of data) {
    const ats = r.ats_platform || "unknown";
    if (!byAts[ats]) byAts[ats] = { total: 0, issues: 0 };
    byAts[ats].total++;
  }
  for (const f of allFindings) {
    if (!byAts[f.ats]) byAts[f.ats] = { total: 0, issues: 0 };
    byAts[f.ats].issues++;
  }
  console.log("--- By ATS Platform ---");
  for (const [ats, stats] of Object.entries(byAts).sort((a, b) => b[1].issues - a[1].issues)) {
    console.log(`  ${ats.padEnd(20)} ${stats.total} jobs, ${stats.issues} issue(s)`);
  }

  // Stats by rule
  const byRule: Record<string, number> = {};
  for (const f of allFindings) {
    byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  }
  if (Object.keys(byRule).length) {
    console.log("\n--- By Rule ---");
    for (const [rule, count] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${rule.padEnd(30)} ${count}x`);
    }
  }

  console.log();
  saveState({ lastCheckedAt: now, lastRunAt: now });
  console.log(`State saved. Next run will check submissions after ${now}\n`);
}

main().catch(console.error);
