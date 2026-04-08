const PHONE_RE =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}|\b\d{10,15}\b/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const IG_RE = /(?:@|(?:ig|insta|instagram)[\s:]*)([a-zA-Z0-9._]{2,30})\b/i;
const TG_RE = /(?:@|(?:tg|telegram)[\s:]*)([a-zA-Z0-9_]{4,32})\b/i;
const WA_RE = /(?:whatsapp|wa\.me|api\.whatsapp)[^\s]*/i;

export type ModerationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function moderateMessage(text: string): ModerationResult {
  const t = text.trim();
  if (!t) return { ok: false, reason: "Message is empty." };
  if (PHONE_RE.test(t)) {
    return { ok: false, reason: "Phone numbers are not allowed. Keep the chat on VibeMatch." };
  }
  if (EMAIL_RE.test(t)) {
    return { ok: false, reason: "Email addresses are not allowed in messages." };
  }
  if (IG_RE.test(t)) {
    return { ok: false, reason: "Instagram handles are not allowed." };
  }
  if (TG_RE.test(t)) {
    return { ok: false, reason: "Telegram usernames are not allowed." };
  }
  if (WA_RE.test(t)) {
    return { ok: false, reason: "WhatsApp links or numbers are not allowed." };
  }
  return { ok: true };
}
