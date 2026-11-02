export type RequestType = "Movie" | "Anime" | "Episode" | "Other";

export interface ContactRequest {
  name: string;
  type: RequestType;
  message: string;
}

const TELEGRAM_CONTACT = "https://t.me/Gojo_Saturo_6";

export function buildRequestLinks(request: ContactRequest, adminEmail: string) {
  const body = `Name: ${request.name.trim()}\nRequest Type: ${request.type}\n\nMessage:\n${request.message.trim()}`;
  const subject = `Vault ${request.type} request`;
  const query = new URLSearchParams({ text: body }).toString();
  const gmailQuery = new URLSearchParams({ view: "cm", fs: "1", to: adminEmail.trim(), su: subject, body }).toString();
  return {
    telegram: `${TELEGRAM_CONTACT}?${query}`,
    gmail: adminEmail.trim() ? `https://mail.google.com/mail/?${gmailQuery}` : null,
  };
}
