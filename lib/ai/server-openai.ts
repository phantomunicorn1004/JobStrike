import "server-only";

import OpenAI from "openai";
import { HttpsProxyAgent } from "https-proxy-agent";

/** OPENAI_PROXY = "host:port:username:password", as for the other AI features. */
function proxyAgent() {
  const config = process.env.OPENAI_PROXY?.replace(/^["']|["']$/g, "").trim();
  if (!config) return undefined;
  const [host, port, username, ...password] = config.split(":");
  if (!host || !port || !username || password.length === 0) return undefined;
  return new HttpsProxyAgent(`http://${username}:${password.join(":")}@${host}:${port}`);
}

/** The server's OpenAI client (OPENAI_API_KEY, optional OPENAI_BASE_URL and OPENAI_PROXY), or null. */
export function serverOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
  const httpAgent = proxyAgent();
  return new OpenAI({ apiKey, ...(baseURL && { baseURL }), ...(httpAgent && { httpAgent }), maxRetries: 2 });
}
