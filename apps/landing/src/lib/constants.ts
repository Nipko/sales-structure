export const SITE_URL = "https://parallly-chat.cloud";
export const DASHBOARD_SIGNUP_URL = "https://admin.parallly-chat.cloud/signup";
// Route every marketing CTA through a same-origin bridge. The bridge can read
// the full landing referrer (including UTMs) before the cross-origin hop strips
// it, then forwards only an allowlisted attribution payload to the dashboard.
export const SIGNUP_URL = `${SITE_URL}/signup`;
export const LOGIN_URL = "https://admin.parallly-chat.cloud/login";
export const CONTACT_EMAIL = "it.executive@parallext.com";
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
