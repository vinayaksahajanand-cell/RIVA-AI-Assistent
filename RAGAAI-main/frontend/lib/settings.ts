/**
 * Client-side validation mirroring backend/app/schemas/settings.py constraints,
 * so the form can show hints before the PUT (the backend still validates).
 */

import type { WorkspaceSettings } from "@/lib/types";

export type SettingsErrors = Partial<Record<string, string>>;

interface Range {
  min: number;
  max: number;
  integer?: boolean;
}

export const SETTINGS_RANGES = {
  "chunking.chunk_size": { min: 100, max: 4000, integer: true },
  "chunking.chunk_overlap": { min: 0, max: 1000, integer: true },
  "chunking.parent_chunk_size": { min: 400, max: 8000, integer: true },
  "chunking.child_chunk_size": { min: 100, max: 2000, integer: true },
  "retrieval.top_k": { min: 1, max: 50, integer: true },
  "retrieval.final_k": { min: 1, max: 12, integer: true },
  "retrieval.rrf_k": { min: 1, max: 500, integer: true },
  "retrieval.dense_weight": { min: 0, max: 5 },
  "retrieval.sparse_weight": { min: 0, max: 5 },
  "retrieval.max_corrective_attempts": { min: 0, max: 3, integer: true },
  "generation.temperature": { min: 0, max: 2 },
  "generation.max_tokens": { min: 64, max: 8192, integer: true },
} as const satisfies Record<string, Range>;

export type RangedField = keyof typeof SETTINGS_RANGES;

function checkRange(value: number, r: Range): string | null {
  if (typeof value !== "number" || Number.isNaN(value)) return "Enter a number.";
  if (r.integer && !Number.isInteger(value)) return "Enter a whole number.";
  if (value < r.min || value > r.max) return `Must be between ${r.min} and ${r.max}.`;
  return null;
}

function get(s: WorkspaceSettings, path: RangedField): number {
  const [section, field] = path.split(".") as [keyof WorkspaceSettings, string];
  return (s[section] as unknown as Record<string, number>)[field];
}

export function validateSettings(s: WorkspaceSettings): SettingsErrors {
  const errors: SettingsErrors = {};
  for (const [path, range] of Object.entries(SETTINGS_RANGES) as Array<[RangedField, Range]>) {
    const msg = checkRange(get(s, path), range);
    if (msg) errors[path] = msg;
  }
  if (!errors["chunking.chunk_overlap"] && !errors["chunking.chunk_size"] && s.chunking.chunk_overlap >= s.chunking.chunk_size) {
    errors["chunking.chunk_overlap"] = "Overlap must be smaller than the chunk size.";
  }
  if (
    !errors["chunking.child_chunk_size"] &&
    !errors["chunking.parent_chunk_size"] &&
    s.chunking.child_chunk_size >= s.chunking.parent_chunk_size
  ) {
    errors["chunking.child_chunk_size"] = "Child chunks must be smaller than parent chunks.";
  }
  if (!s.generation.model.trim()) errors["generation.model"] = "Choose a model.";
  else if (s.generation.model.length > 100) errors["generation.model"] = "At most 100 characters.";
  return errors;
}

/** Non-blocking advisories (the backend adjusts these silently). */
export function settingsWarnings(s: WorkspaceSettings): SettingsErrors {
  const warnings: SettingsErrors = {};
  if (s.retrieval.final_k > s.retrieval.top_k) {
    warnings["retrieval.final_k"] = `Will be clamped to top_k (${s.retrieval.top_k}).`;
  }
  return warnings;
}
