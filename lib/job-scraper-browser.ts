import "server-only";

import { chromium, type Browser } from "playwright-core";
import chromiumBinary from "@sparticuz/chromium";

const BROWSER_TIMEOUT_MS = 90_000;

export type ScrapeProxyConfig = {
  server: string;
  username?: string;
  password?: string;
};

/** Shared residential proxy for HiringCafe / Jobright scrapes. */
export function getScrapeProxyConfig(): ScrapeProxyConfig | undefined {
  const direct = process.env.HIRING_CAFE_PROXY_URL?.replace(/^["']|["']$/g, "").trim();
  if (direct) {
    try {
      const parsed = new URL(direct);
      const server = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
      const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
      const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
      if (!parsed.hostname) return undefined;
      return {
        server,
        ...(username ? { username } : {}),
        ...(password ? { password } : {}),
      };
    } catch {
      return undefined;
    }
  }

  const proxyConfig = process.env.HIRING_CAFE_PROXY?.replace(/^["']|["']$/g, "").trim();
  if (!proxyConfig) return undefined;

  const parts = proxyConfig.split(":");
  if (parts.length < 4) return undefined;

  const [host, port, username, ...passwordParts] = parts;
  const password = passwordParts.join(":");
  if (!host || !port) return undefined;

  return {
    server: `http://${host}:${port}`,
    username,
    password,
  };
}

/** @deprecated Use getScrapeProxyConfig */
export function getHiringCafeProxyConfig(): ScrapeProxyConfig | undefined {
  return getScrapeProxyConfig();
}

export async function launchScrapeBrowser(): Promise<Browser> {
  const proxy = getScrapeProxyConfig();
  const isLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_VERSION || process.env.VERCEL);

  let executablePath: string | undefined;
  let args: string[] = [];

  if (isLambda) {
    executablePath = await chromiumBinary.executablePath();
    args = chromiumBinary.args;
  }

  return chromium.launch({
    executablePath,
    args,
    headless: true,
    proxy: proxy
      ? {
          server: proxy.server,
          ...(proxy.username ? { username: proxy.username } : {}),
          ...(proxy.password ? { password: proxy.password } : {}),
        }
      : undefined,
    timeout: BROWSER_TIMEOUT_MS,
  });
}
