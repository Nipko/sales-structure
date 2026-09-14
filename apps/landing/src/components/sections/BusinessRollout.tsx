"use client";

import { useTranslations } from "next-intl";
import Link from "../LocalizedLink";
import { Icon } from "../ui/Icon";
import styles from "./BusinessRollout.module.css";

const BUSINESS_NEEDS = [
  { key: "sales", icon: Icon.trendingUp },
  { key: "appointments", icon: Icon.calendar },
  { key: "service", icon: Icon.users },
] as const;

const ROLLOUT_STEPS = ["configure", "test", "activate"] as const;

export function BusinessFit() {
  const t = useTranslations("businessFit");

  return (
    <section className={styles.fit} aria-labelledby="business-fit-title">
      <div className={styles.container}>
        <div className={styles.fitHeading}>
          <div>
            <p className={styles.eyebrow}>{t("eyebrow")}</p>
            <h2 id="business-fit-title">{t("title")}</h2>
          </div>
          <Link href="/soluciones" className={styles.lightLink}>
            {t("explore")}
            <span aria-hidden="true">{Icon.arrow(styles.smallIcon)}</span>
          </Link>
        </div>

        <ul className={styles.needs}>
          {BUSINESS_NEEDS.map(({ key, icon }) => (
            <li key={key} className={styles.need}>
              <span className={styles.needIcon} aria-hidden="true">
                {icon(styles.icon)}
              </span>
              <div>
                <h3>{t(`${key}Title`)}</h3>
                <p>{t(`${key}Description`)}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className={styles.availability}>{t("availability")}</p>
      </div>
    </section>
  );
}

export function BusinessRollout() {
  const t = useTranslations("businessRollout");

  return (
    <section
      id="como-empezar"
      className={styles.rollout}
      aria-labelledby="business-rollout-title"
    >
      <div className={styles.container}>
        <div className={styles.rolloutGrid}>
          <div className={styles.rolloutIntro}>
            <p className={styles.eyebrow}>{t("eyebrow")}</p>
            <h2 id="business-rollout-title">
              {t("title")}
              <span>{t("titleAccent")}</span>
            </h2>
            <p className={styles.description}>{t("description")}</p>
            <Link href="/producto/parallly-assist" className={styles.primaryLink}>
              {t("agentLink")}
              <span aria-hidden="true">{Icon.arrow(styles.smallIcon)}</span>
            </Link>

            <div className={styles.controlNote}>
              <span aria-hidden="true">{Icon.shieldCheck(styles.icon)}</span>
              <div>
                <h3>{t("controlTitle")}</h3>
                <p>{t("controlDescription")}</p>
              </div>
            </div>
          </div>

          <div>
            <ol className={styles.steps}>
              {ROLLOUT_STEPS.map((key, index) => (
                <li key={key} className={styles.step}>
                  <span className={styles.stepNumber} aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3>{t(`${key}Title`)}</h3>
                    <p>{t(`${key}Description`)}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className={styles.fitHelp}>
              <p>{t("fitHelp")}</p>
              <Link href="/support" className={styles.textLink}>
                {t("contactLink")}
                <span aria-hidden="true">{Icon.arrow(styles.smallIcon)}</span>
              </Link>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
