"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { AndroidAppMockup } from "../../../../components/sections/MobileAppSection";
import { Section } from "../../../../components/ui/Section";
import { Icon } from "../../../../components/ui/Icon";
import { JsonLd } from "../../../../components/ui/JsonLd";
import { breadcrumbJsonLd } from "../../../../lib/seo";
import { ANDROID_EARLY_ACCESS_URL } from "../../../../lib/constants";

const FEATURES = [
  { key: "featureInbox", icon: () => Icon.inbox("h-6 w-6") },
  { key: "featureCopilot", icon: () => Icon.sparkles("h-6 w-6") },
  { key: "featureCrm", icon: () => Icon.users("h-6 w-6") },
  { key: "featureOperations", icon: () => Icon.calendar("h-6 w-6") },
  { key: "featureContinuity", icon: () => Icon.zap("h-6 w-6") },
  { key: "featureSecurity", icon: () => Icon.fingerprint("h-6 w-6") },
] as const;

const WORKFLOW = ["workflow1", "workflow2", "workflow3"] as const;
const OPERATION_CHIPS = ["operation1", "operation2", "operation3", "operation4", "operation5", "operation6"] as const;

export default function AndroidAppProductPage() {
  const t = useTranslations("mobileApp");

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: t("breadcrumbHome"), url: "/" },
          { name: t("breadcrumbProduct"), url: "/producto" },
          { name: t("breadcrumbAndroid"), url: "/producto/app-android" },
        ])}
      />

      <section className="relative overflow-hidden px-6 pb-20 pt-12 sm:pt-16">
        <div className="pointer-events-none absolute -right-32 top-0 h-[650px] w-[650px] rounded-full bg-accent/[0.08] blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.08fr_0.92fr]">
          <motion.div initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }}>
            <Link href="/producto" className="mb-7 inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-primary">
              {"←"} {t("breadcrumbProduct")}
            </Link>

            <div className="mb-6 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3.5 py-1.5 text-xs font-bold text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                {t("statusBadge")}
              </span>
              <span className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-semibold text-text-secondary">
                {t("playSoon")}
              </span>
            </div>

            <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-accent">{t("pageEyebrow")}</p>
            <h1 className="max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
              {t("heroPrefix")} <span className="text-accent">{t("heroHighlight")}</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-text-secondary sm:text-lg">
              {t("heroSubtitle")}
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={ANDROID_EARLY_ACCESS_URL}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-7 py-4 text-sm font-bold text-white transition-colors hover:bg-accent-hover"
              >
                {t("requestAccess")} {Icon.arrow("h-4 w-4")}
              </a>
              <a
                href="#capacidades"
                className="inline-flex items-center justify-center rounded-xl border border-border px-7 py-4 text-sm font-semibold text-text-primary transition-colors hover:border-accent/40 hover:bg-surface"
              >
                {t("exploreFeatures")}
              </a>
            </div>

            <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-text-muted">
              {Icon.check("mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400")}
              {t("heroFootnote")}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.55 }}
          >
            <AndroidAppMockup />
          </motion.div>
        </div>
      </section>

      <Section id="capacidades">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-accent">{t("featuresEyebrow")}</p>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("featuresTitle")}</h2>
          <p className="mx-auto mt-4 max-w-2xl text-text-secondary">{t("featuresSubtitle")}</p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <motion.article
              key={feature.key}
              className="glass-card rounded-2xl p-6"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: (index % 3) * 0.07 }}
            >
              <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
                {feature.icon()}
              </div>
              <h3 className="font-bold text-text-primary">{t(feature.key)}</h3>
              <p className="mt-2 text-sm leading-6 text-text-secondary">{t(`${feature.key}Desc`)}</p>
            </motion.article>
          ))}
        </div>
      </Section>

      <Section className="border-y border-border bg-surface/30">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-accent">{t("workflowEyebrow")}</p>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("workflowTitle")}</h2>
          <p className="mx-auto mt-4 max-w-2xl text-text-secondary">{t("workflowSubtitle")}</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {WORKFLOW.map((key, index) => (
            <div key={key} className="relative rounded-2xl border border-border bg-bg p-6">
              <div className="mb-5 flex items-center justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-accent text-sm font-black text-white">{index + 1}</span>
                {index < WORKFLOW.length - 1 && <span className="hidden text-2xl text-border-light lg:block" aria-hidden="true">→</span>}
              </div>
              <h3 className="font-bold text-text-primary">{t(key)}</h3>
              <p className="mt-2 text-sm leading-6 text-text-secondary">{t(`${key}Desc`)}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <div className="grid items-center gap-10 rounded-[2rem] border border-border bg-gradient-to-br from-surface to-bg p-7 sm:p-10 lg:grid-cols-2 lg:p-12">
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-accent">{t("operationsEyebrow")}</p>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t("operationsTitle")}</h2>
            <p className="mt-4 max-w-xl leading-7 text-text-secondary">{t("operationsSubtitle")}</p>
            <div className="mt-7 flex flex-wrap gap-2">
              {OPERATION_CHIPS.map((key) => (
                <span key={key} className="rounded-full border border-border bg-bg px-3.5 py-2 text-xs font-semibold text-text-secondary">
                  {t(key)}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {["operationsPoint1", "operationsPoint2", "operationsPoint3"].map((key) => (
              <div key={key} className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.025] p-4">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-400/10 text-emerald-400">
                  {Icon.check("h-3.5 w-3.5")}
                </span>
                <p className="text-sm leading-6 text-text-secondary">{t(key)}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section className="pt-0">
        <div className="relative overflow-hidden rounded-[2rem] border border-accent/20 bg-accent/[0.08] px-6 py-12 text-center sm:px-12">
          <div className="pointer-events-none absolute inset-x-1/4 -top-24 h-48 rounded-full bg-accent/20 blur-3xl" aria-hidden="true" />
          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3.5 py-1.5 text-xs font-bold text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              {t("statusBadge")}
            </span>
            <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">{t("accessTitle")}</h2>
            <p className="mx-auto mt-4 max-w-2xl leading-7 text-text-secondary">{t("accessSubtitle")}</p>
            <a
              href={ANDROID_EARLY_ACCESS_URL}
              className="mt-7 inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-7 py-4 text-sm font-bold text-white transition-colors hover:bg-accent-hover"
            >
              {t("requestAccess")} {Icon.arrow("h-4 w-4")}
            </a>
            <p className="mt-4 text-xs text-text-muted">{t("accessNote")}</p>
          </div>
        </div>
      </Section>
    </>
  );
}
