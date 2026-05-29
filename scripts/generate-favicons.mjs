import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const logoPath = join(root, "public", "logo.png");
const publicDir = join(root, "public");

const { width, height } = await sharp(logoPath).metadata();
const cropSize = Math.round(Math.min(width, height * 0.58));
const left = Math.round((width - cropSize) / 2);

const icon = sharp(logoPath).extract({
  left,
  top: 0,
  width: cropSize,
  height: cropSize,
});

await icon.clone().png().toFile(join(publicDir, "logo-icon.png"));

const sizes = [
  { file: "icon-light-32x32.png", size: 32 },
  { file: "icon-dark-32x32.png", size: 32 },
  { file: "apple-icon.png", size: 180 },
  { file: "favicon-32x32.png", size: 32 },
];

for (const { file, size } of sizes) {
  const png = await icon.clone().resize(size, size).png().toBuffer();
  writeFileSync(join(publicDir, file), png);
}

writeFileSync(
  join(publicDir, "favicon.ico"),
  await icon.clone().resize(32, 32).png().toBuffer(),
);

console.log(`Generated logo-icon.png and favicons from ${logoPath} (${cropSize}px crop)`);
