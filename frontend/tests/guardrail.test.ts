import { describe, expect, it } from "vitest";

import { guardrailCategoryLabel, guardrailFromMetadata, redactionSummary } from "@/lib/chat";

describe("guardrail metadata", () => {
  it("reads a blocked verdict defensively", () => {
    const g = guardrailFromMetadata({
      role: "user",
      guardrail: { blocked: true, category: "prompt_injection", reasons: ["ignore previous instructions", 3], source: "rules" },
    });
    expect(g).toEqual({
      blocked: true,
      category: "prompt_injection",
      reasons: ["ignore previous instructions"],
      source: "rules",
      redactions: undefined,
    });
  });

  it("keeps only positive numeric redaction counts", () => {
    const g = guardrailFromMetadata({ guardrail: { redactions: { email: 2, phone: 0, card: "x" } } });
    expect(g?.blocked).toBe(false);
    expect(g?.redactions).toEqual({ email: 2 });
  });

  it("returns null when absent or malformed", () => {
    expect(guardrailFromMetadata({})).toBeNull();
    expect(guardrailFromMetadata({ guardrail: "nope" })).toBeNull();
    expect(guardrailFromMetadata(null)).toBeNull();
  });
});

describe("guardrail labels", () => {
  it("humanises known and unknown categories", () => {
    expect(guardrailCategoryLabel("jailbreak")).toBe("Jailbreak attempt");
    expect(guardrailCategoryLabel("llm_detected_attack")).toBe("Flagged by the AI security check");
    expect(guardrailCategoryLabel("weird_new_rule")).toBe("Weird new rule");
    expect(guardrailCategoryLabel(null)).toBe("Security policy");
  });

  it("summarises redactions with singular/plural nouns", () => {
    expect(redactionSummary({ email: 2, phone: 1 })).toBe("2 email addresses, 1 phone number");
    expect(redactionSummary({ api_key: 1 })).toBe("1 API key");
    expect(redactionSummary(undefined)).toBe("");
  });
});
