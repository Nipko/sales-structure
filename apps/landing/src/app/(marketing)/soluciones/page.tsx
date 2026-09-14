"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "@/components/LocalizedLink";
import { VERTICALS } from "../../../data/verticals";
import { Icon, getVerticalIcon } from "../../../components/ui/Icon";
import { BusinessAdaptability } from "../../../components/sections/BusinessAdaptability";
import { JsonLd } from "../../../components/ui/JsonLd";
import { breadcrumbJsonLd } from "../../../lib/seo";
import { CONTACT_EMAIL } from "../../../lib/constants";
import styles from "./solutions.module.css";

const NEED_FILTERS = ["all", "sales", "appointments", "service"] as const;
type NeedFilter = (typeof NEED_FILTERS)[number];

// Discovery categories guide exploration; they do not grant capability entitlements.
const NEED_EXAMPLES: Record<Exclude<NeedFilter, "all">, readonly string[]> = {
  sales: ["restaurantes", "inmobiliaria", "turismo", "educacion", "seguros", "automotriz", "finanzas", "servicios-profesionales", "tecnologia", "retail", "fotografia", "otro"],
  appointments: ["salud", "belleza", "gimnasios", "veterinaria", "automotriz", "hogar", "fotografia", "inmobiliaria", "turismo", "servicios-profesionales", "pet-services", "otro"],
  service: ["salud", "restaurantes", "educacion", "seguros", "veterinaria", "hogar", "finanzas", "tecnologia", "retail", "pet-services", "otro"],
};

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export default function SolutionsPage() {
  const t = useTranslations();
  const d = useTranslations("solutionsDiscovery");
  const [search, setSearch] = useState("");
  const [need, setNeed] = useState<NeedFilter>("all");
  const terms = normalizeSearch(search).split(/\s+/).filter(Boolean);
  const filtered = VERTICALS.filter((v) => {
    const searchText = normalizeSearch([
      v.slug,
      t(`verticals.${v.slug}.name`),
      t(`verticals.${v.slug}.subtitle`),
      d(`searchAliases.${v.slug}`),
    ].join(" "));
    return (need === "all" || NEED_EXAMPLES[need].includes(v.slug))
      && terms.every((term) => searchText.includes(term));
  });
  const contactHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(d("contactSubject"))}&body=${encodeURIComponent(
    d("contactBody", { business: search.trim() || d("businessPlaceholder"), need: d(`filters.${need}`) }),
  )}`;

  return (
    <div className={styles.page}>
      <JsonLd data={breadcrumbJsonLd([
        { name: d("homeLabel"), url: "/" },
        { name: d("breadcrumb"), url: "/soluciones" },
      ])} />
      <section className={styles.hubHero}>
        <div className={styles.container}>
          <p className={styles.eyebrow}>{d("eyebrow")}</p>
          <div className={styles.hubHeroGrid}>
            <h1>{d("title")} <span>{d("titleAccent")}</span></h1>
            <div>
              <p className={styles.lead}>{d("description")}</p>
              <a href="#adaptabilidad" className={styles.lightLink}>{d("unlistedLink")}<span aria-hidden="true">{Icon.arrow(styles.smallIcon)}</span></a>
            </div>
          </div>
          <div className={styles.heroPrinciples}>
            {["principle1", "principle2", "principle3"].map((key) => (
              <span key={key}><span aria-hidden="true">{Icon.check(styles.smallIcon)}</span>{d(key)}</span>
            ))}
          </div>
        </div>
      </section>
      <section id="explorar" className={styles.discovery} aria-labelledby="discovery-title">
        <div className={styles.container}>
          <div className={styles.discoveryHeading}>
            <div><p className={styles.eyebrow}>{d("directoryEyebrow")}</p><h2 id="discovery-title">{d("directoryTitle")}</h2></div>
            <p>{d("directoryDescription")}</p>
          </div>
          <div className={styles.searchPanel}>
            <label htmlFor="business-search">{d("searchLabel")}</label>
            <div className={styles.searchRow}>
              <input id="business-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)}
                placeholder={d("searchPlaceholder")} aria-describedby="business-search-hint" autoComplete="off" />
              {(search || need !== "all") && (
                <button type="button" onClick={() => { setSearch(""); setNeed("all"); }} className={styles.clearButton}>{d("clearFilters")}</button>
              )}
            </div>
            <div className={styles.filters} role="group" aria-label={d("filterLabel")}>
              <span>{d("filterLabel")}</span>
              {NEED_FILTERS.map((key) => (
                <button key={key} type="button" aria-pressed={need === key} className={need === key ? styles.filterActive : ""} onClick={() => setNeed(key)}>{d(`filters.${key}`)}</button>
              ))}
            </div>
            <p id="business-search-hint" className={styles.searchHint}>{d("searchHint")}</p>
          </div>
          <p className={styles.resultsCount} role="status">{d("resultCount", { count: filtered.length })}</p>
          {filtered.length > 0 ? (
            <div className={styles.directory}>
              {filtered.map((v) => (
                <Link key={v.slug} href={`/soluciones/${v.slug}`} className={styles.sectorCard}>
                  <span className={styles.sectorIcon} aria-hidden="true">{getVerticalIcon(v.slug, styles.icon)}</span>
                  <div className={styles.sectorContent}>
                    <h3>{t(`verticals.${v.slug}.name`)}</h3>
                    <p className={styles.sectorSubtitle}>{t(`verticals.${v.slug}.subtitle`)}</p>
                    <p className={styles.sectorDescription}>
                      {v.deepMarketingAllowed ? t(`verticals.${v.slug}.tagline`) : t(`solutions.productModeDescription.${v.productMode}`)}
                    </p>
                    <p className={styles.productMode}
                      data-product-mode={v.productMode}
                      data-certification-state={v.certificationState}
                      data-certification-reasons={v.certificationReasons.join(",")}
                    >{t(`solutions.productMode.${v.productMode}`)}</p>
                    <span className={styles.sectorLink}>{d("sectorLink")}<span aria-hidden="true">{Icon.arrow(styles.smallIcon)}</span></span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <span className={styles.sectorIcon} aria-hidden="true">{Icon.compass(styles.icon)}</span>
              <div>
                <h3>{d("noResultsTitle")}</h3>
                <p>{d("noResultsDescription")}</p>
                <div className={styles.actions}>
                  <a href="#adaptabilidad" className={styles.primaryLink}>{d("processLink")}<span aria-hidden="true">{Icon.arrow(styles.smallIcon)}</span></a>
                  <a href={contactHref} className={styles.textLink}>{d("contactLink")}</a>
                </div>
                <p className={styles.mailNote}>{d("mailNote")}</p>
              </div>
            </div>
          )}
        </div>
      </section>
      <BusinessAdaptability businessName={search} />
    </div>
  );
}
