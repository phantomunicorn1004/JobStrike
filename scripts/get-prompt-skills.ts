import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  // First, list the columns
  const { data: cols } = await supabase
    .from("profile_prompt_kits")
    .select("*")
    .eq("profile_id", 4)
    .limit(1);

  if (!cols?.length) { console.log("No kit found"); return; }
  console.log("Columns:", Object.keys(cols[0]).join(", "));
  console.log();

  // Find the prompt template column
  const row = cols[0] as Record<string, unknown>;
  for (const [key, val] of Object.entries(row)) {
    if (typeof val === "string" && val.length > 200) {
      console.log(`\n=== ${key} (${val.length} chars) ===`);
      // Search for skills section
      const lines = val.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (/skill|technology|tech.?stack|Skill.?Group|Skill.?Items|Programming Languages/i.test(lines[i])) {
          const start = Math.max(0, i - 2);
          const end = Math.min(lines.length, i + 10);
          console.log(`\n--- Around line ${i + 1} ---`);
          for (let j = start; j < end; j++) {
            console.log(`${j + 1}: ${lines[j]}`);
          }
        }
      }
    }
  }
}

main().catch(console.error);
