"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarClock, HelpCircle, MapPin, MessageSquareText, ShoppingBag } from "lucide-react";
import type { PersonaConfig } from "../_types";
import { openQualityAssistant } from "@/lib/quality-assistant-contract";

type EditorTab = "persona" | "instructions" | "tools" | "schedule";
type GuideCard = { key: string; Icon: typeof ShoppingBag; summary: string } & (
  { tab: EditorTab; href?: never } | { href: string; tab?: never }
);

export function AgentGuideCards({ agentId, agentName, config, onSelectTab, canAskAssist = true }: {
  agentId: string;
  agentName?: string;
  config: PersonaConfig;
  onSelectTab: (tab: EditorTab) => void;
  canAskAssist?: boolean;
}) {
  const t = useTranslations("agent.guideCards");
  const enabledTools = Object.values(config.tools ?? {}).filter((tool) => tool && typeof tool === "object" && "enabled" in tool && tool.enabled === true).length;
  const cards: GuideCard[] = [
    { key: "offers", Icon: ShoppingBag, summary: t("offers.summary", { count: enabledTools }), tab: "tools" as const },
    { key: "place", Icon: MapPin, summary: t("place.summary"), tab: "schedule" as const },
    { key: "purchase", Icon: CalendarClock, summary: t("purchase.summary"), tab: "instructions" as const },
    { key: "questions", Icon: HelpCircle, summary: t("questions.summary"), href: "/admin/knowledge?tab=faqs" },
  ];
  const ask = (key: string) => openQualityAssistant({ agentId, agentName, prompt: t(`${key}.assistPrompt`), send: false });

  return <section aria-labelledby="agent-guide-cards-title" className="mb-4">
    <div className="mb-3"><h2 id="agent-guide-cards-title" className="text-sm font-semibold text-foreground">{t("title")}</h2><p className="mt-0.5 text-xs text-muted-foreground">{t("description")}</p></div>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(({ key, Icon, summary, ...destination }) => <article key={key} className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start gap-2"><span className="rounded-lg bg-indigo-50 p-1.5 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300"><Icon size={14} aria-hidden="true" /></span><div><h3 className="text-xs font-semibold text-foreground">{t(`${key}.title`)}</h3><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{summary}</p></div></div>
        <div className="mt-3 flex flex-wrap gap-2">
          {destination.tab ? <button type="button" onClick={() => onSelectTab(destination.tab!)} className="text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-300">{t(`${key}.action`)}</button>
            : <Link href={destination.href} className="text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-300">{t(`${key}.action`)}</Link>}
          {canAskAssist && <button type="button" onClick={() => ask(key)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:underline"><MessageSquareText size={11} aria-hidden="true" />{t("askAssist")}</button>}
        </div>
      </article>)}
    </div>
  </section>;
}
