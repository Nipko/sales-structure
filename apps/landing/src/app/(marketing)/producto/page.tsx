"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Section } from "../../../components/ui/Section";
import { Icon } from "../../../components/ui/Icon";
import { CTABanner } from "../../../components/layout/CTABanner";
import { JsonLd } from "../../../components/ui/JsonLd";
import { breadcrumbJsonLd } from "../../../lib/seo";
import { SIGNUP_URL } from "../../../lib/constants";

const PRODUCTS = [
  {
    key: "agent",
    href: "/producto/agente-ia",
    icon: () => Icon.bot("w-7 h-7"),
    color: "#a855f7",
  },
  {
    key: "channels",
    href: "/producto/canales",
    icon: () => Icon.inbox("w-7 h-7"),
    color: "#25D366",
  },
  {
    key: "booking",
    href: "/producto/reservas",
    icon: () => Icon.calendar("w-7 h-7"),
    color: "#3897f0",
  },
  {
    key: "crm",
    href: "/producto/crm",
    icon: () => Icon.users("w-7 h-7"),
    color: "#f59e0b",
  },
] as const;

export default function ProductHubPage() {
  const t = useTranslations("product");

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Inicio", url: "/" },
          { name: "Producto", url: "/producto" },
        ])}
      />

      {/* Hero */}
      <section className="pt-12 pb-16 px-6 relative overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[800px] h-[800px] bg-accent/5 rounded-full blur-3xl" />
        </div>
        <div className="mx-auto max-w-6xl text-center relative">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold bg-accent/10 text-accent border border-accent/20 mb-6">
              {Icon.layers("w-4 h-4")}
              {t("hubBadge")}
            </span>
          </motion.div>

          <motion.h1
            className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            {t("hubTitle")}
          </motion.h1>

          <motion.p
            className="text-lg text-text-secondary max-w-2xl mx-auto mb-10"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            {t("hubSubtitle")}
          </motion.p>

          <motion.a
            href={SIGNUP_URL}
            className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-8 py-4 rounded-xl font-bold text-base transition-colors shadow-[0_0_60px_rgba(56,151,240,0.3)]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            {t("hubCta")} {Icon.arrow()}
          </motion.a>
        </div>
      </section>

      {/* Product cards */}
      <Section>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {PRODUCTS.map((product, i) => (
            <motion.div
              key={product.key}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
            >
              <Link
                href={product.href}
                className="block bg-surface border border-border rounded-2xl p-8 hover:border-accent/40 transition-all group h-full"
              >
                <div className="flex items-start gap-5">
                  <div
                    className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${product.color}15`, color: product.color }}
                  >
                    {product.icon()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-bold text-text-primary group-hover:text-accent transition-colors mb-2">
                      {t(`${product.key}Title`)}
                    </h3>
                    <p className="text-sm text-text-secondary leading-relaxed mb-4">
                      {t(`${product.key}Desc`)}
                    </p>
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent opacity-80 group-hover:opacity-100 transition-opacity">
                      {t("hubViewMore")} {Icon.arrow("w-4 h-4")}
                    </span>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* Why Parallly overview */}
      <Section>
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            {t("hubWhyTitle")}
          </h2>
          <p className="text-text-secondary max-w-xl mx-auto">
            {t("hubWhySubtitle")}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {(["hubBenefit1", "hubBenefit2", "hubBenefit3"] as const).map((key, i) => (
            <motion.div
              key={key}
              className="bg-surface border border-border rounded-2xl p-6 text-center"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
            >
              <div className="w-12 h-12 rounded-xl bg-accent/10 text-accent flex items-center justify-center mx-auto mb-4">
                {i === 0 && Icon.zap("w-6 h-6")}
                {i === 1 && Icon.shield("w-6 h-6")}
                {i === 2 && Icon.chart("w-6 h-6")}
              </div>
              <h3 className="font-bold text-text-primary mb-2">{t(key)}</h3>
              <p className="text-sm text-text-secondary">{t(`${key}Desc`)}</p>
            </motion.div>
          ))}
        </div>
      </Section>

      <CTABanner />
    </>
  );
}
