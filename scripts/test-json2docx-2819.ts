import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const { data: row } = await sb
    .from("resume_db_applications")
    .select("built_resume_json")
    .eq("id", 2819)
    .single();

  if (!row?.built_resume_json) {
    console.log("No built_resume_json");
    return;
  }

  // Add PII fields that the extension injects
  const json = JSON.parse(row.built_resume_json);
  json.profile = json.profile || "Jacob Matthew Pribisco";
  json.candidate = json.candidate || "Jacob Matthew Pribisco";
  json.email = json.email || "jacob.matthew.pribisco@outlook.com";
  json.phone_number = json.phone_number || "+1 904-413-8680";
  json.current_location = json.current_location || "Jacksonville, FL";
  if (!json.education) {
    json.education = {
      institution: "University of North Florida",
      degree: "Bachelor of Science in Computer Science",
      location: "Jacksonville, FL",
      date_range: "Aug 2014 - Apr 2018",
    };
  }

  const outPath = "scripts/test-2819-input.json";
  fs.writeFileSync(outPath, JSON.stringify(json, null, 2));
  console.log(`Wrote ${outPath} (${fs.statSync(outPath).size} bytes)`);
  console.log("Now run: cd json2docx && python -c \"...(see below)...\"");
}

main().catch(console.error);
