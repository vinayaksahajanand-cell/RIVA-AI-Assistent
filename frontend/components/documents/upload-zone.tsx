"use client";

import { CloudUpload, Loader2 } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import { ClassificationBadge } from "@/components/access/access-badges";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Classification, CollectionOut } from "@/lib/types";
import { acceptAttribute } from "@/lib/uploads";
import { cn } from "@/lib/utils";

const NONE = "__none__";
const DEFAULT = "__default__";

/** Drag & drop / click multi-file upload with an optional target collection and classification. */
export function UploadZone({
  onFiles,
  uploading,
  supportedExtensions,
  maxUploadMb,
  collections,
  targetCollectionId,
  onTargetCollectionChange,
  classifications = [],
  classification = null,
  onClassificationChange,
}: {
  onFiles: (files: File[]) => void;
  uploading: boolean;
  supportedExtensions: readonly string[] | undefined;
  maxUploadMb: number | undefined;
  collections: readonly CollectionOut[];
  targetCollectionId: string | null;
  onTargetCollectionChange: (id: string | null) => void;
  /** Classifications the uploader may assign; empty hides the selector. */
  classifications?: readonly Classification[];
  /** null = workspace default classification. */
  classification?: Classification | null;
  onClassificationChange?: (value: Classification | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const exts = (supportedExtensions ?? []).map((x) => x.replace(/^\./, "").toUpperCase());

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload documents: drop files here or press Enter to browse"
        aria-disabled={uploading}
        onClick={() => !uploading && input.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !uploading) {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragEnter={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          depth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => isFileDrag(e) && e.preventDefault()}
        onDragLeave={(e) => {
          if (!isFileDrag(e)) return;
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          if (uploading) return;
          const files = Array.from(e.dataTransfer.files);
          if (files.length) onFiles(files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors outline-none",
          "bg-gradient-to-b from-accent/40 to-background hover:border-violet-300 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/40",
          dragging ? "border-primary/60 bg-accent/70" : "border-violet-200/80",
          uploading && "cursor-progress opacity-80",
        )}
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-violet-100">
          {uploading ? <Loader2 className="size-5 animate-spin text-primary" /> : <CloudUpload className="size-5 text-primary" />}
        </span>
        <p className="text-sm font-medium">
          {uploading ? "Uploading…" : dragging ? "Drop to upload" : "Drop files here, or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground">
          {exts.length > 0 ? exts.join(" · ") : "Supported formats are validated by the server"}
          {maxUploadMb ? ` — up to ${maxUploadMb} MB per file` : ""}
        </p>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={acceptAttribute(supportedExtensions) || undefined}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) onFiles(files);
          }}
        />
      </div>
      {(collections.length > 0 || (classifications.length > 0 && onClassificationChange)) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {classifications.length > 0 && onClassificationChange && (
            <span className="flex items-center gap-2">
              <span id="upload-classification-label">Classify uploads as</span>
              <Select
                value={classification ?? DEFAULT}
                onValueChange={(v) => onClassificationChange(v === DEFAULT ? null : (v as Classification))}
              >
                <SelectTrigger size="sm" className="h-7 min-w-40 text-xs" aria-labelledby="upload-classification-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT}>Workspace default</SelectItem>
                  {classifications.map((c) => (
                    <SelectItem key={c} value={c}>
                      <ClassificationBadge value={c} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </span>
          )}
          {collections.length > 0 && (
            <span className="flex items-center gap-2">
              <span id="upload-collection-label">Add uploads to collection</span>
              <Select
                value={targetCollectionId ?? NONE}
                onValueChange={(v) => onTargetCollectionChange(v === NONE ? null : v)}
              >
                <SelectTrigger size="sm" className="h-7 min-w-40 text-xs" aria-labelledby="upload-collection-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No collection</SelectItem>
                  {collections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
