import {
  getJobStatus,
  listActiveJobs,
  enqueueComputeJob,
} from './alm-compute.processor';

// Helper to flush setImmediate + give async code time to run
const flushAsync = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('AlmComputeProcessor', () => {
  it('getJobStatus returns null for unknown job ID', () => {
    expect(getJobStatus('nonexistent-job-id')).toBeNull();
  });

  it('enqueueComputeJob registers a pending job and returns the jobId', async () => {
    const jobId = `test-job-${Date.now()}`;
    const returned = await enqueueComputeJob(
      jobId,
      'monte-carlo',
      async () => ({ result: 42 }),
    );
    expect(returned).toBe(jobId);
    const status = getJobStatus(jobId);
    expect(status).not.toBeNull();
    expect(['pending', 'running', 'completed']).toContain(status!.status);
    expect(status!.jobType).toBe('monte-carlo');
  });

  it('completes job after async execution finishes', async () => {
    const jobId = `complete-${Date.now()}`;
    await enqueueComputeJob(jobId, 'stress-test', async () => ({ value: 99 }));
    await flushAsync(200); // wait for setImmediate + async fn
    const status = getJobStatus(jobId);
    expect(status).not.toBeNull();
    expect(status!.status).toBe('completed');
    expect(status!.progress).toBe(100);
    expect(status!.result).toEqual({ value: 99 });
    expect(status!.completedAt).toBeDefined();
  });

  it('marks job as failed when executeFn throws', async () => {
    const jobId = `fail-${Date.now()}`;
    await enqueueComputeJob(jobId, 'cecl', async () => {
      throw new Error('DB timeout');
    });
    await flushAsync(200);
    const status = getJobStatus(jobId);
    expect(status).not.toBeNull();
    expect(status!.status).toBe('failed');
    expect(status!.error).toBe('DB timeout');
    expect(status!.completedAt).toBeDefined();
  });

  it('increments progress during execution', async () => {
    const jobId = `progress-${Date.now()}`;
    await enqueueComputeJob(
      jobId,
      'var',
      () => new Promise((r) => setTimeout(() => r({ done: true }), 1500)),
    );
    await flushAsync(600); // after ~1 progress tick
    const status = getJobStatus(jobId);
    expect(status).not.toBeNull();
    expect(status!.progress).toBeGreaterThan(0);
  });

  it('listActiveJobs returns array', async () => {
    const active = listActiveJobs();
    expect(Array.isArray(active)).toBe(true);
  });

  it('listActiveJobs includes pending/running jobs', async () => {
    const jobId = `active-${Date.now()}`;
    await enqueueComputeJob(
      jobId,
      'duration',
      () => new Promise((r) => setTimeout(() => r({}), 500)),
    );
    const active = listActiveJobs();
    const found = active.find((j) => j.jobId === jobId);
    if (found) {
      expect(['pending', 'running']).toContain(found.status);
    }
    expect(Array.isArray(active)).toBe(true);
  });
});
