import { describe, expect, it } from "vitest";

import { latencyRows, metricTrend, SERIES_COLORS } from "@/lib/analytics";
import { applyStreamEvent, draftMessage, newLiveState, scopeFromConversation, scopeToRequest, type ChatItem } from "@/lib/chat";
import { evaluationDurationMs, groupEvaluations, regressionTone, shouldPollEvaluations } from "@/lib/evaluation";
import { validateSettings, settingsWarnings } from "@/lib/settings";
import { normalizeSummary } from "@/lib/summary";
import type { EvaluationOut, MessageOut, WorkspaceSettings } from "@/lib/types";
import { acceptAttribute, fileExtension, validateFiles } from "@/lib/uploads";
import { buildUrl, filenameFromDisposition } from "@/services/http";

const evaluation = (over: Partial<EvaluationOut>): EvaluationOut => ({
  id: "e",
  framework: "ragas",
  mode: "online",
  mode_label: "Online",
  status: "completed",
  reference_available: false,
  evaluator_model: null,
  framework_version: null,
  started_at: null,
  completed_at: null,
  duration_ms: null,
  error: null,
  methodology: "",
  metrics: [],
  created_at: "2026-11-16T10:00:00Z",
  ...over,
});

describe("evaluation polling", () => {
  it("polls while any evaluation is pending or running", () => {
    expect(shouldPollEvaluations([evaluation({ status: "pending" })])).toBe(true);
    expect(shouldPollEvaluations([evaluation({ status: "completed" }), evaluation({ status: "running" })])).toBe(true);
  });

  it("stops on completed / failed / not_available", () => {
    expect(shouldPollEvaluations([evaluation({ status: "completed" }), evaluation({ status: "failed" })])).toBe(false);
    expect(shouldPollEvaluations([evaluation({ status: "not_available" })])).toBe(false);
  });

  it("allows grace polls only while the list is still empty", () => {
    expect(shouldPollEvaluations([], 2)).toBe(true);
    expect(shouldPollEvaluations([], 0)).toBe(false);
    expect(shouldPollEvaluations([evaluation({ status: "completed" })], 3)).toBe(false);
  });

  it("groups by framework keeping RAGAS and DeepEval separate, online before reference", () => {
    const g = groupEvaluations([
      evaluation({ id: "r2", mode: "reference" }),
      evaluation({ id: "d1", framework: "deepeval" }),
      evaluation({ id: "r1", mode: "online" }),
    ]);
    expect(g.ragas.map((e) => e.id)).toEqual(["r1", "r2"]);
    expect(g.deepeval.map((e) => e.id)).toEqual(["d1"]);
  });

  it("reports evaluation duration separately, preferring RAGAS", () => {
    expect(
      evaluationDurationMs([
        evaluation({ framework: "deepeval", duration_ms: 900 }),
        evaluation({ framework: "ragas", duration_ms: 4200 }),
      ]),
    ).toBe(4200);
    expect(evaluationDurationMs([evaluation({ status: "running", duration_ms: 10 })])).toBeNull();
  });
});

describe("regression tone respects metric direction", () => {
  it("colours deltas", () => {
    expect(regressionTone({ delta: 0.05, higher_is_better: true, regressed: false })).toBe("improved");
    expect(regressionTone({ delta: -0.05, higher_is_better: true, regressed: false })).toBe("worse");
    expect(regressionTone({ delta: -0.05, higher_is_better: false, regressed: false })).toBe("improved");
    expect(regressionTone({ delta: 0.2, higher_is_better: false, regressed: true })).toBe("regressed");
    expect(regressionTone({ delta: null, higher_is_better: true, regressed: false })).toBe("neutral");
  });
});

describe("chat stream reducer", () => {
  const base = (): ChatItem => ({
    key: "k",
    message: draftMessage({ id: "local-k", role: "assistant", content: "", status: "streaming" }),
    live: newLiveState(),
  });

  it("applies meta, status, token and done events", () => {
    let item = base();
    item = applyStreamEvent(item, {
      event: "meta",
      data: { conversation_id: "c1", user_message_id: "u1", assistant_message_id: "a1", run_id: "r" },
    });
    expect(item.message.id).toBe("a1");
    item = applyStreamEvent(item, { event: "status", data: { stage: "search", label: "Searching documents" } });
    item = applyStreamEvent(item, { event: "status", data: { stage: "search", label: "Searching documents (2)" } });
    item = applyStreamEvent(item, { event: "status", data: { stage: "gen", label: "Generating answer" } });
    expect(item.live?.stages.map((s) => s.label)).toEqual(["Searching documents (2)", "Generating answer"]);
    item = applyStreamEvent(item, { event: "token", data: { delta: "Hello " } });
    item = applyStreamEvent(item, { event: "token", data: { delta: "[1]" } });
    expect(item.message.content).toBe("Hello [1]");

    const final = { ...item.message, id: "a1", content: "Hello [1].", status: "completed" } as MessageOut;
    item = applyStreamEvent(item, { event: "done", data: { message: final } });
    expect(item.message.content).toBe("Hello [1].");
    expect(item.live).toBeUndefined();
    expect(item.evalGrace).toBeGreaterThan(0);
  });

  it("marks the message failed on an error event", () => {
    const item = applyStreamEvent(base(), { event: "error", data: { code: "llm", message: "Model unavailable" } });
    expect(item.message.status).toBe("failed");
    expect(item.message.error_message).toBe("Model unavailable");
    expect(item.live).toBeUndefined();
  });

  it("maps scope to and from the API", () => {
    expect(scopeFromConversation({ document_ids: ["a", 3, "b"], collection_id: "c" })).toEqual({ documentIds: ["a", "b"], collectionId: "c" });
    expect(scopeFromConversation({})).toEqual({ documentIds: [], collectionId: null });
    expect(scopeToRequest({ documentIds: [], collectionId: null })).toEqual({ document_ids: null, collection_id: null });
  });
});

describe("benchmark summary normalisation", () => {
  it("separates scalars, per-mode matrices and complex values", () => {
    const s = normalizeSummary({
      item_count: 20,
      dense: { "recall@5": 0.8, mrr: 0.6 },
      hybrid: { "recall@5": 0.9, ndcg: 0.7 },
      failures: [{ id: 1 }],
    });
    expect(s.scalars).toEqual([{ key: "item_count", value: 20 }]);
    expect(s.matrices[0].rowKeys).toEqual(["dense", "hybrid"]);
    expect(s.matrices[0].colKeys).toEqual(["recall@5", "mrr", "ndcg"]);
    expect(s.complex.map((c) => c.key)).toEqual(["failures"]);
  });

  it("handles a nested by_mode block and a flat metric map", () => {
    const s = normalizeSummary({ by_mode: { dense: { mrr: 0.5 }, bm25: { mrr: 0.4 } } });
    expect(s.matrices[0].title).toBe("by_mode");
    const flat = normalizeSummary({ faithfulness: 0.91, answer_relevancy: null });
    expect(flat.scalars).toHaveLength(2);
  });
});

describe("uploads", () => {
  const file = (name: string, size: number) => new File([new Uint8Array(size)], name);

  it("validates extensions and size against /api/system limits", () => {
    const { accepted, rejected } = validateFiles(
      [file("a.PDF", 10), file("b.exe", 10), file("c.docx", 3 * 1024 * 1024), file("noext", 5), file("e.txt", 0)],
      { maxUploadMb: 2, supportedExtensions: [".pdf", "docx", "txt"] },
    );
    expect(accepted.map((f) => f.name)).toEqual(["a.PDF"]);
    expect(rejected.map((r) => r.file.name)).toEqual(["b.exe", "c.docx", "noext", "e.txt"]);
    expect(rejected[1].reason).toMatch(/2 MB/);
  });

  it("builds accept attributes and extensions", () => {
    expect(acceptAttribute([".pdf", "DOCX"])).toBe(".pdf,.docx");
    expect(acceptAttribute([])).toBe("");
    expect(fileExtension("report.final.Pdf")).toBe("pdf");
  });
});

describe("settings validation mirrors backend constraints", () => {
  const settings: WorkspaceSettings = {
    chunking: { strategy: "recursive", chunk_size: 800, chunk_overlap: 120, parent_chunk_size: 2000, child_chunk_size: 400 },
    retrieval: { mode: "hybrid", top_k: 20, final_k: 6, rrf_k: 60, dense_weight: 1, sparse_weight: 1, reranker_enabled: true, max_corrective_attempts: 1 },
    generation: { model: "gpt-4o-mini", temperature: 0.1, max_tokens: 1024, grounded_only: true },
    evaluation: { online_enabled: true },
    security: {
      role_clearance: { manager: "confidential", user: "internal" },
      default_classification: "internal",
      guardrails_enabled: true,
      block_prompt_injection: true,
      llm_injection_check: true,
      exclude_flagged_chunks: true,
      redact_sensitive_output: true,
      show_diagnostics_to_users: false,
    },
  };

  it("accepts valid settings", () => {
    expect(validateSettings(settings)).toEqual({});
  });

  it("flags range and cross-field violations", () => {
    const bad = {
      ...settings,
      chunking: { ...settings.chunking, chunk_overlap: 900, chunk_size: 800, child_chunk_size: 2500 },
      retrieval: { ...settings.retrieval, top_k: 0, rrf_k: Number.NaN },
    };
    const errors = validateSettings(bad);
    expect(errors["chunking.chunk_overlap"]).toMatch(/smaller/);
    expect(errors["chunking.child_chunk_size"]).toMatch(/between/);
    expect(errors["retrieval.top_k"]).toBeDefined();
    expect(errors["retrieval.rrf_k"]).toBe("Enter a number.");
  });

  it("warns (without blocking) when final_k exceeds top_k", () => {
    expect(settingsWarnings({ ...settings, retrieval: { ...settings.retrieval, top_k: 4, final_k: 6 } })["retrieval.final_k"]).toMatch(/clamped/);
  });
});

describe("analytics transforms keep gaps as null", () => {
  it("converts latency to seconds and sorts by date", () => {
    const rows = latencyRows([
      { date: "2026-11-02", count: 1, avg_total_ms: 1500, p95_total_ms: null, avg_ttft_ms: 400 },
      { date: "2026-11-01", count: 2, avg_total_ms: 2000, p95_total_ms: 3000, avg_ttft_ms: null },
    ]);
    expect(rows.map((r) => r.date)).toEqual(["2026-11-01", "2026-11-02"]);
    expect(rows[1]).toMatchObject({ avg_s: 1.5, p95_s: null, ttft_s: 0.4 });
  });

  it("pivots RAGAS metrics with stable colours", () => {
    const t = metricTrend(
      [
        { date: "2026-11-01", metric: "context_precision", framework: "ragas", avg: 0.8, count: 2 },
        { date: "2026-11-01", metric: "faithfulness", framework: "ragas", avg: 0.95, count: 2 },
        { date: "2026-11-02", metric: "faithfulness", framework: "ragas", avg: null, count: 0 },
        { date: "2026-11-01", metric: "hallucination", framework: "deepeval", avg: 0.1, count: 1 },
      ],
      "ragas",
    );
    expect(t.metrics.map((m) => m.key)).toEqual(["faithfulness", "context_precision"]);
    expect(t.metrics[0].color).toBe(SERIES_COLORS[0]);
    expect(t.rows[0]).toMatchObject({ faithfulness: 95, context_precision: 80 });
    expect(t.rows[1]).toMatchObject({ faithfulness: null, context_precision: null });
  });
});

describe("http helpers", () => {
  it("builds URLs and skips empty query values", () => {
    expect(buildUrl("/api/documents", { q: "", status: "indexed", collection_id: undefined })).toBe(
      "http://localhost:8100/api/documents?status=indexed",
    );
  });

  it("parses Content-Disposition filenames", () => {
    expect(filenameFromDisposition('attachment; filename="chat.md"')).toBe("chat.md");
    expect(filenameFromDisposition("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.json")).toBe("résumé.json");
    expect(filenameFromDisposition(null)).toBeNull();
  });
});
