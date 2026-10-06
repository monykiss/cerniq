/**
 * HJM Monte Carlo worker thread.
 *
 * Runs the CPU-intensive Monte Carlo simulation off the main event loop
 * so SSE streams, HTTP responses, and WebSocket connections stay responsive.
 *
 * Protocol: receives HJMMonteCarloInput via parentPort, returns HJMMonteCarloResult.
 */
import { parentPort } from 'worker_threads';
import { runHJMMonteCarlo } from './monte-carlo';
import type { HJMMonteCarloInput } from './types';

if (!parentPort) {
  throw new Error('hjm-worker.thread.ts must be run as a Worker thread');
}

parentPort.on('message', (input: HJMMonteCarloInput) => {
  try {
    const result = runHJMMonteCarlo(input);
    parentPort!.postMessage({ ok: true, result });
  } catch (err) {
    parentPort!.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
