"use client";

import Link from "@/components/LocalizedLink";
import { useTranslations } from "next-intl";
import { PageContents } from "../../../../components/sections/CommercialGuide";
import { Section } from "../../../../components/ui/Section";
import { Icon } from "../../../../components/ui/Icon";
import { JsonLd } from "../../../../components/ui/JsonLd";
import { breadcrumbJsonLd } from "../../../../lib/seo";
import { routes } from "../../../../lib/routes";
import {
  COMPARISON_TASKS,
  COMPARISON_VERIFIED_AT,
  META_SURFACES,
  NATIVE_IS_ENOUGH_CASES,
  REFUTED_CLAIMS,
  type EvidenceState,
  type MetaSurfaceId,
  type TaskVerdict,
} from "../../../../data/meta-comparison";

/**
 * ═══ A COMPARISON THAT CAN SURVIVE BEING CHECKED ════════════════════════════
 *
 * Everything here is a state with a source next to it. There is no "winner"
 * column, no tick-versus-cross grid, and no number that a benchmark would have
 * to justify — because no benchmark has been run against an eligible Meta
 * account, and saying otherwise would be the one lie a reader can catch in five
 * minutes.
 *
 * Two structural choices carry that:
 *   - the verdict column reads "different scope" or "not comparable" far more
 *     often than "we win", because that is what the evidence supports; and
 *   - two whole sections exist to concede: where the native agent is probably
 *     enough, and which flattering claims we refused to make.
 *
 * Accessibility note: the states are words, never colour alone, so the table
 * still means the same thing in greyscale and to a screen reader.
 */

const STATE_LABEL_KEY: Record<EvidenceState, string> = {
  implementedNotCertified: "stateImplementedNotCertified",
  documented: "stateDocumented",
  documentedWithLimits: "stateDocumentedWithLimits",
  requiresAccountCheck: "stateRequiresAccountCheck",
  notDocumented: "stateNotDocumented",
};

const VERDICT_LABEL_KEY: Record<TaskVerdict, string> = {
  bothCovered: "verdictBothCovered",
  differentScope: "verdictDifferentScope",
  notComparable: "verdictNotComparable",
  nativeMayBeEnough: "verdictNativeMayBeEnough",
};

const SURFACE_LABEL_KEY: Record<MetaSurfaceId, string> = {
  appAgent: "surfaceAppAgentTitle",
  platformApi: "surfacePlatformApiTitle",
  ownerAssistant: "surfaceOwnerAssistantTitle",
};

const STATE_TONE: Record<EvidenceState, string> = {
  implementedNotCertified: "border-accent/30 bg-accent/10 text-accent",
  documented: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  documentedWithLimits: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  requiresAccountCheck: "border-border bg-surface-light/50 text-text-secondary",
  notDocumented: "border-border bg-surface-light/50 text-text-muted",
};

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** A short host label so a reader can see where a link goes before clicking. */
function sourceHost(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

const METHOD_POINTS = ["method1", "method2", "method3", "method4"] as const;
const METHOD_LIMITS = ["methodLimit1", "methodLimit2", "methodLimit3"] as const;

export default function CompareMetaBusinessAgentPage() {
  const t = useTranslations("compareMeta");

  const allSources = Array.from(
    new Set([
      ...META_SURFACES.map((surface) => surface.sourceUrl),
      ...COMPARISON_TASKS.flatMap((task) => task.sources),
    ]),
  );

  return (
    <div className="reference-page">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Inicio", url: routes.home },
          { name: "Comparar con Meta", url: routes.compareMetaBusinessAgent },
        ])}
      />

      {/* Hero */}
      <section className="px-6 pb-8 pt-12">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            {t("heroEyebrow")}
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">{t("heroTitle")}</h1>
          <p className="mt-5 text-lg leading-relaxed text-text-secondary">{t("heroSubtitle")}</p>
          <p className="mt-6 text-sm text-text-muted">
            <time dateTime={COMPARISON_VERIFIED_AT}>{t("heroDate")}</time>
          </p>
        </div>
      </section>
      <PageContents kind="compare" />

      {/* Methodology */}
      <Section id="criterios" className="border-y border-border/50 bg-surface/20">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{t("methodTitle")}</h2>
            <ul className="mt-5 space-y-3">
              {METHOD_POINTS.map((key) => (
                <li key={key} className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 text-accent" aria-hidden="true">
                    {Icon.check("h-4 w-4")}
                  </span>
                  <p className="text-sm leading-relaxed text-text-secondary">{t(key)}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-surface/60 p-6">
            <h2 className="text-xl font-semibold text-text-primary">{t("methodLimitsTitle")}</h2>
            <ul className="mt-5 space-y-3">
              {METHOD_LIMITS.map((key) => (
                <li key={key} className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true">
                    {Icon.minus("h-4 w-4")}
                  </span>
                  <p className="text-sm leading-relaxed text-text-secondary">{t(key)}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* The three Meta surfaces */}
      <Section id="alcance">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("surfacesTitle")}</h2>
          <p className="mt-4 leading-relaxed text-text-secondary">{t("surfacesIntro")}</p>
        </div>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {META_SURFACES.map((surface) => (
            <article key={surface.id} className="glass-card flex h-full flex-col rounded-2xl p-6">
              <h3 className="text-base font-semibold leading-snug text-text-primary">
                {t(SURFACE_LABEL_KEY[surface.id])}
              </h3>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-text-secondary">
                {t(`surface${capitalise(surface.id)}Body`)}
              </p>
              <p className="mt-5 border-t border-border/70 pt-3 text-xs text-text-muted">
                {t("surfaceSource")}:{" "}
                <a
                  href={surface.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-accent underline underline-offset-2 transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  {sourceHost(surface.sourceUrl)}
                </a>{" "}
                ·{" "}
                {surface.sourceUpdatedAt
                  ? t("surfaceUpdated", { date: surface.sourceUpdatedAt })
                  : t("surfaceUndated")}
              </p>
            </article>
          ))}
        </div>
      </Section>

      {/* Task by task */}
      <Section id="tareas" className="border-y border-border/50 bg-surface/20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("tableTitle")}</h2>
          <p className="mt-4 leading-relaxed text-text-secondary">{t("tableIntro")}</p>
        </div>

        {/*
          A scrollable table is only operable by keyboard if the scroll region
          itself can take focus, so it is a labelled region with tabIndex 0
          rather than a bare overflow div. The scroll stays inside this element;
          the page body never moves sideways.
        */}
        <div
          className="relative -mx-6 mt-10 overflow-x-auto px-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          role="region"
          aria-label={t("tableCaption")}
          tabIndex={0}
        >
          <table className="w-full min-w-[720px] border-collapse text-left">
            <caption className="sr-only">{t("tableCaption")}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="w-[20%] py-4 pr-4 text-sm font-semibold text-text-secondary">
                  {t("colTask")}
                </th>
                <th scope="col" className="w-[28%] px-4 py-4 text-sm font-semibold text-text-secondary">
                  {t("colParallly")}
                </th>
                <th scope="col" className="w-[32%] px-4 py-4 text-sm font-semibold text-text-secondary">
                  {t("colMeta")}
                </th>
                <th scope="col" className="w-[20%] px-4 py-4 text-sm font-semibold text-text-secondary">
                  {t("colVerdict")}
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_TASKS.map((task) => (
                <tr key={task.id} className="border-b border-border/40 align-top">
                  <th scope="row" className="py-5 pr-4 text-sm font-semibold text-text-primary">
                    {t(`task${capitalise(task.id)}Label`)}
                    {task.metaSurface !== "appAgent" && (
                      <span className="mt-2 block text-xs font-normal text-text-muted">
                        {t("surfaceLabel")}: {t(SURFACE_LABEL_KEY[task.metaSurface])}
                      </span>
                    )}
                  </th>
                  <td className="px-4 py-5">
                    <span
                      className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATE_TONE[task.parallly]}`}
                    >
                      {t(STATE_LABEL_KEY[task.parallly])}
                    </span>
                    <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                      {t(`task${capitalise(task.id)}Parallly`)}
                    </p>
                  </td>
                  <td className="px-4 py-5">
                    <span
                      className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATE_TONE[task.meta]}`}
                    >
                      {t(STATE_LABEL_KEY[task.meta])}
                    </span>
                    <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                      {t(`task${capitalise(task.id)}Meta`)}
                    </p>
                    <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                      <span>{t("colSources")}:</span>
                      {task.sources.map((url, index) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="text-accent underline underline-offset-2 transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                        >
                          <span className="sr-only">
                            {t("sourceLink", { number: index + 1 })} —{" "}
                          </span>
                          {sourceHost(url)}
                        </a>
                      ))}
                    </p>
                  </td>
                  <td className="px-4 py-5 text-sm font-medium text-text-primary">
                    {t(VERDICT_LABEL_KEY[task.verdict])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Where the native option is enough */}
      <Section id="elegir">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("nativeEnoughTitle")}</h2>
          <p className="mt-4 leading-relaxed text-text-secondary">{t("nativeEnoughIntro")}</p>
          <ul className="mt-6 space-y-3">
            {NATIVE_IS_ENOUGH_CASES.map((key) => (
              <li
                key={key}
                className="flex items-start gap-3 rounded-xl border border-border bg-surface/60 p-4"
              >
                <span className="mt-0.5 shrink-0 text-emerald-400" aria-hidden="true">
                  {Icon.check("h-4 w-4")}
                </span>
                <p className="text-sm leading-relaxed text-text-secondary">
                  {t(`nativeEnough${capitalise(key)}`)}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-6 rounded-2xl border border-accent/25 bg-accent/5 p-5 text-sm leading-relaxed text-text-secondary">
            {t("nativeEnoughNote")}
          </p>
        </div>
      </Section>

      {/* Claims we refused */}
      <Section className="border-y border-border/50 bg-surface/20">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("refutedTitle")}</h2>
          <p className="mt-4 leading-relaxed text-text-secondary">{t("refutedIntro")}</p>
          <ul className="mt-6 space-y-3">
            {REFUTED_CLAIMS.map((key) => (
              <li key={key} className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true">
                  {Icon.x("h-4 w-4")}
                </span>
                <p className="text-sm leading-relaxed text-text-secondary">
                  {t(`refuted${capitalise(key)}`)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* Every source, once */}
      <Section id="fuentes">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight">{t("sourcesTitle")}</h2>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">{t("sourcesIntro")}</p>
          <p className="mt-1 text-xs text-text-muted">{t("sourcesExternal")}</p>
          <ol className="mt-6 space-y-2">
            {allSources.map((url, index) => (
              <li key={url} className="flex items-start gap-2 text-sm">
                <span className="shrink-0 tabular-nums text-text-muted">{index + 1}.</span>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="break-all text-accent underline underline-offset-2 transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  {url}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* Close */}
      <Section className="border-t border-border/50">
        <div className="mx-auto max-w-3xl rounded-3xl border border-accent/30 bg-gradient-to-br from-surface via-surface to-accent/10 px-6 py-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight">{t("ctaTitle")}</h2>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-text-secondary">{t("ctaBody")}</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href={routes.pricing}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-7 py-3.5 text-base font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {t("ctaPricing")}
              <span aria-hidden="true">{Icon.arrow("h-5 w-5")}</span>
            </Link>
            <Link
              href={routes.whatsappCosts}
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border bg-surface/60 px-7 py-3.5 text-base font-semibold text-text-primary transition-colors hover:border-border-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {t("ctaCosts")}
            </Link>
          </div>
        </div>
      </Section>
    </div>
  );
}
