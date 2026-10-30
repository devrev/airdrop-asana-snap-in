/** Parse Retry-After seconds, or return an error for a valid delay outside safe integer range. */
export function parseRetryAfter(value: unknown, nowMs: number = Date.now()): number | { error: { message: string } } {
  if (typeof value !== 'string') return 60;
  const header = value.trim();
  if (/^\d+$/.test(header)) {
    const seconds = Number(header);
    if (!Number.isSafeInteger(seconds)) {
      // RFC delay-seconds has no size limit. Falling back would shorten a valid server wait.
      return { error: { message: 'Cannot honor Retry-After: valid delay-seconds exceeds the safe integer range; refusing to retry early.' } };
    }
    return seconds;
  }

  // Limit Date.parse to HTTP-date wire forms, including the two obsolete forms in RFC 9110 §5.6.7.
  const httpDate = /^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/;
  if (!httpDate.test(header)) return 60;
  // HTTP dates are always UTC, including asctime's obsolete form without a zone suffix.
  const dateMs = Date.parse(header.endsWith(' GMT') ? header : `${header} GMT`);
  return Number.isFinite(dateMs) ? Math.max(0, Math.ceil((dateMs - nowMs) / 1000)) : 60;
}
