import { WorkerMessageType } from '../../shared/types';

/**
 * A request submitted to the worker pool. `kind` selects which handler runs on
 * the worker. Each job is executed by exactly one worker at a time, so an
 * expensive schedule generation occupies a single worker while the remaining
 * pool workers serve concurrent rearrange edits without waiting.
 */
export interface PoolJob {
  kind: 'GENERATE_SCHEDULE' | 'REARRANGE';
  payload: unknown;
  /** Fired for PROGRESS and other intermediate messages belonging to this job. */
  onProgress?: (payload: unknown) => void;
}

interface QueuedJob {
  job: PoolJob;
  resolve: (payload: unknown) => void;
  reject: (err: unknown) => void;
}

interface ActiveEntry {
  job: PoolJob;
  settle: QueuedJob | null;
}

/**
 * A small, role-agnostic pool of schedule-generation workers.
 *
 * Correlation is by ownership: each worker runs at most one job concurrently,
 * so every message it posts back is routed to that worker's active job. This
 * lets generation and rearrangement run truly in parallel across the pool
 * ("the more - the better"), while keeping the worker message protocol unchanged
 * (no job ids need to travel over the wire).
 *
 * Boot and jobs are serialized per worker: INIT is posted at spawn, and the
 * worker is only handed a job once it has reported READY, so progress/result
 * messages never race the boot message.
 */
class WorkerPool {
  private workers: Worker[] = [];
  private waiting: Map<Worker, boolean> = new Map(); // worker -> has reported READY
  private active: Map<Worker, ActiveEntry> = new Map();
  private queue: QueuedJob[] = [];
  private readyWaiters: (() => void)[] = [];
  private version: string | null = null;
  private buildVersion: string | null = null;

  constructor(private size: number) {}

  get poolSize(): number {
    return this.size;
  }

  getVersion(): string | null {
    return this.version;
  }

  getBuildVersion(): string | null {
    return this.buildVersion;
  }

  idleCount(): number {
    return this.workers.filter((w) => !this.active.has(w)).length;
  }

  /** Spawn the pool (once) and resolve when every worker has reported READY. */
  ready(): Promise<void> {
    this.ensure();
    if (this.isReady()) return Promise.resolve();
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  private isReady(): boolean {
    return this.workers.length > 0 && this.workers.every((w) => this.waiting.get(w));
  }

  private ensure(): void {
    if (this.workers.length > 0) return;
    for (let i = 0; i < this.size; i++) this.spawn();
  }

  private spawn(): void {
    const worker = new Worker(new URL('../../worker/worker.ts', import.meta.url), {
      type: 'module',
    });
    this.workers.push(worker);
    this.waiting.set(worker, false);
    worker.onmessage = (event: MessageEvent) => this.onMessage(worker, event.data || {});
    worker.onerror = (event: ErrorEvent) => {
      const entry = this.active.get(worker);
      this.active.delete(worker);
      const msg = { type: 'ERROR' as WorkerMessageType, payload: { message: event.message } };
      this.dispatch(msg, entry);
    };
    worker.postMessage({ type: 'INIT' });
  }

  private onMessage(worker: Worker, msg: { type: WorkerMessageType; payload?: unknown }): void {
    // Readiness handshake: a worker is only usable after its first READY.
    if (!this.waiting.get(worker)) {
      if (msg.type === 'READY') {
        this.waiting.set(worker, true);
        if (!this.version) this.version = (msg.payload as any)?.version ?? this.version;
        if (!this.buildVersion) this.buildVersion = (msg.payload as any)?.buildVersion ?? this.buildVersion;
        this.maybeReady();
        this.pump();
      }
      return;
    }

    const entry = this.active.get(worker);
    if (!entry) return;

    if (msg.type === 'PROGRESS') {
      entry.job.onProgress?.(msg.payload);
      return;
    }
    if (msg.type === 'RESULT' || msg.type === 'REARRANGE_RESULT' || msg.type === 'ERROR') {
      this.active.delete(worker);
      this.dispatch(msg, entry);
      this.pump();
    }
  }

  private dispatch(msg: { type: WorkerMessageType; payload?: unknown }, entry: ActiveEntry | undefined): void {
    if (!entry) return;
    if (msg.type === 'ERROR') {
      entry.settle?.reject(msg.payload);
    } else {
      entry.settle?.resolve(msg.payload);
    }
  }

  private maybeReady(): void {
    if (!this.isReady()) return;
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w();
  }

  private pump(): void {
    for (const worker of this.workers) {
      if (!this.waiting.get(worker)) continue; // not booted yet
      if (this.active.has(worker)) continue; // busy
      if (this.queue.length === 0) continue;
      const queued = this.queue.shift()!;
      this.active.set(worker, { job: queued.job, settle: queued });
      worker.postMessage({ type: queued.job.kind, payload: queued.job.payload });
    }
  }

  /**
   * Run a job and resolve with its final payload (RESULT / REARRANGE_RESULT).
   * Rejects if the worker reports ERROR. Jobs execute in parallel across the
   * pool, so a long generation does not block other jobs' workers.
   */
  run(job: PoolJob): Promise<unknown> {
    this.ensure();
    return new Promise<unknown>((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      this.pump();
    });
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.waiting.clear();
    this.active.clear();
    this.queue = [];
    this.readyWaiters = [];
    this.version = null;
    this.buildVersion = null;
  }
}

/**
 * Process-wide worker pool shared by the app shell (schedule generation) and the
 * inline editor (rearrange). Sized to one worker per available core (min 2), so
 * a generation on one core leaves the other cores free for interactive edits.
 */
function desiredSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
  return Math.max(2, cores);
}

export const workerPool = new WorkerPool(desiredSize());