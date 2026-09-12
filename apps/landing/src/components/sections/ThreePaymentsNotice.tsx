"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "../ui/Icon";
import { routes } from "../../lib/routes";

/**
 * The short form of the three payments, for the places where somebody is about
 * to act: next to the price, and next to the CTA.
 *
 * Deliberately NOT a tooltip, a hover card or an accordion. The whole point is
 * that a visitor who never clicks anything still learns that Meta will bill
 * their own account from 1 October 2026 — so the text is in the document flow,
 * always visible, and reads the same at 400% zoom as it does on a phone.
 */
export function ThreePaymentsNotice({ className = "" }: { className?: string }) {
  const t = useTranslations("payments");

  return (
    <aside
      aria-label={t("noticeAriaLabel")}
      className={`mx-auto flex max-w-3xl flex-col items-start gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/5 px-5 py-4 text-left sm:flex-row sm:items-center sm:gap-4 ${className}`}
    >
      <span className="shrink-0 text-amber-300" aria-hidden="true">
        {Icon.shield("h-5 w-5")}
      </span>
      <p className="text-sm leading-relaxed text-text-secondary">
        {t("noticeShort")}{" "}
        <Link
          href={routes.whatsappCosts}
          className="font-semibold text-accent underline underline-offset-2 transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {t("noticeLink")}
        </Link>
      </p>
    </aside>
  );
}
