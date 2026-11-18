import { apiFetch } from "@/services/http";
import type { CollectionCreate, CollectionOut, OkResponse } from "@/lib/types";

export function listCollections(signal?: AbortSignal): Promise<CollectionOut[]> {
  return apiFetch<CollectionOut[]>("/api/collections", { signal });
}

export function createCollection(body: CollectionCreate): Promise<CollectionOut> {
  return apiFetch<CollectionOut>("/api/collections", { method: "POST", json: body });
}

export function deleteCollection(id: string): Promise<OkResponse> {
  return apiFetch<OkResponse>(`/api/collections/${encodeURIComponent(id)}`, { method: "DELETE" });
}
