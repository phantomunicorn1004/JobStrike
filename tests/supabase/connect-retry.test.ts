import { describe, expect, it, vi } from "vitest";
import { fetchWithConnectRetry } from "@/lib/supabase/connect-retry";

function failed(code: string): TypeError {
  return Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });
}

describe("fetchWithConnectRetry", () => {
  it("tries again when the connection timed out, and returns the answer that got through", async () => {
    const ok = new Response("[]");
    const base = vi.fn()
      .mockRejectedValueOnce(failed("UND_ERR_CONNECT_TIMEOUT"))
      .mockRejectedValueOnce(failed("UND_ERR_CONNECT_TIMEOUT"))
      .mockResolvedValueOnce(ok);
    const res = await fetchWithConnectRetry(base, 0)("https://x.supabase.co/rest/v1/t", { method: "PATCH", body: "{}" });
    expect(res).toBe(ok);
    expect(base).toHaveBeenCalledTimes(3);
  });

  it("gives up after two retries", async () => {
    const base = vi.fn().mockRejectedValue(failed("UND_ERR_CONNECT_TIMEOUT"));
    await expect(fetchWithConnectRetry(base, 0)("https://x.supabase.co")).rejects.toThrow("fetch failed");
    expect(base).toHaveBeenCalledTimes(3);
  });

  it("never resends after the request may have reached the server", async () => {
    const base = vi.fn().mockRejectedValue(failed("ECONNRESET"));
    await expect(fetchWithConnectRetry(base, 0)("https://x.supabase.co", { method: "POST", body: "{}" })).rejects.toThrow();
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("does not resend a stream body, which can only be read once", async () => {
    const base = vi.fn().mockRejectedValue(failed("UND_ERR_CONNECT_TIMEOUT"));
    const body = new ReadableStream();
    await expect(fetchWithConnectRetry(base, 0)("https://x.supabase.co", { method: "POST", body })).rejects.toThrow();
    expect(base).toHaveBeenCalledTimes(1);
  });
});
