"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { DemoContract } from "../../data/demo-catalog";

/**
 * The label that travels with a demo wherever it is rendered.
 *
 * In the document flow, above the panel, at full contrast — not a tooltip, not
 * a footnote, not `title=""`. A visitor who reads only the first line must
 * already know they are looking at a drawing, because the panel underneath
 * shows a confirmed appointment and a reader who trusts it will plan around it.
 *
 * The badge states the ANIMATION's kind; the line under it states the
 * CAPABILITY's state. Collapsing the two — "illustrative, and therefore the
 * feature is unproven", or worse "the feature works, so the animation is
 * evidence" — is the misreading this component exists to prevent, so both are
 * printed, separately, always.
 */
export function DemoFrame({
  contract,
  children,
  className = "",
}: {
  contract: DemoContract;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations("labelledDemos");

  return (
    <figure
      className={`m-0 flex h-full flex-col ${className}`}
      data-demo-id={contract.id}
      data-demo-kind={contract.kind}
      data-demo-capability-state={contract.capabilityState}
    >
      <figcaption className="mb-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/35 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-amber-200">
          {t(`kind.${contract.kind}`)}
        </span>
        <span className="mt-2 block text-xs leading-relaxed text-text-muted">
          {t(`capability.${contract.capabilityState}`)}
        </span>
      </figcaption>
      <div className="flex-1">{children}</div>
    </figure>
  );
}
