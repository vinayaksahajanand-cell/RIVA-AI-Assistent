/**
 * Chat view-model: pure helpers that turn SSE events into message state.
 * Kept free of React so the streaming behaviour is unit-testable.
 */

import type {
  ChatRequest,
  ChatStreamEvent,
  GuardrailInfo,
  JsonObject,
  MessageOut,
  StreamStatusEvent,
} from "@/lib/types";

/** Polls allowed while a freshly streamed answer still has no evaluation rows. */
export const EVALUATION_EMPTY_GRACE_POLLS = 4;
/** Consecutive evaluation poll failures after which polling for a message stops. */
export const EVALUATION_MAX_POLL_ERRORS = 5;

export interface LiveState {
  /** Latest pipeline stage reported by `status` events. */
  stage: StreamStatusEvent | null;
  /** Stage history (consecutive duplicates collapsed). */
  stages: StreamStatusEvent[];
  receivedTokens: boolean;
}

export interface ChatItem {
  /** Stable React key (survives the local → persisted id swap). */
  key: string;
  message: MessageOut;
  /** Present while the assistant answer is streaming. */
  live?: LiveState;
  /** The user pressed stop; content is partial. */
  stopped?: boolean;
  evalGrace?: number;
  pollErrors?: number;
}

export interface ChatScope {
  documentIds: string[];
  collectionId: string | null;
}

export const EMPTY_SCOPE: ChatScope = { documentIds: [], collectionId: null };

export function isLocalId(id: string): boolean {
  return id.startsWith("local-");
}

export function draftMessage(
  fields: Pick<MessageOut, "id" | "role" | "content" | "status"> & Partial<MessageOut>,
): MessageOut {
  return {
    conversation_id: "",
    model: null,
    created_at: new Date().toISOString(),
    reply_to_id: null,
    citations: [],
    verification: null,
    performance: null,
    retrieval: null,
    evaluations: [],
    feedback_rating: null,
    reference_answer: null,
    error_message: null,
    metadata: {},
    ...fields,
  };
}

export function newLiveState(): LiveState {
  return { stage: null, stages: [], receivedTokens: false };
}

/** Apply one SSE event to the streaming assistant item (immutable). */
export function applyStreamEvent(item: ChatItem, event: ChatStreamEvent): ChatItem {
  const live = item.live ?? newLiveState();
  switch (event.event) {
    case "meta":
      return {
        ...item,
        message: {
          ...item.message,
          id: event.data.assistant_message_id || item.message.id,
          conversation_id: event.data.conversation_id,
        },
      };
    case "status": {
      const prev = live.stages[live.stages.length - 1];
      const stages =
        prev && prev.stage === event.data.stage
          ? [...live.stages.slice(0, -1), event.data]
          : [...live.stages, event.data];
      return { ...item, live: { ...live, stage: event.data, stages } };
    }
    case "retrieval":
      return { ...item, message: { ...item.message, retrieval: event.data }, live };
    case "token":
      return {
        ...item,
        message: { ...item.message, content: item.message.content + event.data.delta },
        live: { ...live, receivedTokens: true },
      };
    case "done":
      // The persisted message replaces streamed text (citations may have been sanitized).
      return {
        key: item.key,
        message: event.data.message,
        evalGrace: EVALUATION_EMPTY_GRACE_POLLS,
        pollErrors: 0,
      };
    case "error":
      return {
        key: item.key,
        message: { ...item.message, status: "failed", error_message: event.data.message },
      };
    default:
      return item;
  }
}

/** Build view items from persisted conversation messages. */
export function itemsFromMessages(messages: readonly MessageOut[]): ChatItem[] {
  return messages.map((m) => ({ key: m.id, message: m, evalGrace: 0, pollErrors: 0 }));
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Read a conversation's stored scope ({document_ids, collection_id}) defensively. */
export function scopeFromConversation(scope: JsonObject | null | undefined): ChatScope {
  if (!scope) return EMPTY_SCOPE;
  const collection = scope.collection_id;
  return {
    documentIds: asStringArray(scope.document_ids),
    collectionId: typeof collection === "string" && collection ? collection : null,
  };
}

export function scopeToRequest(scope: ChatScope): Pick<ChatRequest, "document_ids" | "collection_id"> {
  return {
    document_ids: scope.documentIds.length > 0 ? scope.documentIds : null,
    collection_id: scope.collectionId,
  };
}

export function isScopeEmpty(scope: ChatScope): boolean {
  return scope.documentIds.length === 0 && scope.collectionId === null;
}

/** Index of the last user item (the one a regenerate re-answers). */
export function lastUserIndex(items: readonly ChatItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].message.role === "user") return i;
  return -1;
}

export function lastAssistantKey(items: readonly ChatItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].message.role === "assistant") return items[i].key;
  return null;
}

/* ------------------------------------------------------------- guardrails */

const GUARDRAIL_CATEGORY_LABELS: Record<string, string> = {
  prompt_injection: "Prompt injection",
  jailbreak: "Jailbreak attempt",
  privilege_escalation: "Privilege escalation",
  classified_access: "Request for restricted information",
  secret_extraction: "Secret extraction",
  llm_detected_attack: "Flagged by the AI security check",
};

export function guardrailCategoryLabel(category: string | null | undefined): string {
  if (!category) return "Security policy";
  return GUARDRAIL_CATEGORY_LABELS[category] ?? category.replace(/[._]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Read `metadata.guardrail` defensively (shape documented in GuardrailInfo). */
export function guardrailFromMetadata(metadata: JsonObject | null | undefined): GuardrailInfo | null {
  const raw = metadata?.guardrail;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const g = raw as Record<string, unknown>;
  const redactions: Record<string, number> = {};
  if (g.redactions && typeof g.redactions === "object" && !Array.isArray(g.redactions)) {
    for (const [kind, n] of Object.entries(g.redactions as Record<string, unknown>)) {
      if (typeof n === "number" && n > 0) redactions[kind] = n;
    }
  }
  return {
    blocked: g.blocked === true,
    category: typeof g.category === "string" ? g.category : null,
    reasons: Array.isArray(g.reasons) ? g.reasons.filter((r): r is string => typeof r === "string") : [],
    source: typeof g.source === "string" ? g.source : undefined,
    redactions: Object.keys(redactions).length > 0 ? redactions : undefined,
  };
}

const REDACTION_NOUNS: Record<string, [string, string]> = {
  email: ["email address", "email addresses"],
  phone: ["phone number", "phone numbers"],
  credit_card: ["card number", "card numbers"],
  ssn: ["ID number", "ID numbers"],
  iban: ["bank account number", "bank account numbers"],
  api_key: ["API key", "API keys"],
  private_key: ["private key", "private keys"],
  jwt: ["access token", "access tokens"],
  password: ["password", "passwords"],
};

/** {email: 2, phone: 1} → "2 email addresses, 1 phone number" */
export function redactionSummary(redactions: Record<string, number> | undefined): string {
  if (!redactions) return "";
  return Object.entries(redactions)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => {
      const [one, many] = REDACTION_NOUNS[kind.toLowerCase()] ?? [kind.replace(/_/g, " "), `${kind.replace(/_/g, " ")} items`];
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(", ");
}
