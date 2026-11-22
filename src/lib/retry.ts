/**
 * Retry policy, tuned by load-testing api.ark.io (see README "API behaviour"):
 *
 * - Successful calls take ~0.1-0.9s (p50), up to ~3.3s for heavy queries.
 * - When a query is too heavy the server answers 500 after ~3.2s (its own query timeout).
 *   A quick retry sometimes succeeds; more than two attempts only adds waiting.
 * - Network errors / timeouts (10s, set in Rust) get two short retries.
 * - 429 (200 requests per 60s per IP) comes with Retry-After in seconds. Retrying sooner is
 *   pointless, so the host is put on cooldown: short waits (<= 3s) are absorbed, longer ones
 *   fail fast with a RateLimitError that says when to try again.
 * - Background work (block watcher, periodic refresh) does not retry at all: the next poll
 *   catches up, and it must not compete with what the user is looking at.
 */

export type RetryMode = "interactive" | "background";

const PLAN: Record<RetryMode, { server: number[]; network: number[] }> = {
  interactive: { server: [300, 1000], network: [500, 1500] },
  background: { server: [], network: [] },
};

/** Longest rate-limit wait that is absorbed silently instead of reported. */
const MAX_SILENT_WAIT_MS = 3000;

export class RateLimitError extends Error {
  status = 429;
  constructor(public seconds: number) {
    super(`The API rate limit was reached. Try again in ${Math.max(1, Math.ceil(seconds))}s.`);
  }
}

// host -> epoch ms until which requests should not be sent
const cooldown = new Map<string, number>();

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Record a 429 for this URL's host. */
export function noteRateLimit(url: string, retryAfterSeconds?: number | null) {
  const secs = retryAfterSeconds && retryAfterSeconds > 0 ? retryAfterSeconds : 30;
  const until = Date.now() + secs * 1000;
  const host = hostOf(url);
  cooldown.set(host, Math.max(cooldown.get(host) ?? 0, until));
}

/** ms left on this host's rate-limit cooldown (0 when free). */
export function cooldownLeft(url: string): number {
  const until = cooldown.get(hostOf(url)) ?? 0;
  return Math.max(0, until - Date.now());
}

/** Wait out a short cooldown, or fail fast with a RateLimitError for a long one. */
export async function respectCooldown(url: string, mode: RetryMode = "interactive") {
  const left = cooldownLeft(url);
  if (left === 0) return;
  if (mode === "background" || left > MAX_SILENT_WAIT_MS) throw new RateLimitError(left / 1000);
  await sleep(left);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `fn`, retrying transient failures according to `mode`. 4xx errors (except 429) fail immediately. */
export async function withRetry<T>(fn: () => Promise<T>, mode: RetryMode = "interactive"): Promise<T> {
  const plan = PLAN[mode];
  let serverTries = 0;
  let networkTries = 0;
  let rateTries = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e: any) {
      if (e instanceof RateLimitError) {
        // a short wait is worth one silent retry; anything longer goes to the caller
        if (mode === "interactive" && rateTries === 0 && e.seconds * 1000 <= MAX_SILENT_WAIT_MS) {
          rateTries++;
          await sleep(e.seconds * 1000 + 100);
          continue;
        }
        throw e;
      }
      const status: number | undefined = e?.status;
      if (status === undefined) {
        if (networkTries >= plan.network.length) throw e;
        await sleep(plan.network[networkTries++]);
      } else if (status >= 500) {
        if (serverTries >= plan.server.length) throw e;
        await sleep(plan.server[serverTries++]);
      } else {
        throw e; // 4xx: retrying will not help
      }
    }
  }
}
