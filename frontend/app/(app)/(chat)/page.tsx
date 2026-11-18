import type { Metadata } from "next";

export const metadata: Metadata = { title: "Chat" };

/** The chat UI is rendered by the (chat) layout so it survives the "/" → "/c/{id}" transition. */
export default function ChatHomePage() {
  return null;
}
