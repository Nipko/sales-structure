"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { ANDROID_EARLY_ACCESS_URL } from "../../lib/constants";
import { Icon } from "../ui/Icon";
import { Section } from "../ui/Section";

const HOME_BENEFITS = ["homeBenefit1", "homeBenefit2", "homeBenefit3"] as const;

export function AndroidAppMockup({ className = "" }: { className?: string }) {
  const t = useTranslations("mobileApp");
  const conversations = [
    { initials: "MT", channel: "WA", nameKey: "mockConversation1Name", messageKey: "mockConversation1Message", time: "09:41", color: "#22c55e" },
    { initials: "DR", channel: "IG", nameKey: "mockConversation2Name", messageKey: "mockConversation2Message", time: "09:36", color: "#e879f9" },
    { initials: "LP", channel: "TG", nameKey: "mockConversation3Name", messageKey: "mockConversation3Message", time: "09:28", color: "#38bdf8" },
  ] as const;

  return (
    <div className={`relative mx-auto w-full max-w-[340px] ${className}`}>
      <div className="absolute inset-x-10 top-16 bottom-10 rounded-full bg-accent/20 blur-[70px]" aria-hidden="true" />
      <div
        role="img"
        aria-label={t("mockupAria")}
        className="relative overflow-hidden rounded-[2.75rem] border-[6px] border-[#292934] bg-[#09090f] shadow-[0_35px_90px_rgba(0,0,0,0.65),0_0_0_1px_rgba(255,255,255,0.08)]"
      >
        <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-black" aria-hidden="true" />
        <div className="flex items-center justify-between px-6 pb-3 pt-4 text-[10px] font-semibold text-white/70">
          <span>9:41</span>
          <span className="tracking-[0.2em]">● ᯤ ▰</span>
        </div>

        <div className="border-b border-white/[0.07] px-4 pb-4 pt-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <img
                src="/parallly-logo.svg"
                alt="Parallly"
                className="h-[13px] w-auto"
              />
              <div className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {t("mockLive")}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pl-1.5 pr-3">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-accent/20 text-[11px] font-bold text-accent">AS</span>
              <span className="text-[10px] font-semibold text-white/80">{t("mockAgent")}</span>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-2.5 text-[11px] text-white/35">
            <span aria-hidden="true">⌕</span>
            {t("mockSearch")}
          </div>

          <div className="mt-3 flex gap-2 overflow-hidden text-[9px] font-semibold">
            <span className="rounded-full bg-accent px-3 py-1.5 text-white">{t("mockFilterAll")}</span>
            <span className="whitespace-nowrap rounded-full border border-white/10 px-3 py-1.5 text-white/55">{t("mockFilterMine")}</span>
            <span className="whitespace-nowrap rounded-full border border-white/10 px-3 py-1.5 text-white/55">{t("mockFilterAi")}</span>
          </div>
        </div>

        <div className="min-h-[300px] px-3 py-2">
          {conversations.map((conversation, index) => (
            <div key={conversation.nameKey} className="flex items-center gap-3 border-b border-white/[0.06] px-1 py-3">
              <div className="relative shrink-0">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#202036] text-[11px] font-bold text-white/75">
                  {conversation.initials}
                </span>
                <span
                  className="absolute -bottom-1 -right-1 rounded-md border-2 border-[#09090f] px-1 py-0.5 text-[7px] font-black text-black"
                  style={{ backgroundColor: conversation.color }}
                >
                  {conversation.channel}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-bold text-white/90">{t(conversation.nameKey)}</span>
                  <span className="text-[8px] text-white/30">{conversation.time}</span>
                </div>
                <p className="mt-1 truncate text-[9px] text-white/45">{t(conversation.messageKey)}</p>
              </div>
              {index === 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
            </div>
          ))}

          <div className="mx-1 mt-3 rounded-xl border border-accent/20 bg-accent/[0.08] p-3">
            <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-accent">
              {Icon.sparkles("h-3 w-3")}
              {t("mockCopilot")}
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-white/70">{t("mockCopilotAction")}</p>
          </div>
        </div>

        <div className="grid grid-cols-4 border-t border-white/[0.07] bg-[#11111c] px-2 py-3 text-center text-[8px] font-semibold text-white/40">
          <span className="text-accent">{t("mockTabInbox")}</span>
          <span>{t("mockTabCrm")}</span>
          <span>{t("mockTabOperation")}</span>
          <span>{t("mockTabMore")}</span>
        </div>
      </div>
      <div className="relative mx-auto mt-4 w-fit rounded-full border border-border bg-surface px-3 py-1.5 text-[10px] font-medium text-text-muted">
        {t("illustrativeLabel")}
      </div>
    </div>
  );
}

export function MobileAppSection() {
  const t = useTranslations("mobileApp");

  return (
    <Section id="app-android" className="overflow-hidden">
      <div className="relative grid items-center gap-14 overflow-hidden rounded-[2rem] border border-border bg-gradient-to-br from-surface via-bg to-accent/[0.08] px-6 py-10 sm:px-10 lg:grid-cols-[1.05fr_0.95fr] lg:px-14 lg:py-14">
        <div className="pointer-events-none absolute -left-24 top-0 h-64 w-64 rounded-full bg-accent/10 blur-3xl" aria-hidden="true" />

        <motion.div
          className="relative z-10"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
        >
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              {t("statusBadge")}
            </span>
            <span className="rounded-full border border-border bg-surface/80 px-3 py-1.5 text-xs font-semibold text-text-secondary">
              {t("playSoon")}
            </span>
          </div>

          <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-accent">{t("homeEyebrow")}</p>
          <h2 className="max-w-xl text-3xl font-extrabold tracking-tight sm:text-5xl">
            {t("homeTitle")}
          </h2>
          <p className="mt-5 max-w-xl text-sm leading-7 text-text-secondary sm:text-base">
            {t("homeSubtitle")}
          </p>

          <div className="mt-7 space-y-3">
            {HOME_BENEFITS.map((key) => (
              <div key={key} className="flex items-start gap-3 text-sm text-text-secondary">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
                  {Icon.check("h-3 w-3")}
                </span>
                <span>{t(key)}</span>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href={ANDROID_EARLY_ACCESS_URL}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-accent-hover"
            >
              {t("requestAccess")} {Icon.arrow("h-4 w-4")}
            </a>
            <Link
              href="/producto/app-android"
              className="inline-flex items-center justify-center rounded-xl border border-border px-6 py-3.5 text-sm font-semibold text-text-primary transition-colors hover:border-accent/40 hover:bg-surface-light"
            >
              {t("viewCapabilities")}
            </Link>
          </div>
        </motion.div>

        <motion.div
          className="relative z-10"
          initial={{ opacity: 0, scale: 0.94, y: 25 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ delay: 0.12, duration: 0.55 }}
        >
          <AndroidAppMockup />
        </motion.div>
      </div>
    </Section>
  );
}
