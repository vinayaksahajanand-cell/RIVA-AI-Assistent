import type { Metadata } from "next";

import { DocumentLibrary } from "@/components/documents/document-library";

export const metadata: Metadata = { title: "Document Library" };

export default function DocumentsPage() {
  return <DocumentLibrary />;
}
