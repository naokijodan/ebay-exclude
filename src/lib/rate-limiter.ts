import pLimit from 'p-limit';

type ProgressCb = (info: { active: number; completed: number; pending: number }) => void;

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

class RateLimiter {
  private limit;
  private minIntervalMs: number;
  private windowCap: number;
  private timestamps: number[] = [];
  private lastStart = 0;
  private active = 0;
  private completed = 0;
  private progressCb?: ProgressCb;

  constructor(concurrency = 2, minIntervalMs = 6000, windowCap = 150) {
    this.limit = pLimit(concurrency);
    this.minIntervalMs = minIntervalMs;
    this.windowCap = windowCap;
  }

  onProgress(cb: ProgressCb) {
    this.progressCb = cb;
  }

  private emit() {
    this.progressCb?.({ active: this.active, completed: this.completed, pending: Math.max(this.timestamps.length - this.completed - this.active, 0) });
  }

  private sleep(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
  }

  private now() {
    return Date.now();
  }

  private pruneWindow(now: number) {
    const cutoff = now - WINDOW_MS;
    while (this.timestamps.length && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }

  private async gateStart() {
    while (true) {
      const now = this.now();
      this.pruneWindow(now);
      const sinceLast = now - this.lastStart;
      const needInterval = this.minIntervalMs - sinceLast;
      const needWindow = this.timestamps.length >= this.windowCap ? this.timestamps[0] + WINDOW_MS - now : 0;
      const waitFor = Math.max(0, needInterval, needWindow);
      if (waitFor > 0) {
        await this.sleep(waitFor);
        continue;
      }
      // record start
      this.lastStart = this.now();
      this.timestamps.push(this.lastStart);
      break;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    return this.limit(async () => {
      await this.gateStart();
      this.active++;
      this.emit();
      try {
        let attempt = 0;
        while (true) {
          try {
            const result = await fn();
            return result;
          } catch (err: any) {
            // Handle 429 with Retry-After
            const status = err?.status ?? err?.code;
            if (status === 429) {
              const ra = Number(err?.retryAfter ?? 0);
              const wait = (isFinite(ra) && ra > 0 ? ra : 10) * 1000; // default 10s
              await this.sleep(wait);
              attempt++;
              if (attempt > 5) throw err;
              continue;
            }
            throw err;
          }
        }
      } finally {
        this.active--;
        this.completed++;
        this.emit();
      }
    });
  }
}

const limiter = new RateLimiter();

export function onRateProgress(cb: ProgressCb) {
  limiter.onProgress(cb);
}

export function runWithRateLimit<T>(fn: () => Promise<T>) {
  return limiter.run(fn);
}

