import type { Metadata } from "next";

import { RequirePermission } from "@/components/access/require-permission";
import { DocumentLibrary } from "@/components/documents/document-library";

export const metadata: Metadata = { title: "Documents" };

export default function AdminDocumentsPage() {
  return (
    <RequirePermission permission="documents.manage">
      <DocumentLibrary />
    </RequirePermission>
  );
}
