/**
 * Seed default administrator. Run after create-app-users-table.sql
 *
 *   npm run seed:admin
 *   node scripts/seed-admin-user.mjs
 *   node scripts/seed-admin-user.mjs --reset-password
 *
 * Reads Supabase vars from `.env.local` / `.env` (same as Next.js).
 * The password comes from DEFAULT_ADMIN_PASSWORD; without it a random one is made and printed once.
 * Never write a password in this file: the repository can be read by others.
 */
import { createClient } from "@supabase/supabase-js";
import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { loadEnvFiles, projectRoot } from "./load-env.mjs";

loadEnvFiles();

const scryptAsync = promisify(scrypt);
const USERNAME = "ideapulse@remote.helper.com";
const givenPassword = process.env.DEFAULT_ADMIN_PASSWORD?.trim();
const DEFAULT_PASSWORD = givenPassword || randomBytes(18).toString("base64url");

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!url || !key) {
  console.error(
    "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY\n\n" +
      `Create ${projectRoot}\\.env.local with:\n\n` +
      "  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co\n" +
      "  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key\n\n" +
      "Find both in Supabase → Project Settings → API.",
  );
  process.exit(1);
}

const resetPassword = process.argv.includes("--reset-password");

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const username = USERNAME.trim().toLowerCase();
const { data: existing } = await supabase
  .from("app_users")
  .select("id")
  .eq("username", username)
  .maybeSingle();

if (existing) {
  if (!resetPassword) {
    console.log("Default admin already exists:", username);
    console.log("Run with --reset-password to update the admin password.");
    process.exit(0);
  }

  const password_hash = await hashPassword(DEFAULT_PASSWORD);
  const { error } = await supabase
    .from("app_users")
    .update({ password_hash, role: "admin", updated_at: new Date().toISOString() })
    .eq("id", existing.id);

  if (error) {
    console.error("Failed to reset admin password:", error.message);
    process.exit(1);
  }

  console.log("Reset default admin password:", username);
  if (!givenPassword) console.log("New password (shown once, keep it safe):", DEFAULT_PASSWORD);
  process.exit(0);
}

const password_hash = await hashPassword(DEFAULT_PASSWORD);
const { error } = await supabase.from("app_users").insert({
  username,
  password_hash,
  role: "admin",
});

if (error) {
  console.error("Failed to seed admin:", error.message);
  process.exit(1);
}

console.log("Created default admin:", username);
if (!givenPassword) console.log("Password (shown once, keep it safe):", DEFAULT_PASSWORD);
