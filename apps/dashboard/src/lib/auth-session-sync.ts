export const AUTH_SESSION_CHANNEL = "parallly-session";
const AUTH_TAB_ID_KEY = "parallly:auth-tab-id";

export interface AuthSessionSwapMessage {
  type: "auth-session-swapped";
  sourceTabId: string;
  destination: string;
}

export function getAuthTabId(): string {
  if (typeof window === "undefined") return "server";
  const existing = sessionStorage.getItem(AUTH_TAB_ID_KEY);
  if (existing) return existing;
  const generated = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem(AUTH_TAB_ID_KEY, generated);
  return generated;
}

/** Notify every other tab after tokens, user and impersonation state are coherent. */
export function broadcastAuthSessionSwap(destination: string): void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(AUTH_SESSION_CHANNEL);
    channel.postMessage({
      type: "auth-session-swapped",
      sourceTabId: getAuthTabId(),
      destination,
    } satisfies AuthSessionSwapMessage);
    channel.close();
  } catch {
    // localStorage still changes atomically enough for a manual reload fallback.
  }
}

export function isAuthSessionSwapMessage(value: unknown): value is AuthSessionSwapMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<AuthSessionSwapMessage>;
  return message.type === "auth-session-swapped"
    && typeof message.sourceTabId === "string"
    && /^\/admin(?:\/|$)/.test(String(message.destination || ""));
}
