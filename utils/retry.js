// utils/retry.js
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function retryFor(
  fn,
  {
    maxMs = 7000,
    startDelay = 200,
    factor = 1.7,
    maxDelay = 1500,
    maxAttempts = 8,
    shouldRetry = (err, out) => !err && !out, // default: retry when falsy result, no error
    onAttempt = (_info) => {}
  } = {}
) {
  const t0 = Date.now();
  let delay = startDelay;
  let attempt = 0;
  let lastErr;

  while (attempt < maxAttempts && (Date.now() - t0) < maxMs) {
    attempt++;
    try {
      const out = await fn();
      onAttempt({ attempt, out });
      if (!shouldRetry(null, out)) return out;
    } catch (err) {
      lastErr = err;
      onAttempt({ attempt, error: err });
      if (!shouldRetry(err)) throw err; // fatal → stop immediately
    }
    // backoff + small jitter to avoid thundering herd
    const jitter = Math.floor(Math.random() * (delay * 0.2));
    await wait(delay + jitter);
    delay = Math.min(Math.round(delay * factor), maxDelay);
  }

  // if last attempt threw a non-retryable error, surface it
  if (lastErr && !shouldRetry(lastErr)) throw lastErr;
  return null;
}

module.exports = { retryFor, wait };