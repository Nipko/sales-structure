"use client";

import { useTranslations } from "next-intl";
import { SIGNUP_URL } from "../../lib/constants";
import Link from "../LocalizedLink";
import { Icon } from "../ui/Icon";
import styles from "./BusinessHero.module.css";

export function HeroSection() {
  const t = useTranslations("businessHero");
  return (
    <>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.inner}>
          <div className={styles.copy}>
            <p className={styles.eyebrow}><span aria-hidden="true" />{t("eyebrow")}</p>
            <h1 id="hero-title">{t("title")} <span>{t("titleAccent")}</span></h1>
            <p className={styles.description}>{t("description")}</p>
            <div className={styles.actions}>
              <a href={SIGNUP_URL} className={styles.primary}>{t("start")}<span aria-hidden="true">{Icon.arrow()}</span></a>
              <a href="#como-empezar" className={styles.secondary}>{t("explore")}<span aria-hidden="true">↗</span></a>
            </div>
            <p className={styles.note}><span aria-hidden="true">{Icon.check("h-4 w-4")}</span>{t("note")}</p>
            <div className={styles.valueLine}>{["value1", "value2", "value3"].map((key) => <span key={key}>{t(key)}</span>)}</div>
          </div>
          <figure className={styles.visual} aria-label={t("visualLabel")}>
            <div className={styles.workspace}>
              <div className={styles.appBar}>
                <span className={styles.appBrand}><img src="/parallly-logo.svg" alt="Parallly" width="112" height="32" /></span>
                <span className={styles.workspaceName}>{t("workspace")}</span>
                <span className={styles.teamAvatar} aria-hidden="true">P</span>
              </div>
              <div className={styles.appBody}>
                <div className={styles.rail} aria-hidden="true"><span className={styles.railActive}>{Icon.inbox()}</span><span>{Icon.users()}</span><span>{Icon.calendar()}</span><span>{Icon.chart()}</span></div>
                <div className={styles.inbox}>
                  <div className={styles.inboxHeader}><strong>{t("inbox")}</strong><span>{t("shared")}</span></div>
                  <div className={styles.conversationArea}>
                    <div className={styles.contactList}>
                      <p className={styles.listLabel}>{t("teamInbox")}</p>
                      {["contact1", "contact2", "contact3"].map((key, index) => (
                        <div key={key} className={`${styles.contact} ${index === 0 ? styles.selectedContact : ""}`}>
                          <span className={styles.avatar} aria-hidden="true">{t(`${key}Initials`)}</span>
                          <div><strong>{t(key)}</strong><span>{t(`${key}Preview`)}</span><small>{index === 1 ? "Instagram" : "WhatsApp"}</small></div>
                        </div>
                      ))}
                      <div className={styles.listFoot}><span aria-hidden="true">{Icon.users("h-4 w-4")}</span><span>{t("teamContext")}</span></div>
                    </div>
                    <div className={styles.chat}>
                      <div className={styles.chatHeader}><span className={styles.avatar} aria-hidden="true">{t("contact1Initials")}</span><div><strong>{t("contact1")}</strong><span>WhatsApp</span></div><img src="/logos/whatsapp.svg" alt="" width="19" height="19" /></div>
                      <div className={styles.messages}>
                        <p className={styles.dayLabel}>{t("conversationLabel")}</p>
                        <div className={styles.customerMessage}>{t("customerMessage")}</div>
                        <div className={styles.aiLabel}><span aria-hidden="true">{Icon.sparkles("h-3 w-3")}</span><span>{t("assistant")}</span></div>
                        <div className={styles.assistantMessage}>{t("assistantMessage")}<span><i aria-hidden="true">{Icon.book("h-3 w-3")}</i>{t("source")}</span></div>
                        <div className={styles.customerMessage}>{t("customerReply")}</div>
                        <div className={styles.handoff}><span aria-hidden="true">{Icon.check("h-4 w-4")}</span><div><strong>{t("handoff")}</strong><p>{t("handoffDetail")}</p></div></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className={styles.workspaceFooter}><span aria-hidden="true">{Icon.layers("h-4 w-4")}</span><span>{t("connected")}</span><span className={styles.statusDot} aria-hidden="true" /></div>
            </div>
            <div className={styles.followUp}>
              <span className={styles.followUpIcon} aria-hidden="true">{Icon.sparkles("h-5 w-5")}</span>
              <div><span>{t("nextStep")}</span><strong>{t("task")}</strong></div><span aria-hidden="true">↗</span>
            </div>
            <figcaption>{t("disclaimer")}</figcaption>
          </figure>
        </div>
      </section>
      <div className={styles.channels}>
        <div className={styles.channelsInner}>
          <p>{t("channels")}</p>
          <ul aria-label={t("channelsLabel")}>
            {["whatsapp", "instagram", "messenger"].map((channel) => <li key={channel}><img src={`/logos/${channel}.svg`} alt="" width="21" height="21" /><span>{channel === "whatsapp" ? "WhatsApp" : channel[0].toUpperCase() + channel.slice(1)}</span></li>)}
            <li><svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#279fce" /><path d="m5 11 13-5-3 13-4-4-2 2v-4l6-5-8 5Z" fill="white" /></svg><span>Telegram</span></li>
            <li><span aria-hidden="true"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="16" rx="3" /><path d="M2 8h20M8 23l4-4 4 4M6 5.5h1m2 0h1" /></svg></span><span>Web Chat</span></li>
          </ul>
          <Link href="/producto/canales">{t("channelScope")}<span aria-hidden="true">↗</span></Link>
        </div>
      </div>
    </>
  );
}
