import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

async function main() {
  const { data, error } = await supabase
    .from("resume_db_applications")
    .select("id, built_resume_json")
    .eq("id", 2819)
    .single();
  if (error) { console.error(error); return; }
  const outPath = "C:\\Users\\Ryan\\AppData\\Local\\Temp\\claude\\60454fb200675fe6\\fc0236b1-1b3e-4cde-942b-22d29dfc021e\\scratchpad\\row2819.json";
  writeFileSync(outPath, data.built_resume_json, "utf-8");
  console.log("Wrote", outPath);
}

main().catch(console.error);
