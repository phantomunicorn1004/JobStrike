import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  const { data: kits } = await supabase
    .from("profile_prompt_kits")
    .select("profile_id, resume_template_json, updated_at")
    .order("updated_at", { ascending: false })
    .limit(10);

  if (!kits?.length) { console.log("No kits"); return; }

  const getText = (f: unknown): string => {
    if (typeof f === "string") return f;
    if (typeof f === "object" && f !== null) return String((f as {text?: string}).text || "");
    return "";
  };

  for (const kit of kits) {
    console.log(`\n=== Profile ${kit.profile_id} (updated: ${kit.updated_at}) ===`);
    if (!kit.resume_template_json) { console.log("  (empty)"); continue; }
    const json = JSON.parse(kit.resume_template_json);
    const work = json.work_experience || {};
    for (const ek of Object.keys(work).filter(k => k.startsWith("experience_")).sort()) {
      const role = work[ek] as Record<string, unknown>;
      const company = getText(role.company);
      const title = getText(role.role_title);
      const location = getText(role.location);
      const wa = getText(role.work_arrangement);
      const hasPlaceholder = /Extracted Company|\[JD|City,\s*ST/i.test(`${company}|${title}|${location}`);
      console.log(`  ${ek}: company="${company}" title="${title}" location="${location}" wa="${wa}" ${hasPlaceholder ? "⚠️ HAS PLACEHOLDER" : ""}`);
    }
    // Check summary for instruction text
    const summary = getText(json.summary);
    if (summary && /\[JD|role family|years/i.test(summary)) {
      console.log(`  summary: "${summary.slice(0, 100)}"`);
    }
  }
}

main().catch(console.error);
