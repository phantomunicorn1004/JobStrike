import { ProxyAgent } from "undici";
import { loadEnvFiles } from "./load-env.mjs";

loadEnvFiles();

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://hiringcafe.com/",
};

function getProxyUrl() {
  const direct = process.env.HIRING_CAFE_PROXY_URL?.replace(/^["']|["']$/g, "").trim();
  if (direct) return direct;

  const proxyConfig = process.env.HIRING_CAFE_PROXY?.replace(/^["']|["']$/g, "").trim();
  if (!proxyConfig) return undefined;

  const parts = proxyConfig.split(":");
  if (parts.length < 4) return undefined;

  const [host, port, username, ...passwordParts] = parts;
  const password = passwordParts.join(":");
  return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
}

const proxyUrl = getProxyUrl();
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

if (proxyUrl) {
  console.log("Using proxy:", proxyUrl.replace(/:[^:@/]+@/, ":***@"));
} else {
  console.log("No proxy configured (set HIRING_CAFE_PROXY_URL or HIRING_CAFE_PROXY in .env.local)");
}

async function req(url, extra = {}) {
  const response = await fetch(url, {
    headers: { ...HEADERS, ...extra },
    redirect: "follow",
    ...(dispatcher ? { dispatcher } : {}),
  });
  const text = await response.text();
  return { status: response.status, url: response.url, len: text.length, text };
}

const home = await req("https://hiringcafe.com/", { Accept: "text/html" });
console.log("home status", home.status, "len", home.len);

const nextDataMatch = home.text.match(
  /<script id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i,
);
if (nextDataMatch) {
  const payload = JSON.parse(nextDataMatch[1]);
  const buildId = payload.buildId;
  console.log("buildId", buildId);
  const searchState = encodeURIComponent(
    JSON.stringify({
      dateFetchedPastNDays: 3,
      sortBy: "date",
      jobTitleQuery: "Software Engineer",
    }),
  );
  const dataUrl = `https://hiringcafe.com/_next/data/${buildId}/index.json?searchState=${searchState}&page=0`;
  const data = await req(dataUrl, { Accept: "*/*", "x-nextjs-data": "1" });
  console.log("data status", data.status, "len", data.len);
  try {
    const json = JSON.parse(data.text);
    const hits = json?.pageProps?.ssrHits?.length ?? 0;
    console.log("ssrHits", hits, "total", json?.pageProps?.ssrTotalCount);
  } catch {
    console.log("data preview", data.text.slice(0, 300));
  }
} else {
  console.log("no __NEXT_DATA__, preview:", home.text.slice(0, 300));
}
