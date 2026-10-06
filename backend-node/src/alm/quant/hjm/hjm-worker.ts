/**
 * Async wrapper for the HJM Monte Carlo worker thread.
 *
 * Spins up a Worker for each simulation (no pool — CerniQ processes
 * O(1) concurrent Monte Carlo requests per cooperativa). Worker startup
 * adds ~10ms overhead, negligible vs. the 200-500ms simulation itself.
 *
 * Falls back to in-process execution if worker_threads are unavailable
 * (e.g., test environment without --experimental-vm-modules).
 */
import { Worker } from 'worker_threads';
import { resolve } from 'path';
import { runHJMMonteCarlo } from './monte-carlo';
import type { HJMMonteCarloInput, HJMMonteCarloResult } from './types';

const WORKER_PATH = resolve(__dirname, 'hjm-worker.thread.js');
const WORKER_TIMEOUT_MS = 30_000;

export async function runHJMMonteCarloAsync(
  input: HJMMonteCarloInput,
): Promise<HJMMonteCarloResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    let settled = false;

    // Coerce any thrown value to an Error so ESLint's
    // prefer-promise-reject-errors rule is satisfied and so downstream
    // consumers get a consistent shape (message, stack).
    const asError = (v: unknown): Error =>
      v instanceof Error ? v : new Error(String(v));

    try {
      worker = new Worker(WORKER_PATH);
    } catch {
      // Fallback: run in-process if Worker fails (test env, bundled builds)
      try {
        resolve(runHJMMonteCarlo(input));
      } catch (err) {
        reject(asError(err));
      }
      return;
    }

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        // worker.terminate() returns Promise<number> (exit code). We
        // don't need the exit code here — the timeout already decided
        // this run is dead. `void` marks the floating promise as
        // intentional fire-and-forget, silencing no-floating-promises.
        void worker.terminate();
        reject(
          new Error(
            `HJM Monte Carlo worker timed out after ${WORKER_TIMEOUT_MS}ms`,
          ),
        );
      }
    }, WORKER_TIMEOUT_MS);

    worker.on(
      'message',
      (msg: { ok: boolean; result?: HJMMonteCarloResult; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        void worker.terminate();
        if (msg.ok && msg.result) {
          resolve(msg.result);
        } else {
          reject(new Error(msg.error ?? 'HJM worker returned error'));
        }
      },
    );

    worker.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      // Fallback: run in-process
      try {
        resolve(runHJMMonteCarlo(input));
      } catch (fallbackErr) {
        reject(asError(fallbackErr));
      }
    });

    worker.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`HJM worker exited with code ${code}`));
      }
    });

    worker.postMessage(input);
  });
}
