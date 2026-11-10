import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { siteSettings } from "@/db/schema";
import { safeWebsiteUrl } from "./media-links";

export const COPY_WEBSITE_KEY = "copy_link_website_url";

/** The saved site-wide website opened after a Copy Link click, or null when none is saved. */
export async function getCopyWebsite(): Promise<string | null> {
  const [setting] = await db.select({ value: siteSettings.value })
    .from(siteSettings).where(eq(siteSettings.key, COPY_WEBSITE_KEY)).limit(1);
  return safeWebsiteUrl(setting?.value);
}
