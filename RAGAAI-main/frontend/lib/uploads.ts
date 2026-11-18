/**
 * Client-side pre-validation of uploads against /api/system limits.
 * The server remains the source of truth (it may still reject or flag duplicates).
 */

export interface UploadLimits {
  maxUploadMb?: number | null;
  supportedExtensions?: readonly string[] | null;
}

export interface LocalRejection {
  file: File;
  reason: string;
}

/** ".PDF" / "pdf" → "pdf" */
export function normalizeExtension(ext: string): string {
  return ext.trim().toLowerCase().replace(/^\.+/, "");
}

export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? normalizeExtension(name.slice(i + 1)) : "";
}

/** Value for <input accept>, e.g. ".pdf,.docx"; empty when unrestricted. */
export function acceptAttribute(exts: readonly string[] | null | undefined): string {
  if (!exts || exts.length === 0) return "";
  return exts.map((e) => `.${normalizeExtension(e)}`).join(",");
}

export function validateFiles(
  files: readonly File[],
  limits: UploadLimits,
): { accepted: File[]; rejected: LocalRejection[] } {
  const allowed = (limits.supportedExtensions ?? []).map(normalizeExtension).filter(Boolean);
  const maxBytes = limits.maxUploadMb && limits.maxUploadMb > 0 ? limits.maxUploadMb * 1024 * 1024 : null;
  const accepted: File[] = [];
  const rejected: LocalRejection[] = [];

  for (const file of files) {
    const ext = fileExtension(file.name);
    if (allowed.length > 0 && !allowed.includes(ext)) {
      rejected.push({
        file,
        reason: ext ? `.${ext} files are not supported` : "File has no extension",
      });
    } else if (maxBytes !== null && file.size > maxBytes) {
      rejected.push({ file, reason: `Larger than the ${limits.maxUploadMb} MB upload limit` });
    } else if (file.size === 0) {
      rejected.push({ file, reason: "File is empty" });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}
