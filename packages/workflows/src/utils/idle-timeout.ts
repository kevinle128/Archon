/**
 * Async generator idle timeout utility.
 *
 * Wraps an async generator with an idle timeout — if no value is yielded
 * within `timeoutMs`, the wrapper returns normally, converting a hang
 * into a clean exit.
 *
 * This is the primary defense against subprocess hangs where the AI process
 * completes its work but fails to exit (stuck MCP connection, dangling child
 * process, etc.). Without this, the `for await` loop blocks indefinitely and
 * `step_completed` / `node_completed` is never recorded.
 */

/**
 * Default idle timeout: 30 minutes.
 *
 * This is a deadlock detector, not a work limiter. The timer resets on every
 * message type, so it only fires when the subprocess goes completely silent.
 * 30 minutes is generous enough to never interrupt legitimate work while still
 * catching genuine hangs. Per-node `idle_timeout` overrides this default.
 */
export const STEP_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Sentinel value to distinguish idle timeout from normal generator completion */
const IDLE_TIMEOUT_SENTINEL = Symbol('IDLE_TIMEOUT');

/** Sentinel value to distinguish an external abort from normal generator completion */
const EXTERNAL_ABORT_SENTINEL = Symbol('EXTERNAL_ABORT');

/**
 * Wraps an async generator with an idle timeout. If no value is yielded within
 * `timeoutMs`, the wrapper returns normally — converting a hang into a clean exit.
 *
 * When `shouldResetTimer` is provided and returns `false` for a yielded value, the
 * timer is NOT reset — it keeps counting from the previous reset point. Most callers
 * should omit this parameter (every message resets the timer, which is the correct
 * default for a deadlock detector).
 *
 * `externalSignal` (optional) races every `generator.next()` call against that
 * signal's own `abort` event, in addition to the idle timer — so a caller that
 * decides to abort the SAME `AbortController` it already handed the provider as
 * `abortSignal`, for a reason unrelated to idle time (e.g. a decoupled
 * cancellation-status poller), also gets a prompt, clean exit instead of
 * depending on the underlying provider to notice its own abort and settle the
 * pending `.next()` — which may never happen if the provider ignores the
 * signal mid-tool-call. Already-aborted-before-first-call is honored too.
 *
 * When either condition fires:
 * 1. `onTimeout` runs only for the idle-timeout case (use it to abort the subprocess and log)
 * 2. The pending `generator.next()` promise gets a `.catch()` to prevent unhandled rejection
 * 3. We do NOT call `generator.return()` — it would block on the pending `.next()`
 * 4. The subprocess is cleaned up asynchronously via the abort signal (from `onTimeout`,
 *    or from whatever external code aborted `externalSignal`'s controller)
 *
 * @param generator - The async generator to wrap
 * @param timeoutMs - Maximum idle time in milliseconds before terminating
 * @param onTimeout - Optional callback invoked when idle timeout fires (before return)
 * @param shouldResetTimer - Optional predicate; return false to NOT reset the timer for a value
 * @param externalSignal - Optional signal; its `abort` event ends the wrapper immediately
 */
export async function* withIdleTimeout<T>(
  generator: AsyncGenerator<T>,
  timeoutMs: number,
  onTimeout?: () => void,
  shouldResetTimer?: (value: T) => boolean,
  externalSignal?: AbortSignal
): AsyncGenerator<T> {
  let timedOut = false;
  let externallyAborted = false;
  let timerStartedAt = Date.now();

  // Built once, not per-iteration: `abort` fires exactly once on a given
  // signal, so one listener (removed on the way out) covers every race below,
  // including a signal that aborts while `nextPromise`/`timeoutPromise` are
  // already in flight for the current iteration.
  let externalAbortPromise: Promise<typeof EXTERNAL_ABORT_SENTINEL> | undefined;
  let removeExternalAbortListener: (() => void) | undefined;
  if (externalSignal !== undefined) {
    if (externalSignal.aborted) {
      externalAbortPromise = Promise.resolve(EXTERNAL_ABORT_SENTINEL);
    } else {
      externalAbortPromise = new Promise<typeof EXTERNAL_ABORT_SENTINEL>(resolve => {
        const onAbort = (): void => {
          resolve(EXTERNAL_ABORT_SENTINEL);
        };
        externalSignal.addEventListener('abort', onAbort, { once: true });
        removeExternalAbortListener = (): void => {
          externalSignal.removeEventListener('abort', onAbort);
        };
      });
    }
  }

  try {
    while (true) {
      const elapsed = Date.now() - timerStartedAt;
      const remaining = Math.max(0, timeoutMs - elapsed);

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<typeof IDLE_TIMEOUT_SENTINEL>(resolve => {
        timer = setTimeout(() => {
          resolve(IDLE_TIMEOUT_SENTINEL);
        }, remaining);
      });

      // Start waiting for the next value from the generator
      const nextPromise = generator.next();

      const racers: Promise<
        typeof IDLE_TIMEOUT_SENTINEL | typeof EXTERNAL_ABORT_SENTINEL | IteratorResult<T>
      >[] = [nextPromise, timeoutPromise];
      if (externalAbortPromise !== undefined) racers.push(externalAbortPromise);

      const result = await Promise.race(racers);
      clearTimeout(timer);

      if (result === EXTERNAL_ABORT_SENTINEL) {
        externallyAborted = true;
        // Prevent unhandled rejection when the provider is torn down via the signal
        nextPromise.catch((_err: unknown) => {
          // Intentional: swallow rejection from the aborted stream
        });
        return;
      }

      if (result === IDLE_TIMEOUT_SENTINEL) {
        timedOut = true;
        // Prevent unhandled rejection when the subprocess is aborted via onTimeout
        nextPromise.catch((_err: unknown) => {
          // Intentional: swallow rejection from aborted subprocess
        });
        onTimeout?.();
        return;
      }

      if (result.done) return;

      // Reset the timer unless the predicate says not to
      if (!shouldResetTimer || shouldResetTimer(result.value)) {
        timerStartedAt = Date.now();
      }

      yield result.value;
    }
  } finally {
    removeExternalAbortListener?.();
    if (!timedOut && !externallyAborted) {
      // Normal exit (generator exhausted or consumer broke out) — safe to clean up
      try {
        await generator.return(undefined as never);
      } catch (e) {
        // Generator cleanup errors are non-fatal but worth logging for diagnostics
        // Dynamic import to avoid circular deps — this module has zero @archon/* imports
        try {
          const { createLogger } = await import('@archon/paths');
          createLogger('idle-timeout').warn(
            { err: e as Error },
            'idle_timeout.generator_cleanup_failed'
          );
        } catch {
          // If logger is unavailable, swallow — cleanup is best-effort
        }
      }
    }
    // If timed out or externally aborted, don't call generator.return() — it
    // would hang on the pending .next(). The abort (from onTimeout, or from
    // whatever external code aborted externalSignal's controller) causes the
    // pending .next() to reject (caught by nextPromise.catch above) and the
    // generator to finalize on its own.
  }
}
