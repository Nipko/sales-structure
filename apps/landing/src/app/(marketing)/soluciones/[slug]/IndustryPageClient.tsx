"use client";

import { useParams } from "next/navigation";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { getVerticalBySlug, getVerticalsByCluster } from "../../../../data/verticals";
import { Section } from "../../../../components/ui/Section";
import { Icon, getVerticalIcon } from "../../../../components/ui/Icon";
import { CTABanner } from "../../../../components/layout/CTABanner";
import { JsonLd } from "../../../../components/ui/JsonLd";
import { industryPageJsonLd } from "../../../../lib/seo";
import { SIGNUP_URL } from "../../../../lib/constants";

export default function IndustryPageClient() {
  const params = useParams();
  const slug = params.slug as string;
  const vertical = getVerticalBySlug(slug);
  const t = useTranslations();

  if (!vertical) return null;

  const related = getVerticalsByCluster(vertical.cluster)
    .filter((v) => v.slug !== slug)
    .slice(0, 3);

  const industryName = t(`verticals.${slug}.name`);
  const publicDescription = vertical.deepMarketingAllowed
    ? t(`verticals.${slug}.tagline`)
    : t(`solutions.productModeDescription.${vertical.productMode}`);

  return (
    <>
      <JsonLd
        data={industryPageJsonLd({
          name: industryName,
          description: publicDescription,
          slug,
        })}
      />

      {/* Hero */}
      <section
        className="pt-12 pb-20 px-6 relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${vertical.color}08, transparent 60%)`,
        }}
      >
        <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-3xl pointer-events-none" style={{ background: `${vertical.color}08` }} />
        <div className="mx-auto max-w-6xl relative">
          <div className="flex flex-col lg:flex-row items-center gap-12">
            <motion.div
              className="flex-1 text-center lg:text-left"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Link
                href="/soluciones"
                className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary mb-6 transition-colors"
              >
                {"←"} {t("industryPage.breadcrumb")}
              </Link>

              <span
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-4"
                style={{ backgroundColor: `${vertical.color}15`, color: vertical.color }}
              >
                {getVerticalIcon(slug, "w-4 h-4")}
                {t(`verticals.${slug}.subtitle`)}
              </span>

              <p className="mb-4 text-xs font-medium text-text-muted" data-product-mode={vertical.productMode}>
                {t(`solutions.productMode.${vertical.productMode}`)}
              </p>

              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">
                {t("industryPage.heroTitlePrefix")}{" "}
                <span style={{ color: vertical.color }}>{industryName}</span>
              </h1>

              <p className="text-lg text-text-secondary max-w-xl mb-8">
                {publicDescription}
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                <a
                  href={SIGNUP_URL}
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 text-white font-semibold rounded-xl transition-all cursor-pointer"
                  style={{
                    backgroundColor: vertical.color,
                    boxShadow: `0 0 40px ${vertical.color}35`,
                  }}
                >
                  {t("industryPage.heroCtaPrimary", { industry: industryName })} {Icon.arrow()}
                </a>
                <Link
                  href="/precios"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 border border-border hover:border-border-light text-text-primary rounded-xl font-medium transition-colors"
                >
                  {t("industryPage.heroCtaSecondary")}
                </Link>
              </div>
            </motion.div>

            {/* Agent card */}
            <motion.div
              className="flex-1 w-full max-w-sm"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <div className="glass-card rounded-2xl p-6 shadow-xl">
                <div className="flex items-center gap-3 mb-5">
                  <div
                    className="w-14 h-14 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: `${vertical.color}15`, color: vertical.color }}
                  >
                    {getVerticalIcon(slug, "w-7 h-7")}
                  </div>
                  <div>
                    <p className="font-bold text-lg">{t(`verticals.${slug}.agentName`)}</p>
                    <p className="text-xs text-text-muted">
                      {vertical.deepMarketingAllowed
                        ? t("industryPage.agentSpotlightDesc", { industry: industryName })
                        : t(`solutions.productModeDescription.${vertical.productMode}`)}
                    </p>
                  </div>
                </div>
                {vertical.deepMarketingAllowed ? (
                  <>
                    <div className="space-y-2.5">
                      {[1, 2, 3, 4].map((n) => (
                        <div key={n} className="flex items-start gap-2.5">
                          <span
                            className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5"
                            style={{ backgroundColor: `${vertical.color}20`, color: vertical.color }}
                          >
                            {Icon.check("w-3 h-3")}
                          </span>
                          <span className="text-sm text-text-secondary">
                            {t(`verticals.${slug}.feature${n}`)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-5 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: vertical.color }} />
                      <span className="text-xs font-semibold" style={{ color: vertical.color }}>
                        {t("industryPage.agentActive")}
                      </span>
                    </div>
                  </>
                ) : (
                  <p
                    className="rounded-xl border border-border bg-surface/50 p-4 text-sm text-text-secondary"
                    data-deep-marketing="withheld"
                  >
                    {t("solutions.validationRequired")}
                  </p>
                )}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Pain Points — per-industry copy with fallback to the generic set */}
      {(
        <Section>
          <h2 className="text-3xl font-bold text-center mb-10">
            {t("industryPage.painTitle", { industry: industryName })}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[1, 2, 3].map((n) => (
              <motion.div
                key={n}
                className="glass-card rounded-2xl p-6"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: n * 0.08 }}
              >
                <div className="w-10 h-10 rounded-xl bg-danger/10 text-danger flex items-center justify-center mb-4">
                  {Icon.zap("w-5 h-5")}
                </div>
                <p className="text-text-secondary leading-relaxed">{t.has(`verticals.${slug}.pain${n}`) ? t(`verticals.${slug}.pain${n}`) : t(`industryPage.pain${n}`)}</p>
              </motion.div>
            ))}
          </div>
        </Section>
      )}

      {/* Solution Steps */}
      <Section className="bg-surface/30">
        <h2 className="text-3xl font-bold text-center mb-12">
          {t("industryPage.solutionTitle", { industry: industryName })}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((n) => (
            <motion.div
              key={n}
              className="glass-card rounded-2xl p-7"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: n * 0.1 }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 text-white font-bold"
                style={{ backgroundColor: vertical.color }}
              >
                {n}
              </div>
              <h3 className="font-bold mb-2">{t(`industryPage.solutionStep${n}`, { industry: industryName })}</h3>
              <p className="text-sm text-text-secondary">{t(`industryPage.solutionStep${n}Desc`)}</p>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ROI Stats */}
      <Section>
        <h2 className="text-3xl font-bold text-center mb-12">{t("industryPage.roiTitle")}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((n) => (
            <motion.div
              key={n}
              className="text-center p-8 glass-card rounded-2xl"
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: n * 0.08 }}
            >
              <p className="text-4xl font-bold mb-2" style={{ color: vertical.color }}>
                {t(`industryPage.roiStat${n}`)}
              </p>
              <p className="text-text-secondary">{t(`industryPage.roiStat${n}Label`)}</p>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* Related Industries */}
      {related.length > 0 && (
        <Section className="bg-surface/30">
          <h2 className="text-2xl font-bold text-center mb-8">{t("industryPage.relatedTitle")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {related.map((v) => (
              <Link
                key={v.slug}
                href={`/soluciones/${v.slug}`}
                className="glass-card rounded-2xl p-5 hover:border-accent/40 transition-all group"
              >
                <div className="flex items-center gap-3 mb-3">
                  <span
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: `${v.color}15`, color: v.color }}
                  >
                    {getVerticalIcon(v.slug, "w-5 h-5")}
                  </span>
                  <div>
                    <p className="font-bold group-hover:text-accent transition-colors">
                      {t(`verticals.${v.slug}.name`)}
                    </p>
                    <p className="text-xs text-text-muted">{t(`verticals.${v.slug}.subtitle`)}</p>
                  </div>
                </div>
                <p className="text-sm text-text-secondary">
                  {v.deepMarketingAllowed
                    ? t(`verticals.${v.slug}.tagline`)
                    : t(`solutions.productModeDescription.${v.productMode}`)}
                </p>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <CTABanner />
    </>
  );
}
