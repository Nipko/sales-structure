"use client";

import Link from "../LocalizedLink";
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
 *
 * The custody line was added for the same reason the notice exists at all. The
 * three payments alone tell a reader that Meta charges them; they do not tell
 * them WHERE that card is entered, and the gap is where "Parallly holds my
 * Meta card" lives. Somebody who reads only this box, on any page carrying it,
 * now knows the answer without opening the canonical page.
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
      <div>
        <p className="text-sm leading-relaxed text-text-secondary">
          {t("noticeShort")}{" "}
          <Link
            href={routes.whatsappCosts}
            className="font-semibold text-accent underline underline-offset-2 transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {t("noticeLink")}
          </Link>
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{t("noticeCustody")}</p>
      </div>
    </aside>
  );
}
