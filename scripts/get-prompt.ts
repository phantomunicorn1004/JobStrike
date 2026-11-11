import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  const { data } = await supabase
    .from("profile_prompt_kits")
    .select("profile_id, prompt_template, resume_template_json")
    .eq("profile_id", 4)
    .single();

  if (!data) { console.log("No kit for profile 4"); return; }

  console.log("=== PROMPT TEMPLATE (Profile 4) ===\n");
  console.log(data.prompt_template);

  console.log("\n\n=== RESUME TEMPLATE JSON (Profile 4) — Summary & Experience fields ===\n");
  const kit = JSON.parse(data.resume_template_json);

  // Summary
  console.log("summary:", JSON.stringify(kit.summary, null, 2));

  // Work experience structure (just the field names and instructions, not all bullets)
  const work = kit.work_experience || {};
  for (const ek of Object.keys(work).filter(k => k.startsWith("experience_")).sort()) {
    const role = work[ek] as Record<string, unknown>;
    console.log(`\n${ek}:`);
    for (const [fk, fv] of Object.entries(role)) {
      const getText = (f: unknown): string => {
        if (typeof f === "string") return f;
        if (typeof f === "object" && f !== null) {
          const o = f as { text?: string; placeholder?: string };
          return `[placeholder=${o.placeholder || "?"}] text="${o.text || ""}"`;
        }
        return String(f);
      };
      if (fk === "bullets") {
        const bullets = fv as Record<string, unknown>;
        const bk = Object.keys(bullets).filter(k => k.startsWith("bullet_"));
        console.log(`  bullets: ${bk.length} bullets`);
        if (bk.length) {
          const first = bullets[bk[0]];
          console.log(`    ${bk[0]}: ${getText(first).slice(0, 150)}`);
        }
      } else {
        console.log(`  ${fk}: ${getText(fv).slice(0, 150)}`);
      }
    }
  }
}

main().catch(console.error);
