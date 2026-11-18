import { describe, expect, it } from "vitest";

import { normalizeSummary } from "@/lib/summary";

describe("normalizeSummary", () => {
  it("omits the regression report, which has its own dashboard section", () => {
    const s = normalizeSummary({
      dataset: "sample_benchmark",
      retrieval: { dense: { mrr: 0.97 }, bm25: { mrr: 0.87 } },
      regression: { regressed: false, items: [{ metric: "retrieval.dense.mrr", delta: 0 }] },
    });
    expect(s.complex.map((c) => c.key)).not.toContain("regression");
    expect(s.matrices.some((m) => m.title === "retrieval")).toBe(true);
    expect(s.scalars).toEqual([{ key: "dataset", value: "sample_benchmark" }]);
  });
});
