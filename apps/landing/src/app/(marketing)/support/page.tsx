"use client";

import { useState } from "react";
import Link from "@/components/LocalizedLink";
import { useTranslations } from "next-intl";
import { Icon } from "../../../components/ui/Icon";
import { CONTACT_EMAIL } from "../../../lib/constants";

export default function SupportPage() {
  const t = useTranslations("supportPage");
  const c = useTranslations("contactPaths");
  const [business, setBusiness] = useState("");
  const [goal, setGoal] = useState("");
  const body = `${c("businessLabel")}: ${business}\n${c("goalLabel")}: ${goal}\n\n${c("emailIntro")}`;
  const salesHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(c("emailSubject"))}&body=${encodeURIComponent(body)}`;
  return <div className="reference-page">
    <section className="px-6 text-center"><div className="mx-auto">
      <p className="text-xs font-semibold uppercase tracking-[.15em] text-accent">{t("eyebrow")}</p>
      <h1 data-testid="support-page-title" className="mt-5 text-4xl sm:text-5xl font-semibold">{t("title")}</h1>
      <p className="mt-5 text-lg leading-relaxed text-text-secondary max-w-2xl mx-auto">{t("subtitle")}</p>
    </div></section>
    <section className="px-6"><div className="max-w-[1200px] mx-auto">
      <div className="grid gap-6 lg:grid-cols-2">
        <article id="evaluar-negocio" className="rounded-2xl border border-border bg-white p-7 sm:p-9">
          <span className="text-accent" aria-hidden="true">{Icon.layers("h-6 w-6")}</span>
          <h2 className="text-2xl font-semibold mt-5">{c("salesTitle")}</h2>
          <p className="mt-3 text-text-secondary leading-relaxed">{c("salesBody")}</p>
          <div className="grid gap-5 mt-7">
            <label className="text-sm font-semibold">{c("businessLabel")}<input value={business} onChange={e => setBusiness(e.target.value)} maxLength={160} placeholder={c("businessPlaceholder")} className="block w-full mt-2 border border-border rounded-lg px-4 py-3 font-normal bg-bg" /></label>
            <label className="text-sm font-semibold">{c("goalLabel")}<input value={goal} onChange={e => setGoal(e.target.value)} maxLength={300} placeholder={c("goalPlaceholder")} className="block w-full mt-2 border border-border rounded-lg px-4 py-3 font-normal bg-bg" /></label>
          </div>
          <a href={salesHref} className="inline-flex items-center gap-3 mt-6 bg-accent text-white px-5 py-3 rounded-lg font-semibold">{c("salesCta")} {Icon.arrow("h-4 w-4")}</a>
          <p className="text-xs text-text-muted mt-3 leading-relaxed">{c("emailNote")}</p>
        </article>
        <div className="grid gap-6">
          <article className="rounded-2xl border border-accent/20 bg-accent/5 p-7 sm:p-9">
            <span className="text-accent" aria-hidden="true">{Icon.sparkles("h-6 w-6")}</span>
            <h2 className="text-2xl font-semibold mt-5">{c("assistTitle")}</h2>
            <p className="text-text-secondary mt-3 leading-relaxed">{c("assistBody")}</p>
            <Link href="/producto/parallly-assist" className="inline-flex mt-5 text-accent font-semibold">{c("assistCta")} →</Link>
          </article>
          <article className="rounded-2xl border border-border bg-white p-7 sm:p-9">
            <h2 className="text-xl font-semibold">{t("contactTitle")}</h2>
            <p className="mt-3 text-text-secondary leading-relaxed">{t("contactBody")}</p>
            <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t("emailSubject"))}`} className="inline-flex mt-5 text-accent font-semibold">{t("emailCta")} →</a>
            <p className="mt-3 text-sm text-text-muted break-all">{CONTACT_EMAIL}</p>
          </article>
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-9 mt-12 border-t border-border pt-9">
        <div><h2 className="text-lg font-semibold">{t("prepareTitle")}</h2><ul className="mt-4 space-y-3 text-sm text-text-secondary">{["account", "issue", "context"].map(key => <li key={key} className="flex gap-3"><span className="text-accent" aria-hidden="true">{Icon.check("h-4 w-4")}</span>{t(`checklist.${key}`)}</li>)}</ul></div>
        <div><h2 className="text-lg font-semibold">{t("securityTitle")}</h2><p className="mt-4 text-sm text-text-secondary leading-relaxed">{t("securityBody")}</p><Link href="/soluciones#adaptabilidad" className="inline-flex mt-5 text-accent text-sm font-semibold">{c("fitCta")} →</Link></div>
      </div>
    </div></section>
  </div>;
}
