export type PreviewDatabaseTargetCheck = "match" | "different" | "unverifiable";

/** Compare only the Neon endpoint label; never return or log the URL or hostname. */
export function checkPreviewDatabaseTarget(
  connectionString: string | undefined,
  expectedEndpointId: string,
): PreviewDatabaseTargetCheck {
  if (!connectionString) return "unverifiable";

  try {
    const url = new URL(connectionString);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return "unverifiable";

    const firstLabel = url.hostname.toLowerCase().split(".")[0];
    const expected = expectedEndpointId.toLowerCase();
    if (firstLabel === expected || firstLabel === `${expected}-pooler`) return "match";
    if (url.hostname.toLowerCase().endsWith(".neon.tech")) return "different";
    return "unverifiable";
  } catch {
    // Deliberately do not include URL parsing errors: some runtimes include the
    // original input in those messages.
    return "unverifiable";
  }
}
