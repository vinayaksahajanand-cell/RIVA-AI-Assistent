import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTypewriter, planTick, tokenizeDelta, TYPEWRITER_TUNING, WordQueue } from "@/lib/typewriter";

describe("tokenizeDelta", () => {
  it("keeps each word with its trailing whitespace and re-joins losslessly", () => {
    const input = "  Hello, world!\n\nNext line ";
    const units = tokenizeDelta(input);
    expect(units).toEqual(["  Hello, ", "world!\n\n", "Next ", "line "]);
    expect(units.join("")).toBe(input);
  });

  it("handles single words, whitespace-only and empty deltas", () => {
    expect(tokenizeDelta("word ")).toEqual(["word "]);
    expect(tokenizeDelta("\n\n")).toEqual(["\n\n"]);
    expect(tokenizeDelta("")).toEqual([]);
  });
});

describe("WordQueue", () => {
  it("is FIFO and reports its size", () => {
    const q = new WordQueue();
    q.push("one ");
    q.push("two three ");
    expect(q.size).toBe(3);
    expect(q.take(2)).toBe("one two ");
    expect(q.size).toBe(1);
    expect(q.take(5)).toBe("three ");
    expect(q.size).toBe(0);
    expect(q.take(1)).toBe("");
  });

  it("drains and clears", () => {
    const q = new WordQueue();
    q.push("a b c ");
    expect(q.drain()).toBe("a b c ");
    q.push("d ");
    q.clear();
    expect(q.size).toBe(0);
  });

  it("stays correct across internal compaction", () => {
    const q = new WordQueue();
    const words = Array.from({ length: 600 }, (_, i) => `w${i} `);
    for (const w of words) q.push(w);
    let out = "";
    while (q.size) out += q.take(7);
    expect(out).toBe(words.join(""));
  });
});

describe("planTick", () => {
  const t = TYPEWRITER_TUNING;

  it("reveals one word at the slow cadence for a tiny backlog", () => {
    expect(planTick(1, false)).toEqual({ count: 1, delayMs: t.slowMs });
  });

  it("speeds up as the backlog grows, staying within the 25-45 ms band", () => {
    const delays = [1, 2, 4, 6, 8, 20].map((b) => planTick(b, false).delayMs);
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeLessThanOrEqual(delays[i - 1]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(45);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(25);
    expect(planTick(t.fastBacklog, false).delayMs).toBe(t.fastMs);
  });

  it("reveals several words per tick when far behind", () => {
    expect(planTick(t.catchUpBacklog, false).count).toBe(1);
    expect(planTick(t.catchUpBacklog * 3, false).count).toBe(3);
  });

  it("drains quickly while finishing", () => {
    const plan = planTick(50, true);
    expect(plan.delayMs).toBe(t.finishMs);
    expect(plan.count).toBe(Math.ceil(50 / t.finishTicks));
    expect(planTick(3, true).count).toBe(1);
  });

  it("does nothing on an empty backlog", () => {
    expect(planTick(0, false).count).toBe(0);
    expect(planTick(0, true).count).toBe(0);
  });
});

describe("createTypewriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(instant = false) {
    let shown = "";
    const tw = createTypewriter({
      onReveal: (text) => {
        shown += text;
      },
      instant,
    });
    return { tw, shown: () => shown };
  }

  it("reveals the first word immediately, then one word per tick", () => {
    const { tw, shown } = setup();
    tw.push("Hello ");
    tw.push("brave ");
    tw.push("new ");
    expect(shown()).toBe("Hello ");
    vi.advanceTimersByTime(TYPEWRITER_TUNING.slowMs);
    expect(shown()).toBe("Hello brave ");
    vi.advanceTimersByTime(TYPEWRITER_TUNING.slowMs);
    expect(shown()).toBe("Hello brave new ");
    expect(tw.backlog).toBe(0);
  });

  it("paces words that arrive faster than the cadence", () => {
    const { tw, shown } = setup();
    tw.push("one ");
    vi.advanceTimersByTime(5);
    tw.push("two ");
    expect(shown()).toBe("one ");
    vi.advanceTimersByTime(TYPEWRITER_TUNING.slowMs);
    expect(shown()).toBe("one two ");
  });

  it("never lags far behind a large burst", () => {
    const { tw, shown } = setup();
    const burst = Array.from({ length: 120 }, (_, i) => `w${i} `).join("");
    tw.push(burst);
    vi.advanceTimersByTime(1000);
    expect(shown()).toBe(burst);
  });

  it("finish() drains the rest quickly and resolves", async () => {
    const { tw, shown } = setup();
    const text = Array.from({ length: 40 }, (_, i) => `w${i} `).join("");
    tw.push(text);
    let resolved = false;
    const done = tw.finish().then(() => {
      resolved = true;
    });
    vi.advanceTimersByTime(TYPEWRITER_TUNING.finishMs * (TYPEWRITER_TUNING.finishTicks + 1));
    await done;
    expect(resolved).toBe(true);
    expect(shown()).toBe(text);
  });

  it("finish() resolves immediately when nothing is queued", async () => {
    const { tw } = setup();
    await expect(tw.finish()).resolves.toBeUndefined();
  });

  it("flush() reveals everything at once", () => {
    const { tw, shown } = setup();
    tw.push("a b c d ");
    tw.flush();
    expect(shown()).toBe("a b c d ");
    expect(tw.backlog).toBe(0);
  });

  it("dispose() stops revealing and resolves a pending finish()", async () => {
    const { tw, shown } = setup();
    tw.push("a b c d ");
    const done = tw.finish();
    tw.dispose();
    await done;
    vi.advanceTimersByTime(1000);
    expect(shown()).toBe("a ");
    tw.push("ignored ");
    expect(shown()).toBe("a ");
  });

  it("reveals instantly in reduced-motion mode", () => {
    const { tw, shown } = setup(true);
    tw.push("all at once ");
    expect(shown()).toBe("all at once ");
    expect(tw.backlog).toBe(0);
  });
});
