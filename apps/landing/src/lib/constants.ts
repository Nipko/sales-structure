export const SIGNUP_URL = "https://admin.parallly-chat.cloud/signup";
export const LOGIN_URL = "https://admin.parallly-chat.cloud/login";
export const CONTACT_EMAIL = "it.executive@parallext.com";
export const SITE_URL = "https://parallly-chat.cloud";
export const ANDROID_EARLY_ACCESS_URL = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
  "Parallly Android — early access",
)}`;
// "Talk to our AI now" — Parallly's own WhatsApp agent (dogfooding). Pre-filled greeting.
export const WHATSAPP_URL = `https://wa.me/573134328491?text=${encodeURIComponent(
  "Hola, quiero ver cómo funciona la IA de Parallly",
)}`;

export function planSignupUrl(plan: string, country: string, cycle: "monthly" | "annual"): string {
  const url = new URL(SIGNUP_URL);
  url.searchParams.set("plan", plan);
  url.searchParams.set("country", country);
  url.searchParams.set("cycle", cycle);
  return url.toString();
}

export function planContactUrl(planName: string, country: string, cycle: "monthly" | "annual"): string {
  const subject = `Parallly — ${planName} (${country}, ${cycle})`;
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
