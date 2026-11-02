/**
 * Errors where the connection to Supabase was never made, so the request never left this
 * machine and sending it again cannot repeat a write. Anything else (a reset mid-request,
 * an HTTP error) is passed on untouched.
 */
const NOT_CONNECTED_CODES = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

const RETRIES = 2;
const RETRY_DELAY_MS = 1000;

function causeCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === "string" ? cause.code : "";
}

/**
 * fetch for the Supabase clients: tries again, twice, when the connection could not be made.
 * A slow or patchy line (a dev machine on a weak network) otherwise fails the whole page on
 * one dropped connection. Bodies that are streams cannot be sent twice and are not retried.
 */
export function fetchWithConnectRetry(
  baseFetch: typeof fetch = fetch,
  delayMs = RETRY_DELAY_MS,
): typeof fetch {
  return async (input, init) => {
    const resendable = !(init?.body instanceof ReadableStream);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await baseFetch(input, init);
      } catch (error) {
        if (!resendable || attempt >= RETRIES || !NOT_CONNECTED_CODES.has(causeCode(error))) throw error;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  };
}
