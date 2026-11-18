/**
 * Generic normalisation of a benchmark run `summary` dict for display.
 *
 * Summaries differ per framework (e.g. RAGAS: {faithfulness: 0.91, ...};
 * retrieval: {dense: {"recall@5": 0.8, mrr: 0.7}, hybrid: {...}}), so the UI renders
 * whatever shape arrives instead of hard-coding metric names:
 *   - scalar entries            → one key/value table
 *   - objects of scalars        → a matrix (rows = entry keys, columns = union of inner keys)
 *   - anything deeper / arrays  → shown as raw JSON
 */

export type Scalar = number | string | boolean | null;

export interface SummaryMatrix {
  title: string | null;
  rowKeys: string[];
  colKeys: string[];
  values: Record<string, Record<string, Scalar>>;
}

export interface NormalizedSummary {
  scalars: Array<{ key: string; value: Scalar }>;
  matrices: SummaryMatrix[];
  complex: Array<{ key: string; value: unknown }>;
}

function isScalar(v: unknown): v is Scalar {
  return v === null || ["number", "string", "boolean"].includes(typeof v);
}

function isScalarRecord(v: unknown): v is Record<string, Scalar> {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length > 0 &&
    Object.values(v as Record<string, unknown>).every(isScalar)
  );
}

function buildMatrix(title: string | null, entries: Array<[string, Record<string, Scalar>]>): SummaryMatrix {
  const colKeys: string[] = [];
  for (const [, rec] of entries) {
    for (const k of Object.keys(rec)) if (!colKeys.includes(k)) colKeys.push(k);
  }
  return {
    title,
    rowKeys: entries.map(([k]) => k),
    colKeys,
    values: Object.fromEntries(entries),
  };
}

/** Keys rendered elsewhere (regression comparisons have their own "Regression reports" section). */
export const SUMMARY_HIDDEN_KEYS: ReadonlySet<string> = new Set(["regression"]);

export function normalizeSummary(summary: Record<string, unknown> | null | undefined): NormalizedSummary {
  const out: NormalizedSummary = { scalars: [], matrices: [], complex: [] };
  if (!summary || typeof summary !== "object") return out;

  const recordEntries: Array<[string, Record<string, Scalar>]> = [];
  for (const [key, value] of Object.entries(summary)) {
    if (SUMMARY_HIDDEN_KEYS.has(key)) continue;
    if (isScalar(value)) {
      out.scalars.push({ key, value });
    } else if (isScalarRecord(value)) {
      recordEntries.push([key, value]);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      // One more level: {"by_mode": {"dense": {...}, "hybrid": {...}}}
      const inner = Object.entries(value as Record<string, unknown>);
      if (inner.length > 0 && inner.every(([, v]) => isScalarRecord(v))) {
        out.matrices.push(buildMatrix(key, inner as Array<[string, Record<string, Scalar>]>));
      } else {
        out.complex.push({ key, value });
      }
    } else {
      out.complex.push({ key, value });
    }
  }

  if (recordEntries.length > 1) {
    out.matrices.unshift(buildMatrix(null, recordEntries));
  } else if (recordEntries.length === 1) {
    const [key, rec] = recordEntries[0];
    out.matrices.unshift(buildMatrix(key, Object.entries(rec).map(([k, v]) => [k, { value: v }])));
  }
  return out;
}

export function isSummaryEmpty(s: NormalizedSummary): boolean {
  return s.scalars.length === 0 && s.matrices.length === 0 && s.complex.length === 0;
}
