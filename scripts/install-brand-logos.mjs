import sharp from "sharp";
import { copyFileSync } from "fs";

const iconSrc = process.env.ICON;
const wordSrc = process.env.WORD;
const brandSrc = process.env.BRAND;

if (!iconSrc || !wordSrc || !brandSrc) {
  console.error("Missing ICON/WORD/BRAND env paths");
  process.exit(1);
}

async function trimWhite(input) {
  return sharp(input).trim({ background: "#ffffff", threshold: 12 }).png();
}

const iconBuf = await (await trimWhite(iconSrc)).toBuffer();
const wordBuf = await (await trimWhite(wordSrc)).toBuffer();

await sharp(iconBuf)
  .resize(512, 512, { fit: "contain", background: "#ffffff" })
  .png()
  .toFile("public/logo-icon.png");
await sharp(iconBuf)
  .resize(512, 512, { fit: "contain", background: "#ffffff" })
  .png()
  .toFile("public/logo.png");
await sharp(iconBuf)
  .resize(180, 180, { fit: "contain", background: "#ffffff" })
  .png()
  .toFile("public/apple-icon.png");
await sharp(iconBuf)
  .resize(32, 32, { fit: "contain", background: "#ffffff" })
  .png()
  .toFile("public/favicon-32x32.png");

copyFileSync("public/favicon-32x32.png", "public/favicon.ico");
copyFileSync("public/favicon-32x32.png", "public/icon-light-32x32.png");
copyFileSync("public/favicon-32x32.png", "public/icon-dark-32x32.png");

await sharp(wordBuf).resize({ height: 256, fit: "inside" }).png().toFile("public/logo-wordmark.png");

for (const size of [16, 32, 48, 128]) {
  await sharp(iconBuf)
    .resize(size, size, { fit: "contain", background: "#ffffff" })
    .png()
    .toFile(`jobstrike_extension/icons/icon-${size}.png`);
}

await sharp(brandSrc).jpeg({ quality: 90 }).toFile("public/brand-identity.jpg");
console.log("Brand logos installed");
