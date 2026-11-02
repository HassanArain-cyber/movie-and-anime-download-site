export const CONTACT_REQUEST_TYPES = ["Movie", "Anime", "Episode", "Other"] as const;
export type ContactRequestType = (typeof CONTACT_REQUEST_TYPES)[number];

export interface ContactRequest {
  name: string;
  type: ContactRequestType;
  message: string;
}
