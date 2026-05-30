/**
 * Assign existing Resume DB rows to stevenspiethdev@gmail.com and set extension API key.
 *
 *   node scripts/assign-resume-db-owner.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { loadEnvFiles, projectRoot } from "./load-env.mjs";

loadEnvFiles();

const OWNER_USERNAME = "stevenspiethdev@gmail.com";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !key) {
  console.error(
    "Missing Supabase env vars. Create .env.local in:\n" + projectRoot,
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const username = OWNER_USERNAME.trim().toLowerCase();
const { data: owner, error: ownerError } = await supabase
  .from("app_users")
  .select("id, username, extension_api_key")
  .eq("username", username)
  .maybeSingle();

if (ownerError) {
  console.error("Failed to load owner user:", ownerError.message);
  process.exit(1);
}

if (!owner) {
  console.error(`User not found: ${OWNER_USERNAME}. Sign up or seed users first.`);
  process.exit(1);
}

const extensionKey =
  owner.extension_api_key?.trim() ||
  process.env.EXTENSION_API_KEY?.trim() ||
  randomBytes(24).toString("hex");

if (!owner.extension_api_key) {
  const { error: keyError } = await supabase
    .from("app_users")
    .update({ extension_api_key: extensionKey })
    .eq("id", owner.id);
  if (keyError) {
    console.error("Failed to set extension_api_key:", keyError.message);
    process.exit(1);
  }
  console.log("Set extension_api_key for", username);
}

const { error: appsError } = await supabase
  .from("resume_db_applications")
  .update({ user_id: owner.id })
  .is("user_id", null);

if (appsError) {
  console.error("Failed to assign applications:", appsError.message);
  process.exit(1);
}

const { error: profilesError } = await supabase
  .from("profiles")
  .update({ user_id: owner.id })
  .is("user_id", null);

if (profilesError) {
  console.error("Failed to assign profiles:", profilesError.message);
  process.exit(1);
}

const { count: totalApps } = await supabase
  .from("resume_db_applications")
  .select("id", { count: "exact", head: true })
  .eq("user_id", owner.id);

const { count: totalProfiles } = await supabase
  .from("profiles")
  .select("id", { count: "exact", head: true })
  .eq("user_id", owner.id);

console.log(`Owner: ${username} (${owner.id})`);
console.log(`Resume DB applications for owner: ${totalApps ?? 0}`);
console.log(`Profiles for owner: ${totalProfiles ?? 0}`);
console.log("\nExtension API key (X-Extension-Key):", extensionKey);
