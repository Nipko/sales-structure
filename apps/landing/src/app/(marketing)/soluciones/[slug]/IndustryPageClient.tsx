"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "@/components/LocalizedLink";
import { getVerticalBySlug, getVerticalsByCluster } from "../../../../data/verticals";
import { Icon, getVerticalIcon } from "../../../../components/ui/Icon";
import { VerticalChatDemo } from "../../../../components/demos/VerticalChatDemo";
import { JsonLd } from "../../../../components/ui/JsonLd";
import { industryPageJsonLd } from "../../../../lib/seo";
import { CONTACT_EMAIL } from "../../../../lib/constants";
import styles from "../solutions.module.css";

const CONFIGURATION = ["offering", "knowledge", "pipeline", "rules", "calendar", "team"] as const;

export default function IndustryPageClient() {
  const params = useParams();
  const slug = params.slug as string;
  const vertical = getVerticalBySlug(slug);
  const t = useTranslations();
  const d = useTranslations("industryDiscovery");
  const a = useTranslations("businessAdaptability");
  if (!vertical) return null;

  const related = getVerticalsByCluster(vertical.cluster).filter((v) => v.slug !== slug).slice(0, 3);
  const industryName = t(`verticals.${slug}.name`);
  const publicDescription = vertical.deepMarketingAllowed
    ? t(`verticals.${slug}.tagline`)
    : t(`solutions.productModeDescription.${vertical.productMode}`);
  const contactHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(d("contactSubject", { industry: industryName }))}&body=${encodeURIComponent(d("contactBody", { industry: industryName }))}`;

  return (
    <div className={styles.page}>
      <JsonLd data={industryPageJsonLd({ name: industryName, description: publicDescription, slug })} />
      <section className={styles.industryHero}>
        <div className={styles.container}>
          <Link href="/soluciones" className={styles.breadcrumb}><span aria-hidden="true">←</span>{t("industryPage.breadcrumb")}</Link>
          <div className={styles.industryHeroGrid}>
            <div>
              <p className={styles.industryEyebrow}><span aria-hidden="true">{getVerticalIcon(slug, styles.icon)}</span>{t(`verticals.${slug}.subtitle`)}</p>
              <h1>{d("titlePrefix")} <span>{industryName}</span></h1>
              <p className={styles.lead}>{d("heroDescription", { industry: industryName })}</p>
              <div className={styles.actions}>
                <a href={contactHref} className={styles.primaryLink}>{d("primaryCta")}<span aria-hidden="true">{Icon.arrow(styles.smallIcon)}</span></a>
                <a href="#ejemplo" className={styles.lightLink}>{d("demoCta")}</a>
              </div>
              <p className={styles.heroNote}>{d("heroNote")}</p>
            </div>
            <aside className={styles.scopePanel} aria-labelledby="industry-scope-title">
              <p className={styles.panelEyebrow}>{d("scopeEyebrow")}</p>
              <h2 id="industry-scope-title">{d("scopeTitle")}</h2>
              <p className={styles.scopeMode}
                data-product-mode={vertical.productMode}
                data-certification-state={vertical.certificationState}
                data-certification-reasons={vertical.certificationReasons.join(",")}
              >{t(`solutions.productMode.${vertical.productMode}`)}</p>
              <p className={styles.scopeDescription}>{publicDescription}</p>
              {vertical.deepMarketingAllowed ? (
                <ul className={styles.scopeFeatures}>
                  {[1, 2, 3, 4].map((n) => (
                    <li key={n}><span aria-hidden="true">{Icon.check(styles.smallIcon)}</span>{t(`verticals.${slug}.feature${n}`)}</li>
                  ))}
                </ul>
              ) : (
                <p className={styles.validationNote} data-deep-marketing="withheld">{t("solutions.validationRequired")}</p>
              )}
              <Link href="/producto" className={styles.textLink}>{d("scopeLink")}<span aria-hidden="true">{Icon.arrow(styles.smallIcon)}</span></Link>
            </aside>
          </div>
        </div>
      </section>
      <section className={styles.painSection} aria-labelledby="industry-pain-title">
        <div className={styles.container}>
          <div className={styles.sectionHeading}><p className={styles.eyebrow}>{d("painEyebrow")}</p><h2 id="industry-pain-title">{d("painTitle")}</h2></div>
          <div className={styles.painGrid}>
            {[1, 2, 3].map((n) => (
              <article key={n}>
                <span className={styles.index} aria-hidden="true">0{n}</span>
                <h3>{d(`pain${n}Title`)}</h3>
                <p>{t.has(`verticals.${slug}.pain${n}`) ? t(`verticals.${slug}.pain${n}`) : t(`industryPage.pain${n}`)}</p>
                <p className={styles.painResponse}>{d(`pain${n}Response`)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section id="ejemplo" className={styles.demoSection} aria-labelledby="industry-demo-title">
        <div className={`${styles.container} ${styles.demoGrid}`}>
          <div>
            <p className={styles.eyebrow}>{d("demoEyebrow")}</p>
            <h2 id="industry-demo-title">{d("demoTitle")}</h2>
            <p className={styles.bodyCopy}>{d("demoDescription")}</p>
            <ol className={styles.flowList}>
              {[1, 2, 3].map((n) => (
                <li key={n}><span aria-hidden="true">0{n}</span><div><h3>{d(`flow${n}Title`)}</h3><p>{d(`flow${n}Description`)}</p></div></li>
              ))}
            </ol>
            <p className={styles.demoScope}>{d("demoScope")}</p>
          </div>
          <div className={styles.demoFrame} data-demo-kind="illustrative">
            <p className={styles.demoLabel}>{d("demoLabel")}</p>
            <VerticalChatDemo vertical={{ ...vertical, color: "#245ec7", glow: "none", emoji: "P" }} />
          </div>
        </div>
      </section>
      <section className={styles.configurationSection} aria-labelledby="industry-config-title">
        <div className={styles.container}>
          <div className={styles.discoveryHeading}>
            <div><p className={styles.eyebrow}>{d("configurationEyebrow")}</p><h2 id="industry-config-title">{d("configurationTitle")}</h2></div>
            <p>{d("configurationDescription")}</p>
          </div>
          <div className={styles.configurationGrid}>
            {CONFIGURATION.map((key, index) => (
              <article key={key}><span className={styles.index} aria-hidden="true">0{index + 1}</span><h3>{a(`configuration.${key}`)}</h3><p>{d(`configuration.${key}`)}</p></article>
            ))}
          </div>
          <div className={styles.reviewBand}>
            <div><h3>{d("reviewTitle")}</h3><p>{d("reviewDescription")}</p></div>
            <Link href="/producto/parallly-assist" className={styles.primaryLink}>{d("assistLink")}<span aria-hidden="true">{Icon.arrow(styles.smallIcon)}</span></Link>
          </div>
        </div>
      </section>
      {related.length > 0 && (
        <section className={styles.relatedSection} aria-labelledby="related-title">
          <div className={styles.container}>
            <div className={styles.relatedHeading}><h2 id="related-title">{d("relatedTitle")}</h2><Link href="/soluciones" className={styles.textLink}>{d("allSectorsLink")}<span aria-hidden="true">{Icon.arrow(styles.smallIcon)}</span></Link></div>
            <div className={styles.relatedGrid}>
              {related.map((v) => (
                <Link key={v.slug} href={`/soluciones/${v.slug}`} className={styles.relatedCard}>
                  <div><span aria-hidden="true">{getVerticalIcon(v.slug, styles.icon)}</span><h3>{t(`verticals.${v.slug}.name`)}</h3></div>
                  <p>{v.deepMarketingAllowed ? t(`verticals.${v.slug}.tagline`) : t(`solutions.productModeDescription.${v.productMode}`)}</p>
                  <span className={styles.sectorLink}>{d("relatedLink")}<span aria-hidden="true">{Icon.arrow(styles.smallIcon)}</span></span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
