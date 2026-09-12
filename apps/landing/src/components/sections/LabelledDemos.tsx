"use client";

import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { DemoFrame } from "../demos/DemoFrame";
import { CalendarDemo } from "../demos/CalendarDemo";
import { OrderPaymentDemo } from "../demos/OrderPaymentDemo";
import { InboxDemo } from "../demos/InboxDemo";
import { AgentConfigDemo } from "../demos/AgentConfigDemo";
import { LABELLED_DEMOS, type DemoId } from "../../data/demo-catalog";
import { routes } from "../../lib/routes";
import Link from "next/link";

/**
 * The four tasks, each drawn and each labelled as a drawing.
 *
 * Grouping them on one page is itself part of the disclosure: four panels side
 * by side, all carrying the same badge, make the badge legible as a category
 * rather than as a hedge on one weak claim. Scattered one per page, the label
 * reads as an apology; together, it reads as the site's policy.
 *
 * The order is the order a business meets them — book something, sell
 * something, get a person involved, set the thing up — not the order they were
 * built in.
 */

const PANELS: Record<DemoId, () => React.ReactElement> = {
  appointment: () => <CalendarDemo />,
  orderPayment: () => <OrderPaymentDemo />,
  handoff: () => <InboxDemo />,
  configuration: () => <AgentConfigDemo />,
};

export function LabelledDemos() {
  const t = useTranslations("labelledDemos");

  return (
    <Section id="demostraciones" className="border-t border-border/50">
      <div className="mb-10 text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("title")}</h2>
        <p className="mx-auto mt-4 max-w-2xl leading-relaxed text-text-secondary">
          {t("subtitle")}
        </p>
      </div>

      {/* What the three labels mean, once, before any of them is used. A badge
          whose vocabulary is never defined is decoration. */}
      <dl className="mx-auto mb-10 grid max-w-4xl gap-4 sm:grid-cols-3">
        {(["illustrative", "localTest", "realCase"] as const).map((kind) => (
          <div key={kind} className="rounded-2xl border border-border bg-surface/50 p-4">
            <dt className="text-xs font-semibold uppercase tracking-wider text-text-primary">
              {t(`kind.${kind}`)}
            </dt>
            <dd className="mt-1.5 text-xs leading-relaxed text-text-muted">
              {t(`kindMeaning.${kind}`)}
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 sm:grid-cols-2">
        {LABELLED_DEMOS.map((contract) => {
          const Panel = PANELS[contract.id];
          return (
            <div key={contract.id} className="glass-card flex flex-col gap-4 rounded-2xl p-5">
              <div>
                <h3 className="text-lg font-semibold text-text-primary">
                  {t(`${contract.i18nKey}.title`)}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
                  {t(`${contract.i18nKey}.body`)}
                </p>
              </div>
              <DemoFrame contract={contract}>
                <Panel />
              </DemoFrame>
            </div>
          );
        })}
      </div>

      <p className="mx-auto mt-10 max-w-2xl text-center text-sm leading-relaxed text-text-muted">
        {t("closingNote")}{" "}
        <Link
          href={routes.whatsappCosts}
          className="font-semibold text-accent underline underline-offset-2 transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {t("closingLink")}
        </Link>
      </p>
    </Section>
  );
}
