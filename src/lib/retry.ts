/** Retry transient failures (network errors, 5xx, 429) with backoff. 4xx errors fail immediately. */
export async function withRetry<T>(fn: () => Promise<T>, delays = [800, 2000, 4500]): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const status: number | undefined = e?.status;
      const transient = status === undefined || status >= 500 || status === 429;
      if (!transient || attempt === delays.length) break;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw lastErr;
}
