/**
 * Word-by-word "typewriter" reveal for streamed answers.
 *
 * The backend streams one word (plus its trailing whitespace) per SSE `token` event, but network
 * delivery is bursty. Incoming words go into a FIFO queue and a driver reveals them at a smooth,
 * adaptive cadence:
 *   - a small backlog reveals one word every ~45 ms, easing towards ~25 ms as the backlog grows;
 *   - a large backlog reveals several words per tick so the display never lags far behind;
 *   - once the stream is complete (`finish()`), the rest drains in roughly `finishTicks` fast ticks.
 *
 * Everything here is framework-free and deterministic (timers and clock are injectable) so it can be
 * unit-tested; React wiring lives in hooks/use-chat-controller.ts.
 */

export interface TypewriterTuning {
  /** Delay between words when the backlog is tiny (ms). */
  slowMs: number;
  /** Delay between words once the backlog reaches `fastBacklog` (ms). */
  fastMs: number;
  /** Backlog at which the cadence reaches `fastMs`. */
  fastBacklog: number;
  /** Above this backlog, several words are revealed per tick (ceil(backlog / catchUpBacklog)). */
  catchUpBacklog: number;
  /** Delay between ticks while finishing after the stream completed (ms). */
  finishMs: number;
  /** While finishing, the remaining backlog is emptied in about this many ticks. */
  finishTicks: number;
}

export const TYPEWRITER_TUNING: TypewriterTuning = {
  slowMs: 45,
  fastMs: 25,
  fastBacklog: 8,
  catchUpBacklog: 12,
  finishMs: 12,
  finishTicks: 10,
};

/**
 * Split a streamed delta into reveal units: each word keeps its trailing whitespace and any
 * leading whitespace stays attached to the first word, so joining the units reproduces the input.
 */
export function tokenizeDelta(delta: string): string[] {
  if (!delta) return [];
  // `\s*\S+\s*` absorbs leading whitespace into the first unit, so the units always re-join losslessly.
  return delta.match(/\s*\S+\s*/g) ?? [delta]; // whitespace-only delta (e.g. a paragraph break)
}

/** FIFO of reveal units. */
export class WordQueue {
  private units: string[] = [];
  private head = 0;

  push(delta: string): void {
    for (const unit of tokenizeDelta(delta)) this.units.push(unit);
  }

  get size(): number {
    return this.units.length - this.head;
  }

  /** Remove and return up to `count` units, joined. */
  take(count: number): string {
    const n = Math.max(0, Math.min(count, this.size));
    const out = this.units.slice(this.head, this.head + n).join("");
    this.head += n;
    if (this.head > 256 && this.head * 2 > this.units.length) {
      this.units = this.units.slice(this.head);
      this.head = 0;
    }
    return out;
  }

  /** Remove and return everything still queued. */
  drain(): string {
    return this.take(this.size);
  }

  clear(): void {
    this.units = [];
    this.head = 0;
  }
}

export interface TickPlan {
  /** Units to reveal on this tick. */
  count: number;
  /** Delay before the next tick (ms). */
  delayMs: number;
}

/**
 * How many words to reveal now and how long to wait before the next tick. While finishing, the driver
 * keeps the first finishing count fixed so the remaining backlog empties in about `finishTicks` ticks.
 */
export function planTick(backlog: number, finishing: boolean, tuning: TypewriterTuning = TYPEWRITER_TUNING): TickPlan {
  if (backlog <= 0) return { count: 0, delayMs: tuning.slowMs };
  if (finishing) {
    return { count: Math.max(1, Math.ceil(backlog / tuning.finishTicks)), delayMs: tuning.finishMs };
  }
  const t = Math.min(1, Math.max(0, (backlog - 1) / Math.max(1, tuning.fastBacklog - 1)));
  const delayMs = Math.round(tuning.slowMs - (tuning.slowMs - tuning.fastMs) * t);
  const count = backlog <= tuning.catchUpBacklog ? 1 : Math.ceil(backlog / tuning.catchUpBacklog);
  return { count, delayMs };
}

export interface TypewriterOptions {
  /** Called with the newly revealed text (append it to what is displayed). */
  onReveal: (text: string) => void;
  /** Reveal immediately without queuing (prefers-reduced-motion). */
  instant?: boolean;
  tuning?: Partial<TypewriterTuning>;
  /** Injectable timer + clock (default: setTimeout / clearTimeout / Date.now). */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  now?: () => number;
}

export interface Typewriter {
  /** Queue a streamed delta. */
  push: (delta: string) => void;
  /** The stream is complete: drain the rest quickly. Resolves once everything is revealed. */
  finish: () => Promise<void>;
  /** Reveal everything still queued right now (stop / error). */
  flush: () => void;
  /** Stop all timers and drop the queue; pending `finish()` promises resolve. */
  dispose: () => void;
  readonly backlog: number;
}

export function createTypewriter(options: TypewriterOptions): Typewriter {
  const tuning: TypewriterTuning = { ...TYPEWRITER_TUNING, ...options.tuning };
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const now = options.now ?? (() => Date.now());

  const queue = new WordQueue();
  let timer: unknown = null;
  let finishing = false;
  let disposed = false;
  let lastRevealAt = Number.NEGATIVE_INFINITY;
  let waiters: Array<() => void> = [];

  const settle = () => {
    if (queue.size > 0) return;
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  };

  const clearTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };

  /** Words per tick while finishing, fixed when finish() is called so the drain is linear. */
  let finishRate = 1;

  const plan = (): TickPlan => {
    const p = planTick(queue.size, finishing, tuning);
    return finishing && p.count > 0 ? { count: Math.max(p.count, finishRate), delayMs: p.delayMs } : p;
  };

  const tick = () => {
    timer = null;
    if (disposed) return;
    const { count } = plan();
    if (count > 0) {
      lastRevealAt = now();
      options.onReveal(queue.take(count));
    }
    if (queue.size > 0) timer = schedule(tick, plan().delayMs);
    else settle();
  };

  /** Start ticking if idle, respecting the cadence since the last reveal. */
  const kick = () => {
    if (timer !== null || disposed || queue.size === 0) return;
    const wait = plan().delayMs - (now() - lastRevealAt);
    if (wait <= 0) tick();
    else timer = schedule(tick, wait);
  };

  return {
    push(delta) {
      if (disposed || !delta) return;
      if (options.instant) {
        options.onReveal(delta);
        return;
      }
      queue.push(delta);
      kick();
    },
    finish() {
      finishing = true;
      if (disposed || queue.size === 0) return Promise.resolve();
      finishRate = planTick(queue.size, true, tuning).count;
      const done = new Promise<void>((resolve) => waiters.push(resolve));
      // Re-plan so a long "slow" wait does not delay the fast drain.
      clearTimer();
      kick();
      return done;
    },
    flush() {
      clearTimer();
      if (!disposed && queue.size > 0) {
        lastRevealAt = now();
        options.onReveal(queue.drain());
      }
      settle();
    },
    dispose() {
      disposed = true;
      clearTimer();
      queue.clear();
      settle();
    },
    get backlog() {
      return queue.size;
    },
  };
}

/** True when the user asked the OS to minimise animation. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
