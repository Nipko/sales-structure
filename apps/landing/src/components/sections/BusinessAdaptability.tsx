"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "../LocalizedLink";
import { Icon } from "../ui/Icon";
import { CONTACT_EMAIL } from "../../lib/constants";
import styles from "./BusinessAdaptability.module.css";

const PROCESSES = [
  { key: "sales", icon: Icon.trendingUp },
  { key: "appointments", icon: Icon.calendar },
  { key: "service", icon: Icon.inbox },
] as const;
const CONFIGURATION = ["offering", "knowledge", "pipeline", "rules", "calendar", "team"] as const;

export function BusinessAdaptability({ businessName = "" }: { businessName?: string }) {
  const t = useTranslations("businessAdaptability");
  const [process, setProcess] = useState<(typeof PROCESSES)[number]["key"]>("sales");
  const contactHref = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t("contactSubject"))}&body=${encodeURIComponent(
    t("contactBody", { business: businessName.trim() || t("businessPlaceholder"), process: t(`${process}Title`) }),
  )}`;

  return (
    <section id="adaptabilidad" className={styles.section} aria-labelledby="adaptability-title">
      <div className={styles.container}>
        <div className={styles.heading}>
          <div>
            <p className={styles.eyebrow}>{t("eyebrow")}</p>
            <h2 id="adaptability-title">{t("title")}</h2>
          </div>
          <p>{t("description")}</p>
        </div>
        <div className={styles.explorer}>
          <div className={styles.processes}>
            <p className={styles.label}>{t("chooseProcess")}</p>
            <div className={styles.processOptions} role="group" aria-label={t("chooseProcess")}>
              {PROCESSES.map(({ key, icon }) => (
                <button key={key} type="button" className={`${styles.process} ${process === key ? styles.active : ""}`}
                  aria-pressed={process === key} aria-controls="adaptability-example" onClick={() => setProcess(key)}>
                  <span aria-hidden="true">{icon(styles.icon)}</span>
                  <span><strong>{t(`${key}Title`)}</strong><span>{t(`${key}Summary`)}</span></span>
                  <span className={styles.processArrow} aria-hidden="true">{Icon.arrow(styles.smallIcon)}</span>
                </button>
              ))}
            </div>
          </div>
          <div id="adaptability-example" className={styles.example} aria-live="polite" aria-atomic="true">
            <p className={styles.exampleLabel}>{t("exampleLabel")}</p>
            <h3>{t(`${process}ExampleTitle`)}</h3>
            <p className={styles.exampleDescription}>{t(`${process}ExampleDescription`)}</p>
            <div className={styles.exampleOutcome}><span aria-hidden="true">{Icon.check(styles.smallIcon)}</span><p>{t(`${process}Outcome`)}</p></div>
            <a href={contactHref} className={styles.primaryLink}>{t("contactLink")}<span aria-hidden="true">{Icon.arrow(styles.smallIcon)}</span></a>
            <p className={styles.mailNote}>{t("mailNote")}</p>
          </div>
        </div>
        <div className={styles.configuration}>
          <div><h3>{t("configurationTitle")}</h3><p>{t("configurationDescription")}</p></div>
          <ul>{CONFIGURATION.map((key) => (
            <li key={key}><span aria-hidden="true">{Icon.check(styles.smallIcon)}</span>{t(`configuration.${key}`)}</li>
          ))}</ul>
        </div>
        <div className={styles.guide}>
          <span aria-hidden="true">{Icon.compass(styles.icon)}</span>
          <p>{t("guideDescription")}</p>
          <Link href="/producto/parallly-assist" className={styles.textLink}>{t("guideLink")}<span aria-hidden="true">{Icon.arrow(styles.smallIcon)}</span></Link>
        </div>
        <div className={styles.footer}>
          <p>{t("scopeNote")}</p>
          <Link href="/soluciones" className={styles.textLink}>{t("exploreLink")}<span aria-hidden="true">{Icon.arrow(styles.smallIcon)}</span></Link>
        </div>
      </div>
    </section>
  );
}
