"use client";

import { useEffect } from "react";
import { DASHBOARD_SIGNUP_URL } from "../../lib/constants";

const CAMPAIGN_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

/**
 * Same-origin acquisition bridge. `strict-origin-when-cross-origin` normally
 * reduces the landing referrer to its host before the dashboard can read it.
 * This page sees the complete same-origin URL, keeps only marketing fields and
 * the pathname, and never forwards arbitrary query data.
 */
export default function SignupAttributionBridge() {
  useEffect(() => {
    const target = new URL(DASHBOARD_SIGNUP_URL);
    const bridgeParams = new URLSearchParams(window.location.search);

    // Explicit plan/country/cycle and UTMs already attached to the CTA win.
    for (const key of ["plan", "country", "cycle", ...CAMPAIGN_KEYS]) {
      const value = bridgeParams.get(key);
      if (value) target.searchParams.set(key, value.slice(0, 160));
    }

    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin === window.location.origin) {
        target.searchParams.set("source", "marketing_site");
        target.searchParams.set("source_path", referrer.pathname.slice(0, 160));
        for (const key of CAMPAIGN_KEYS) {
          if (target.searchParams.has(key)) continue;
          const value = referrer.searchParams.get(key);
          if (value) target.searchParams.set(key, value.slice(0, 160));
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
