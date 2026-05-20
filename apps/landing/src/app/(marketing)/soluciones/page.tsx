"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { VERTICALS, type VerticalCluster, CLUSTER_LABELS } from "../../../data/verticals";
import { Section } from "../../../components/ui/Section";
import { Icon, getVerticalIcon } from "../../../components/ui/Icon";
import { CTABanner } from "../../../components/layout/CTABanner";
import { JsonLd } from "../../../components/ui/JsonLd";
import { breadcrumbJsonLd } from "../../../lib/seo";
import { SIGNUP_URL } from "../../../lib/constants";

const CLUSTERS: (VerticalCluster | "all")[] = [
  "all",
  "salud-bienestar",
  "comercio-servicios",
  "profesional-finanzas",
  "lifestyle-creativos",
];

export default function SolutionsPage() {
  const [activeCluster, setActiveCluster] = useState<VerticalCluster | "all">("all");
  const t = useTranslations();

  const filtered =
    activeCluster === "all"
      ? VERTICALS
      : VERTICALS.filter((v) => v.cluster === activeCluster);

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Inicio", url: "/" },
          { name: "Soluciones", url: "/soluciones" },
        ])}
      />

      {/* Hero */}
      <section className="pt-12 pb-16 px-6">
        <div className="mx-auto max-w-6xl text-center">
          <motion.h1
            className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {t("solutions.heroTitle")}
          </motion.h1>
          <motion.p
            className="text-lg text-text-secondary max-w-2xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            {t("solutions.heroSubtitle")}
          </motion.p>
        </div>
      </section>

      {/* Cluster tabs */}
      <Section>
        <div className="flex flex-wrap items-center justify-center gap-2 mb-12">
          {CLUSTERS.map((cluster) => {
            const isActive = activeCluster === cluster;
            const label =
              cluster === "all"
                ? t("solutions.allClusters")
                : t(`solutions.${CLUSTER_LABELS[cluster]}`);
            return (
              <button
                key={cluster}
                onClick={() => setActiveCluster(cluster)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all cursor-pointer ${
                  isActive
                    ? "bg-accent text-white shadow-[0_0_20px_rgba(56,151,240,0.3)]"
                    : "bg-surface border border-border text-text-secondary hover:border-accent/40"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Verticals grid */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeCluster}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
          >
            {filtered.map((v, i) => (
              <motion.div
                key={v.slug}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.3 }}
              >
                <Link
                  href={`/soluciones/${v.slug}`}
                  className="block glass-card rounded-2xl p-6 hover:border-accent/40 transition-all group h-full"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span
                        className="w-12 h-12 rounded-xl flex items-center justify-center"
                        style={{ backgroundColor: `${v.color}15`, color: v.color }}
                      >
                        {getVerticalIcon(v.slug, "w-6 h-6")}
                      </span>
                      <div>
                        <h3 className="font-bold text-text-primary group-hover:text-accent transition-colors">
                          {t(`verticals.${v.slug}.name`)}
                        </h3>
                        <p className="text-xs text-text-muted">{t(`verticals.${v.slug}.subtitle`)}</p>
                      </div>
                    </div>
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: `${v.color}15`,
                        color: v.color,
                      }}
                    >
                      {t(`solutions.tierBadge${v.tier}`)}
                    </span>
                  </div>

                  <p className="text-sm text-text-secondary mb-4 leading-relaxed">
                    {t(`verticals.${v.slug}.tagline`)}
                  </p>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <span>{t("solutions.agentLabel")}:</span>
                      <span className="font-semibold flex items-center gap-1" style={{ color: v.color }}>
                        {getVerticalIcon(v.slug, "w-3.5 h-3.5")} {t(`verticals.${v.slug}.agentName`)}
                      </span>
                    </div>
                    <span className="text-xs text-accent opacity-0 group-hover:opacity-100 transition-opacity">
                      {t("solutions.viewIndustry")}
                    </span>
                  </div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>
      </Section>

      {/* Bottom CTA */}
      <Section>
        <div className="text-center glass-card rounded-2xl p-12">
          <h2 className="text-2xl font-bold mb-3">{t("solutions.ctaTitle")}</h2>
          <p className="text-text-secondary mb-6 max-w-lg mx-auto">{t("solutions.ctaSubtitle")}</p>
          <a
            href={SIGNUP_URL}
            className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-6 py-3 rounded-xl font-semibold transition-colors"
          >
            {t("solutions.ctaButton")} {Icon.arrow()}
          </a>
        </div>
      </Section>

      <CTABanner />
    </>
  );
}
