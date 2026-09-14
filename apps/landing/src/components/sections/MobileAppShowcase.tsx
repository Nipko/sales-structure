"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import Link from "../LocalizedLink";
import { Icon } from "../ui/Icon";
import { ANDROID_PLAY_STORE_URL } from "../../lib/constants";
import styles from "./MobileAppShowcase.module.css";

const screens = ["inbox", "crm", "agenda"] as const;
type Screen = typeof screens[number];
const screenIcons = { inbox: Icon.inbox, crm: Icon.users, agenda: Icon.calendar };

export function MobileAppShowcase() {
  const t = useTranslations("mobileAppShowcase");
  const [screen, setScreen] = useState<Screen>("inbox");

  return (
    <section id="app-movil" className={styles.section} aria-labelledby="mobile-app-title">
      <div className={styles.showcase}>
        <div className={styles.copy}>
          <div className={styles.appIdentity}>
            <Image src="/mobile/app-icon.png" width={52} height={52} alt="" />
            <div><strong>Parallly</strong><span>{t("platform")}</span></div>
          </div>
          <p className={styles.availability}><span aria-hidden="true" />{t("available")}</p>
          <h2 id="mobile-app-title">{t("title")}<span>{t("accent")}</span></h2>
          <p className={styles.description}>{t("description")}</p>

          <div className={styles.screenChoices} role="group" aria-label={t("chooseScreen")}>
            {screens.map(key => <button key={key} type="button" aria-pressed={screen === key} aria-controls="mobile-app-preview mobile-app-benefit" onClick={() => setScreen(key)}>
              <span aria-hidden="true">{screenIcons[key](styles.icon)}</span>{t(`${key}.label`)}
            </button>)}
          </div>
          <div id="mobile-app-benefit" className={styles.benefit} aria-live="polite" aria-atomic="true">
            <h3>{t(`${screen}.title`)}</h3><p>{t(`${screen}.description`)}</p>
          </div>
          <div className={styles.actions}>
            <a className={styles.storeLink} href={ANDROID_PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" aria-label={t("downloadLabel")}>
              <span className={styles.downloadIcon} aria-hidden="true">{Icon.arrow(styles.icon)}</span>
              <span><small>{t("download")}</small><strong>Google Play</strong></span>
            </a>
            <Link className={styles.detailsLink} href="/producto/app-android">{t("details")}<span aria-hidden="true">↗</span></Link>
          </div>
          <p className={styles.accountNote}>{t("accountNote")}</p>
        </div>

        <figure className={styles.preview} id="mobile-app-preview">
          <div className={styles.deviceStage}>
            <div className={styles.device}>
              <div className={styles.deviceSpeaker} aria-hidden="true"><span /></div>
              <Image key={screen} className={styles.screenshot} src={`/mobile/${screen}.png`} width={1080} height={2096} sizes="(max-width: 600px) 248px, 270px" alt={t(`${screen}.imageAlt`)} />
              <div className={styles.deviceBottom} aria-hidden="true"><span /></div>
            </div>
            <div className={styles.connectedNote}><span aria-hidden="true">{Icon.check(styles.icon)}</span><div><strong>{t("connectedTitle")}</strong><span>{t("connectedBody")}</span></div></div>
          </div>
          <figcaption>{t("screenshotNote")}</figcaption>
        </figure>
      </div>
      <div className={styles.startSteps} aria-label={t("stepsLabel")}>
        {["download", "login", "continue"].map((step, index) => <p key={step}><span aria-hidden="true">0{index + 1}</span>{t(`steps.${step}`)}</p>)}
      </div>
    </section>
  );
}
