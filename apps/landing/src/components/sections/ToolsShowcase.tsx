"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { Icon } from "../ui/Icon";
import { PipelineDemo } from "../demos/PipelineDemo";
import { InboxDemo } from "../demos/InboxDemo";
import { CalendarDemo } from "../demos/CalendarDemo";
import { AnalyticsDemo } from "../demos/AnalyticsDemo";
import { KnowledgeBaseDemo } from "../demos/KnowledgeBaseDemo";
import { AgentConfigDemo } from "../demos/AgentConfigDemo";

export function ToolsShowcase() {
  const t = useTranslations("tools");

  const tools = [
    {
      titleKey: "tool1Title",
      descKey: "tool1Desc",
      icon: Icon.users(),
      demo: <PipelineDemo />,
    },
    {
      titleKey: "tool2Title",
      descKey: "tool2Desc",
      icon: Icon.inbox(),
      demo: <InboxDemo />,
    },
    {
      titleKey: "tool3Title",
      descKey: "tool3Desc",
      icon: Icon.calendar(),
      demo: <CalendarDemo />,
    },
    {
      titleKey: "tool4Title",
      descKey: "tool4Desc",
      icon: Icon.chart(),
      demo: <AnalyticsDemo />,
    },
    {
      titleKey: "tool5Title",
      descKey: "tool5Desc",
      icon: Icon.book(),
      demo: <KnowledgeBaseDemo />,
    },
    {
      titleKey: "tool6Title",
      descKey: "tool6Desc",
      icon: Icon.bot(),
      demo: <AgentConfigDemo />,
    },
  ];

  return (
    <Section id="herramientas">
      <div className="text-center mb-12">
        <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
          {t("title")}
        </h2>
        <p className="text-text-secondary max-w-2xl mx-auto">
          {t("subtitle")}
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {tools.map((tool, i) => (
          <motion.div
            key={i}
            className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 hover:border-accent/30 transition-colors"
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ delay: (i % 3) * 0.08, duration: 0.5 }}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
                {tool.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-text-primary mb-1">
                  {t(tool.titleKey)}
                </h3>
                <p className="text-xs text-text-secondary leading-relaxed">
                  {t(tool.descKey)}
                </p>
              </div>
            </div>
            <div className="flex-1 min-h-[200px]">{tool.demo}</div>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}
