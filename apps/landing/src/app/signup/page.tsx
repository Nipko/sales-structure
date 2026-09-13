"use client";

import { useEffect } from "react";
import { DASHBOARD_SIGNUP_URL } from "../../lib/constants";
import { locales } from "../../i18n/config";
import { VERTICALS } from "../../data/verticals";

/**
 * ═══ THE ONLY THINGS ALLOWED THROUGH THE HOP TO THE DASHBOARD ═══════════════
 *
 * Same-origin acquisition bridge. `strict-origin-when-cross-origin` normally
 * reduces the landing referrer to its host before the dashboard can read it;
 * this page sees the complete same-origin URL, keeps only what is on the list
 * below, and forwards nothing else.
 *
 * WHAT CHANGED, AND WHY IT MATTERED. The bridge used to forward `plan`,
 * `country`, `cycle` and the five UTMs after one check: truncate to 160
 * characters. Truncation is not validation. `?plan=` could carry a hundred and
 * sixty characters of anything — a prompt, an email address, a URL — into a
 * query string that gets logged, stored against the signup and attributed in
 * analytics. And two parameters the programme requires to survive the hop,
 * language and vertical, were being dropped on the floor.
 *
 * So every parameter now has a SHAPE, and a value that does not match it is
 * discarded rather than trimmed:
 *
 *   - `plan` a slug. Matched by pattern rather than against a fixed list,
 *     because plans come from the runtime billing catalogue and a new one must
 *     not be silently dropped here — but a slug cannot contain `:` or `/`, so a
 *     URL can never ride in on it.
 *   - `country` two letters, upper-cased. `cycle` one of two words.
 *   - `lang` one of the four the interface actually speaks. `es-AR` is an
 *     overlay of `es`, not a fifth locale, so it is not accepted as one.
 *   - `vertical` a slug that exists in the published catalogue. An unknown
 *     industry would land the wizard on a preset that is not there.
 *   - the UTMs a conservative token: letters, digits, dot, dash, underscore.
 *     No colon, no slash, no percent — which is what keeps an external URL, an
 *     encoded payload and an email address out of the attribution fields.
 *
 * Nothing here ever forwards a free-text field, a credential, a permission or a
 * destination. The redirect target is a constant, so no input can redirect the
 * visitor anywhere.
 */

const SLUG = /^[a-z][a-z0-9_-]{1,32}$/;
const ATTRIBUTION_TOKEN = /^[A-Za-z0-9._-]{1,64}$/;
const CAMPAIGN_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

const VERTICAL_SLUGS = new Set(VERTICALS.map((vertical) => vertical.slug));

/** Returns the value to forward, or `null` to drop the parameter entirely. */
const ALLOWLIST: Record<string, (raw: string) => string | null> = {
  // Public links and old campaigns used display names (`Pro`) while current
  // CTAs use catalogue slugs (`pro`).  The dashboard already consumes the
  // canonical lower-case slug, so normalize before validating instead of
  // silently dropping a valid selection at the cross-origin hop.
  plan: (raw) => {
    const normalized = raw.toLowerCase();
    return SLUG.test(normalized) ? normalized : null;
  },
  country: (raw) => (/^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : null),
  cycle: (raw) => (raw === "monthly" || raw === "annual" ? raw : null),
  lang: (raw) => ((locales as readonly string[]).includes(raw) ? raw : null),
  vertical: (raw) => (SLUG.test(raw) && VERTICAL_SLUGS.has(raw) ? raw : null),
  ...Object.fromEntries(
    CAMPAIGN_KEYS.map((key) => [key, (raw: string) => (ATTRIBUTION_TOKEN.test(raw) ? raw : null)]),
  ),
};

/** A landing path, or nothing. Never an absolute URL and never a query string. */
function safeSourcePath(pathname: string): string | null {
  return /^\/[A-Za-z0-9/_-]{0,120}$/.test(pathname) ? pathname : null;
}

export default function SignupAttributionBridge() {
  useEffect(() => {
    const target = new URL(DASHBOARD_SIGNUP_URL);
    const bridgeParams = new URLSearchParams(window.location.search);

    // Values explicitly attached to the CTA win over anything inferred.
    for (const [key, accept] of Object.entries(ALLOWLIST)) {
      const raw = bridgeParams.get(key);
      if (raw === null) continue;
      const value = accept(raw.trim());
      if (value !== null) target.searchParams.set(key, value);
    }

    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin === window.location.origin) {
        target.searchParams.set("source", "marketing_site");
        const sourcePath = safeSourcePath(referrer.pathname);
        if (sourcePath) target.searchParams.set("source_path", sourcePath);
        for (const key of CAMPAIGN_KEYS) {
          if (target.searchParams.has(key)) continue;
          const raw = referrer.searchParams.get(key);
          const value = raw === null ? null : ALLOWLIST[key](raw.trim());
          if (value !== null) target.searchParams.set(key, value);
        }
      }
    } catch {
      target.searchParams.set("source", "marketing_site");
    }

    window.location.replace(target.toString());
  }, []);

  return (
    <main className="min-h-screen grid place-items-center bg-background">
      <div className="h-9 w-9 rounded-full border-2 border-border border-t-accent animate-spin" />
    </main>
  );
}
