/**
 * Generate Chrome extension PNG icons from the JobStrike website logo.
 *
 *   node scripts/generate-icons.mjs
 */
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(root, "..");
const outDir = join(root, "icons");
const sourcePng = join(repoRoot, "public", "logo-icon.png");
const sourceSvg = join(repoRoot, "public", "logo-icon.svg");

let iconInput = sourcePng;
if (!existsSync(iconInput)) {
  iconInput = join(outDir, "icon.svg");
}

for (const size of [16, 32, 48, 128]) {
  const outPath = join(outDir, `icon-${size}.png`);
  await sharp(iconInput).resize(size, size).png().toFile(outPath);
  console.log(`wrote ${outPath}`);
}

if (existsSync(sourceSvg)) {
  copyFileSync(sourceSvg, join(outDir, "icon.svg"));
}
