"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "../../../components/ui/Icon";
import { CONTACT_EMAIL } from "../../../lib/constants";

const CHECKLIST_KEYS = ["account", "issue", "context"] as const;

export default function SupportPage() {
  const t = useTranslations("supportPage");
  const emailHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t("emailSubject"))}`;

  return (
    <section className="relative overflow-hidden px-6 py-16 sm:py-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 mx-auto h-72 max-w-4xl rounded-full bg-accent/10 blur-3xl"
      />

      <div className="relative mx-auto max-w-5xl">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            {t("eyebrow")}
          </span>
          <h1
            data-testid="support-page-title"
            className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl"
          >
            {t("title")}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-text-secondary">
            {t("subtitle")}
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="rounded-2xl border border-border bg-surface p-7 sm:p-9">
            <div className="flex items-start gap-4">
              <span
                aria-hidden="true"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"
              >
                {Icon.mail("h-5 w-5")}
              </span>
              <div>
                <h2 className="text-2xl font-bold">{t("contactTitle")}</h2>
                <p className="mt-2 leading-relaxed text-text-secondary">{t("contactBody")}</p>
              </div>
            </div>

            <a
              href={emailHref}
              className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 font-semibold text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:w-auto"
            >
              {t("emailCta")}
              {Icon.arrow("h-4 w-4")}
            </a>
            <p className="mt-4 text-sm text-text-muted">
              {t("emailLabel")}{" "}
              <a className="font-medium text-text-secondary hover:text-accent" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
            </p>
          </article>

          <article className="rounded-2xl border border-border bg-surface/70 p-7 sm:p-9">
            <h2 className="text-xl font-bold">{t("prepareTitle")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">{t("prepareBody")}</p>
            <ul className="mt-6 space-y-4">
              {CHECKLIST_KEYS.map((key) => (
                <li key={key} className="flex items-start gap-3 text-sm leading-relaxed text-text-secondary">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-400"
                  >
                    {Icon.check("h-3 w-3")}
                  </span>
                  {t(`checklist.${key}`)}
                </li>
              ))}
            </ul>
          </article>
        </div>

        <aside className="mt-6 flex flex-col gap-4 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-6 sm:flex-row sm:items-start">
          <span aria-hidden="true" className="shrink-0 text-amber-300">
            {Icon.shield("h-6 w-6")}
          </span>
          <div>
            <h2 className="font-semibold text-amber-100">{t("securityTitle")}</h2>
            <p className="mt-1 text-sm leading-relaxed text-text-secondary">{t("securityBody")}</p>
          </div>
        </aside>

        <div className="mt-10 text-center">
          <Link
            href="/"
            className="text-sm font-medium text-text-secondary transition-colors hover:text-accent"
          >
            {t("backHome")}
          </Link>
        </div>
      </div>
    </section>
  );
}
