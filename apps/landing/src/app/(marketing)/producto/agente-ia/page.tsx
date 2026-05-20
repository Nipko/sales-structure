"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Section } from "../../../../components/ui/Section";
import { Icon } from "../../../../components/ui/Icon";
import { CTABanner } from "../../../../components/layout/CTABanner";
import { JsonLd } from "../../../../components/ui/JsonLd";
import { breadcrumbJsonLd } from "../../../../lib/seo";
import { SIGNUP_URL } from "../../../../lib/constants";
import { AgentConfigDemo } from "../../../../components/demos/AgentConfigDemo";

const FEATURES = [
  { key: "agentFeature1", icon: () => Icon.layers("w-6 h-6") },
  { key: "agentFeature2", icon: () => Icon.book("w-6 h-6") },
  { key: "agentFeature3", icon: () => Icon.shield("w-6 h-6") },
  { key: "agentFeature4", icon: () => Icon.zap("w-6 h-6") },
  { key: "agentFeature5", icon: () => Icon.users("w-6 h-6") },
] as const;

const USE_CASES = [
  { key: "agentUseCase1", emoji: "\u{1FA7A}" },
  { key: "agentUseCase2", emoji: "\u{1F35D}" },
  { key: "agentUseCase3", emoji: "\u{1F3E0}" },
] as const;

export default function AgentProductPage() {
  const t = useTranslations("product");

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Inicio", url: "/" },
          { name: "Producto", url: "/producto" },
          { name: "Agente IA", url: "/producto/agente-ia" },
        ])}
      />

      {/* Hero */}
      <section className="pt-12 pb-20 px-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-3xl pointer-events-none bg-[#a855f7]/5" />
        <div className="mx-auto max-w-6xl relative">
          <motion.div
            className="max-w-3xl"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Link
              href="/producto"
              className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary mb-6 transition-colors"
            >
              {"←"} {t("breadcrumbProduct")}
            </Link>

            <span className="flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold bg-[#a855f7]/10 text-[#a855f7] border border-[#a855f7]/20 w-fit mb-5">
              {Icon.bot("w-4 h-4")}
              {t("agentBadge")}
            </span>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-5">
              {t("agentHeroPrefix")}{" "}
              <span className="text-[#a855f7]">{t("agentHeroHighlight")}</span>
            </h1>

            <p className="text-lg text-text-secondary max-w-2xl mb-8">
              {t("agentSubtitle")}
            </p>

            <a
              href={SIGNUP_URL}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-8 py-4 rounded-xl font-bold text-base transition-colors shadow-[0_0_20px_rgba(56,151,240,0.2)]"
            >
              {t("agentCta")} {Icon.arrow()}
            </a>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <Section>
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            {t("agentFeaturesTitle")}
          </h2>
          <p className="text-text-secondary max-w-xl mx-auto">
            {t("agentFeaturesSubtitle")}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((feat, i) => (
            <motion.div
              key={feat.key}
              className="bg-surface border border-border rounded-2xl p-6 hover:border-accent/40 transition-all"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
            >
              <div className="w-12 h-12 rounded-xl bg-[#a855f7]/10 text-[#a855f7] flex items-center justify-center mb-4">
                {feat.icon()}
              </div>
              <h3 className="font-bold text-text-primary mb-2">{t(feat.key)}</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                {t(`${feat.key}Desc`)}
              </p>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* Demo */}
      <Section>
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            {t("agentDemoTitle")}
          </h2>
          <p className="text-text-secondary max-w-xl mx-auto">
            {t("agentDemoSubtitle")}
          </p>
        </div>
        <div className="max-w-2xl mx-auto">
          <div className="bg-surface border border-border rounded-2xl p-4 sm:p-6">
            <AgentConfigDemo />
          </div>
        </div>
      </Section>

      {/* Use Cases */}
      <Section>
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            {t("agentUseCasesTitle")}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {USE_CASES.map((uc, i) => (
            <motion.div
              key={uc.key}
              className="bg-surface border border-border rounded-2xl p-6 hover:border-accent/40 transition-all"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
            >
              <span className="text-4xl mb-4 block">{uc.emoji}</span>
              <h3 className="font-bold text-text-primary mb-2">{t(uc.key)}</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                {t(`${uc.key}Desc`)}
              </p>
            </motion.div>
          ))}
        </div>
      </Section>

      <CTABanner />
    </>
  );
}
