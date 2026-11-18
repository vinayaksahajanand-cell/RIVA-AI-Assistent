/**
 * TypeScript mirror of the backend Pydantic schemas (backend/app/schemas/*.py).
 * UUIDs and datetimes are serialized as strings (ISO 8601 for datetimes).
 * Keep this file in sync with the backend — it is the frontend's contract.
 */

export type UUID = string;
export type ISODateTime = string;
export type JsonObject = Record<string, unknown>;

/* ------------------------------------------------------------------ common */

export interface ErrorDetail {
  code: string;
  message: string;
  details: JsonObject;
  request_id: string;
}

export interface ErrorResponse {
  error: ErrorDetail;
}

export interface OkResponse {
  ok: boolean;
}

/* -------------------------------------------------------------------- auth */

export interface RegisterRequest {
  email: string;
  password: string;
  full_name: string;
}

export type Portal = "user" | "admin";

export interface LoginRequest {
  email: string;
  password: string;
  /** "admin" → 403 (no session) unless the account has the admin_portal permission. */
  portal?: Portal;
}

/* ------------------------------------------------------------------ access */

export type Role = "admin" | "manager" | "user";
/** Ascending sensitivity: public < internal < confidential < restricted. */
export type Classification = "public" | "internal" | "confidential" | "restricted";

export const ROLES: readonly Role[] = ["admin", "manager", "user"] as const;
export const CLASSIFICATIONS: readonly Classification[] = ["public", "internal", "confidential", "restricted"] as const;

/** Mirror of backend/app/core/rbac.py Permission. */
export type Permission =
  | "chat"
  | "documents.view"
  | "documents.read_content"
  | "documents.download"
  | "documents.manage"
  | "users.manage"
  | "settings.manage"
  | "analytics.view"
  | "evaluation.view"
  | "evaluation.run"
  | "diagnostics.view"
  | "audit.view"
  | "pii.view"
  | "admin_portal";

export interface AccessOut {
  role: Role | (string & {});
  permissions: string[];
  /** Highest document classification this user may retrieve. */
  clearance: Classification | (string & {});
  allowed_classifications: string[];
  admin_portal: boolean;
}

export interface UserOut {
  id: UUID;
  email: string;
  full_name: string;
  role: string;
  created_at: ISODateTime;
}

export interface WorkspaceOut {
  id: UUID;
  name: string;
  /** admin | manager | user */
  role: string;
}

export interface AuthResponse {
  user: UserOut;
  workspace: WorkspaceOut;
  access: AccessOut;
  access_token: string;
  token_type: string;
  expires_at: ISODateTime;
}

export interface MeResponse {
  user: UserOut;
  workspace: WorkspaceOut;
  workspaces: WorkspaceOut[];
  access: AccessOut;
}

/* ---------------------------------------------------------------- settings */

export type ChunkStrategy = "recursive" | "token" | "semantic" | "structure" | "parent_child";
export type RetrievalMode = "hybrid" | "dense" | "bm25";

export const CHUNK_STRATEGIES: readonly ChunkStrategy[] = [
  "recursive",
  "token",
  "semantic",
  "structure",
  "parent_child",
] as const;

export const RETRIEVAL_MODES: readonly RetrievalMode[] = ["hybrid", "dense", "bm25"] as const;

export interface ChunkingSettings {
  strategy: ChunkStrategy;
  chunk_size: number; // 100..4000
  chunk_overlap: number; // 0..1000, < chunk_size
  parent_chunk_size: number; // 400..8000
  child_chunk_size: number; // 100..2000, < parent_chunk_size
}

export interface RetrievalSettings {
  mode: RetrievalMode;
  top_k: number; // 1..50
  final_k: number; // 1..12, clamped to top_k by backend
  rrf_k: number; // 1..500
  dense_weight: number; // 0..5
  sparse_weight: number; // 0..5
  reranker_enabled: boolean;
  max_corrective_attempts: number; // 0..3
}

export interface GenerationSettings {
  model: string;
  temperature: number; // 0..2
  max_tokens: number; // 64..8192
  grounded_only: boolean;
}

export interface EvaluationSettings {
  online_enabled: boolean;
}

export interface SecuritySettings {
  /** Highest classification each non-admin role may retrieve (admins always see everything). */
  role_clearance: { manager: Classification; user: Classification };
  default_classification: Classification;
  guardrails_enabled: boolean;
  block_prompt_injection: boolean;
  llm_injection_check: boolean;
  exclude_flagged_chunks: boolean;
  redact_sensitive_output: boolean;
  show_diagnostics_to_users: boolean;
}

export interface WorkspaceSettings {
  chunking: ChunkingSettings;
  retrieval: RetrievalSettings;
  generation: GenerationSettings;
  evaluation: EvaluationSettings;
  security: SecuritySettings;
}

export interface SystemInfo {
  app_name: string;
  version: string;
  available_models: string[];
  default_model: string;
  embedding_provider: string;
  embedding_model: string;
  embedding_dimensions: number;
  reranker_model: string | null;
  llm_configured: boolean;
  langsmith_enabled: boolean;
  langsmith_project: string | null;
  ocr_enabled: boolean;
  max_upload_mb: number;
  supported_extensions: string[];
  online_evaluation_available: boolean;
  /** shared (first sign-up is admin, later ones join as user) | personal */
  registration_mode: string;
  classifications: string[];
  roles: string[];
}

/* --------------------------------------------------------------- documents */

export type DocumentStatus = "uploaded" | "processing" | "indexed" | "failed" | "updating";

export interface CollectionCreate {
  name: string;
  description: string;
}

export interface CollectionOut {
  id: UUID;
  name: string;
  description: string;
  document_count: number;
  created_at: ISODateTime;
}

export interface JobOut {
  id: UUID;
  job_type: string;
  status: string;
  stage: string;
  progress: number; // 0..100
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: ISODateTime;
  started_at: ISODateTime | null;
  finished_at: ISODateTime | null;
  stats: JsonObject;
}

export interface DocumentOut {
  id: UUID;
  filename: string;
  title: string;
  file_ext: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  /** uploaded | processing | indexed | failed | updating (kept as string for forward-compat). */
  status: DocumentStatus | (string & {});
  classification: Classification | (string & {});
  current_version: number;
  page_count: number | null;
  chunk_count: number;
  error_message: string | null;
  collection_id: UUID | null;
  collection_name: string | null;
  metadata: JsonObject;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  indexed_at: ISODateTime | null;
  job: JobOut | null;
}

export interface DocumentVersionOut {
  version: number;
  sha256: string;
  size_bytes: number;
  original_filename: string;
  created_at: ISODateTime;
}

export interface DocumentDetail extends DocumentOut {
  versions: DocumentVersionOut[];
}

export interface DuplicateInfo {
  filename: string;
  existing_document_id: UUID;
  existing_title: string;
}

export interface RejectedFile {
  filename: string;
  reason: string;
}

export interface UploadResult {
  uploaded: DocumentOut[];
  duplicates: DuplicateInfo[];
  rejected: RejectedFile[];
}

export interface DocumentUpdate {
  title?: string | null;
  /** 403 if above the caller's clearance. */
  classification?: Classification | null;
  collection_id?: UUID | null;
  clear_collection?: boolean;
}

export interface ChunkOut {
  id: UUID;
  chunk_index: number;
  chunk_type: string;
  content: string;
  section_title: string | null;
  page_number: number | null;
  page_end: number | null;
  token_count: number;
  document_version: number;
}

export interface ChunkPage {
  total: number;
  items: ChunkOut[];
}

export interface DocumentListParams {
  q?: string;
  status?: string;
  collection_id?: string;
}

/* -------------------------------------------------------------- evaluation */

export type EvaluationStatus = "pending" | "running" | "completed" | "failed" | "not_available";
export type EvaluationMode = "online" | "reference" | "offline";
export type EvaluationFramework = "ragas" | "deepeval";

export interface MetricOut {
  name: string;
  display_name: string;
  /** Raw framework score (0..1); null = not computed → show N/A, never 0. */
  score: number | null;
  /** Score scaled to 0..100 for display. */
  score_100: number | null;
  higher_is_better: boolean;
  /** completed | not_applicable | failed */
  status: string;
  reason: string | null;
  requires_reference: boolean;
  threshold: number | null;
  passed: boolean | null;
}

export interface EvaluationOut {
  id: UUID;
  framework: EvaluationFramework | (string & {});
  mode: EvaluationMode | (string & {});
  mode_label: string;
  status: EvaluationStatus | (string & {});
  reference_available: boolean;
  evaluator_model: string | null;
  framework_version: string | null;
  started_at: ISODateTime | null;
  completed_at: ISODateTime | null;
  duration_ms: number | null;
  error: string | null;
  methodology: string;
  metrics: MetricOut[];
  created_at: ISODateTime;
}

export interface MessageEvaluations {
  message_id: UUID;
  evaluations: EvaluationOut[];
}

export interface RawEvaluation {
  evaluation_id: UUID;
  framework: string;
  inputs: JsonObject;
  raw: JsonObject;
}

export interface ReferenceAnswerRequest {
  reference_answer: string;
}

export type BenchmarkRetrievalMode = "dense" | "bm25" | "hybrid" | "hybrid_rerank";
export const BENCHMARK_RETRIEVAL_MODES: readonly BenchmarkRetrievalMode[] = [
  "dense",
  "bm25",
  "hybrid",
  "hybrid_rerank",
] as const;

export interface BenchmarkRunRequest {
  dataset: string;
  limit?: number | null;
  label?: string;
  retrieval_modes?: BenchmarkRetrievalMode[];
  set_baseline?: boolean;
}

export type BenchmarkKind = "retrieval" | "ragas" | "deepeval";

export interface BenchmarkRunOut {
  id: UUID;
  framework: string;
  /** queued | running | completed | failed */
  status: string;
  label: string;
  config: JsonObject;
  summary: JsonObject;
  item_count: number;
  duration_ms: number | null;
  error: string | null;
  report_paths: JsonObject;
  is_baseline: boolean;
  created_at: ISODateTime;
  completed_at: ISODateTime | null;
}

export interface RegressionItem {
  metric: string;
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
  higher_is_better: boolean;
  regressed: boolean;
}

export interface RegressionReport {
  framework: string;
  baseline_run_id: UUID | null;
  candidate_run_id: UUID;
  threshold: number;
  regressed: boolean;
  items: RegressionItem[];
}

export interface EvaluationReports {
  runs: BenchmarkRunOut[];
  datasets: string[];
  regressions: RegressionReport[];
}

/* -------------------------------------------------------------------- chat */

export interface RetrievalOverrides {
  mode?: RetrievalMode | null;
  top_k?: number | null;
  final_k?: number | null;
  reranker_enabled?: boolean | null;
  rrf_k?: number | null;
}

export interface ChatRequest {
  message: string;
  conversation_id?: UUID | null;
  document_ids?: UUID[] | null;
  collection_id?: UUID | null;
  model?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  grounded_only?: boolean | null;
  retrieval?: RetrievalOverrides | null;
  reference_answer?: string | null;
  regenerate?: boolean;
}

export interface CitationOut {
  /** The [n] marker used in the answer text. */
  index: number;
  chunk_id: UUID;
  document_id: UUID;
  document_name: string;
  page_number: number | null;
  page_end: number | null;
  section_title: string | null;
  snippet: string;
}

export interface RetrievedSourceOut {
  chunk_id: UUID;
  document_id: UUID;
  document_name: string;
  page_number: number | null;
  page_end: number | null;
  section_title: string | null;
  snippet: string;
  /** Full text given to the LLM (selected contexts only). */
  content: string | null;
  dense_rank: number | null;
  dense_score: number | null;
  bm25_rank: number | null;
  bm25_score: number | null;
  fused_rank: number | null;
  rrf_score: number | null;
  rerank_score: number | null;
  final_rank: number | null;
  selected: boolean;
  relevant: boolean | null;
  context_index: number | null;
}

export interface RetrievalInfo {
  query: string;
  search_queries: string[];
  mode: string;
  config: JsonObject;
  attempts: number;
  retrieval_success: boolean;
  grade: JsonObject;
  sources: RetrievedSourceOut[];
}

export interface PerformanceOut {
  stages_ms: Record<string, number>;
  time_to_first_token_ms: number | null;
  total_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  llm_calls: number;
  model: string | null;
}

export interface VerificationOut {
  /** completed | skipped | failed | not_run */
  status: string;
  grounded: boolean | null;
  supported_claims: number | null;
  total_claims: number | null;
  unsupported_claims: string[];
  contradictions: string[];
  notes: string | null;
}

export type MessageStatus = "streaming" | "completed" | "insufficient_context" | "blocked" | "failed";

/** `MessageOut.metadata.guardrail` — present when guardrails blocked the request or redacted output. */
export interface GuardrailInfo {
  blocked?: boolean;
  /** prompt_injection | jailbreak | privilege_escalation | classified_access | secret_extraction | llm_detected_attack | … */
  category?: string | null;
  reasons?: string[];
  /** rules | llm */
  source?: string;
  /** Redacted kinds → count, e.g. {email: 2, phone: 1}. */
  redactions?: Record<string, number>;
}

export interface MessageOut {
  id: UUID;
  conversation_id: UUID;
  /** user | assistant */
  role: string;
  content: string;
  status: MessageStatus | (string & {});
  model: string | null;
  created_at: ISODateTime;
  reply_to_id: UUID | null;
  citations: CitationOut[];
  verification: VerificationOut | null;
  performance: PerformanceOut | null;
  retrieval: RetrievalInfo | null;
  evaluations: EvaluationOut[];
  feedback_rating: number | null;
  reference_answer: string | null;
  error_message: string | null;
  metadata: JsonObject;
}

export interface ChatResponse {
  conversation_id: UUID;
  user_message: MessageOut;
  assistant_message: MessageOut;
}

export interface ConversationOut {
  id: UUID;
  title: string;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  message_count: number;
  last_message_preview: string | null;
}

export interface ConversationDetail extends ConversationOut {
  scope: JsonObject;
  messages: MessageOut[];
}

export interface ConversationUpdate {
  title: string;
}

export interface FeedbackRequest {
  rating: 1 | -1;
  comment?: string | null;
}

export interface SuggestedQuestions {
  questions: string[];
}

/* -------------------------------------------------------------- SSE events */

export interface StreamMetaEvent {
  conversation_id: UUID;
  user_message_id: UUID;
  assistant_message_id: UUID;
  run_id: string;
}

export interface StreamStatusEvent {
  stage: string;
  label: string;
}

export interface StreamTokenEvent {
  delta: string;
}

export interface StreamDoneEvent {
  message: MessageOut;
}

export interface StreamErrorEvent {
  code: string;
  message: string;
}

export type ChatStreamEvent =
  | { event: "meta"; data: StreamMetaEvent }
  | { event: "status"; data: StreamStatusEvent }
  | { event: "retrieval"; data: RetrievalInfo }
  | { event: "token"; data: StreamTokenEvent }
  | { event: "done"; data: StreamDoneEvent }
  | { event: "error"; data: StreamErrorEvent };

/* --------------------------------------------------------------- analytics */

export interface AnalyticsFilters {
  date_from?: string; // YYYY-MM-DD
  date_to?: string; // YYYY-MM-DD
  model?: string;
  collection_id?: string;
}

export interface Totals {
  documents_total: number;
  documents_indexed: number;
  documents_failed: number;
  chunks_indexed: number;
  conversations: number;
  questions_answered: number;
  failed_queries: number;
  insufficient_context_answers: number;
}

export interface LatencyStats {
  avg_total_ms: number | null;
  p50_total_ms: number | null;
  p95_total_ms: number | null;
  avg_ttft_ms: number | null;
  avg_retrieval_ms: number | null;
  avg_generation_ms: number | null;
}

export interface QualityStats {
  evaluated_answers: number;
  avg_faithfulness: number | null;
  avg_answer_relevancy: number | null;
  avg_context_precision: number | null;
  hallucination_rate: number | null;
  hallucination_rate_source: string | null;
  thumbs_up: number;
  thumbs_down: number;
}

export interface RetrievalStats {
  events: number;
  success_rate: number | null;
  avg_attempts: number | null;
}

export interface TokenStats {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number | null;
  pricing_configured: boolean;
}

export interface AnalyticsOverview {
  filters: JsonObject;
  totals: Totals;
  latency: LatencyStats;
  quality: QualityStats;
  retrieval: RetrievalStats;
  tokens: TokenStats;
  models: string[];
}

export interface LatencyPoint {
  date: string;
  count: number;
  avg_total_ms: number | null;
  p95_total_ms: number | null;
  avg_ttft_ms: number | null;
}

export interface ModelUsage {
  model: string;
  count: number;
  avg_total_ms: number | null;
  total_tokens: number;
}

export interface PerformanceAnalytics {
  filters: JsonObject;
  series: LatencyPoint[];
  stage_averages_ms: Record<string, number>;
  by_model: ModelUsage[];
}

export interface MetricPoint {
  date: string;
  metric: string;
  framework: string;
  avg: number | null;
  count: number;
}

export interface MetricAverage {
  metric: string;
  display_name: string;
  framework: string;
  mode: string;
  avg: number | null;
  count: number;
  higher_is_better: boolean;
}

export interface EvaluationAnalytics {
  filters: JsonObject;
  series: MetricPoint[];
  averages: MetricAverage[];
  status_counts: Record<string, number>;
  benchmark_runs: BenchmarkRunOut[];
}

export interface HealthResponse {
  status: string;
  [key: string]: unknown;
}

export type ExportFormat = "markdown" | "json";
export type RunExportFormat = "json" | "csv";

/* ------------------------------------------------------------------- admin */

export interface MemberOut {
  id: UUID;
  email: string;
  full_name: string;
  role: Role | (string & {});
  clearance: Classification | (string & {});
  is_active: boolean;
  created_at: ISODateTime;
  last_login_at: ISODateTime | null;
}

export interface MemberCreate {
  email: string;
  full_name: string;
  /** min 8 characters */
  password: string;
  role: Role;
}

export interface MemberUpdate {
  role?: Role;
  is_active?: boolean;
  full_name?: string;
}

export type AuditSeverity = "info" | "warning" | "critical";

export interface AuditEventOut {
  id: UUID;
  event_type: string;
  severity: AuditSeverity | (string & {});
  summary: string;
  actor_email: string | null;
  user_id: UUID | null;
  message_id: UUID | null;
  details: JsonObject;
  created_at: ISODateTime;
}

export interface AuditPage {
  total: number;
  items: AuditEventOut[];
}

export interface AuditQuery {
  /** Prefix filter, e.g. "guardrail.", "auth.", "admin.", "document.", "access." */
  event_type?: string;
  severity?: AuditSeverity;
  offset?: number;
  limit?: number;
}

export interface RoleInfo {
  role: Role | (string & {});
  permissions: string[];
  clearance: string;
  allowed_classifications: string[];
  members: number;
}

export interface SecurityOverview {
  roles: RoleInfo[];
  classifications: string[];
  documents_by_classification: Record<string, number>;
  guardrail_events_30d: Record<string, number>;
}
