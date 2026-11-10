import type { Metadata } from "next";
import CopyConfirmation from "./CopyConfirmation";

// The confirmation tab is a private step of the Copy Link flow: it is never
// indexed, and it carries no download URL, website or any other state in its URL.
export const metadata: Metadata = {
  title: "Link Copied — Gojo’s Vault",
  robots: { index: false, follow: false },
};

export default function CopyConfirmationPage() {
  return <CopyConfirmation />;
}
