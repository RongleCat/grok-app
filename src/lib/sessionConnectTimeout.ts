/**
 * Client deadline for `session_connect`.
 *
 * Host wall-clock is 90s and now includes `connect_lock` wait. If Host IPC
 * itself never returns (wedged runtime), the UI must still drop 连接中.
 * Stay slightly above the Host budget so a real Host timeout wins.
 */
export const SESSION_CONNECT_CLIENT_TIMEOUT_MS = 100_000;

export function sessionConnectTimeoutError(
  budgetMs = SESSION_CONNECT_CLIENT_TIMEOUT_MS,
): Error {
  const secs = Math.max(1, Math.round(budgetMs / 1000));
  return new Error(`CONNECT_FAILED: connect timed out after ${secs}s`);
}

export function withDeadline<T>(
  promise: Promise<T>,
  budgetMs: number,
  onTimeout: () => Error,
): Promise<T> {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(onTimeout());
    }, budgetMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
