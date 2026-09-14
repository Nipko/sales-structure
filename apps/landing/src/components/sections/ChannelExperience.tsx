"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "../LocalizedLink";
import { Icon } from "../ui/Icon";
import { DemoFrame } from "../demos/DemoFrame";
import { demoContract } from "../../data/demo-catalog";
import styles from "./ChannelExperience.module.css";

const CHANNELS = [
  { id: "whatsapp", name: "WhatsApp" },
  { id: "instagram", name: "Instagram" },
  { id: "messenger", name: "Messenger" },
  { id: "telegram", name: "Telegram" },
  { id: "web", name: "Web Chat" },
] as const;

type ChannelId = (typeof CHANNELS)[number]["id"];

export function ChannelMark({ channel }: { channel: ChannelId }) {
  if (channel === "web") return <span className={styles.webMark} aria-hidden="true">{Icon.code("h-5 w-5")}</span>;
  if (channel === "telegram") return <span className={styles.telegramMark} aria-hidden="true">{Icon.telegram("h-5 w-5")}</span>;
  return <img src={`/logos/${channel}.svg`} width="22" height="22" alt="" />;
}

export function ChannelExperience({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("channelExperience");
  const instanceId = useId();
  const [channel, setChannel] = useState<ChannelId>("whatsapp");
  const [step, setStep] = useState(0);
  const active = CHANNELS.find((entry) => entry.id === channel)!;

  return (
    <section className={`${styles.section} ${compact ? styles.compact : ""}`} aria-labelledby={`${instanceId}-title`}>
      <div className={styles.container}>
        <div className={styles.heading}>
          <div><p className={styles.eyebrow}>{t("eyebrow")}</p><h2 id={`${instanceId}-title`}>{t("title")}</h2></div>
          <p>{t("description")}</p>
        </div>

        <div className={styles.selector} role="group" aria-label={t("selectChannel")}>
          {CHANNELS.map((entry) => <button type="button" key={entry.id} aria-pressed={channel === entry.id} aria-controls={`${instanceId}-panel`} onClick={() => { setChannel(entry.id); setStep(0); }}><ChannelMark channel={entry.id} /><span>{entry.name}</span></button>)}
        </div>

        <div className={styles.experience} id={`${instanceId}-panel`}>
          <div className={styles.guide}>
            <p className={styles.selectedChannel}><ChannelMark channel={channel} />{active.name}</p>
            <h3>{t(`${channel}.title`)}</h3>
            <p className={styles.benefit}>{t(`${channel}.description`)}</p>
            <p className={styles.stepsLabel}>{t("connectTitle")}</p>
            <ol className={styles.steps}>
              {[1, 2, 3].map((number) => <li key={number}><span aria-hidden="true">{number}</span><p>{t(`${channel}.step${number}`)}</p></li>)}
            </ol>
            {!compact && <div className={styles.requirement}><span aria-hidden="true">{Icon.shield("h-4 w-4")}</span><p>{t(`${channel}.requirement`)}</p></div>}
            <Link href="/producto/parallly-assist" className={styles.assistLink}>{t("assistLink")}<span aria-hidden="true">{Icon.arrow("h-4 w-4")}</span></Link>
          </div>

          <DemoFrame contract={demoContract("handoff")} className={styles.demoFrame}>
            <div className={styles.demo}>
              <div className={styles.demoHeader}><span className={styles.businessAvatar} aria-hidden="true">P</span><div><strong>{t("demoBusiness")}</strong><span><ChannelMark channel={channel} />{active.name}</span></div><span className={styles.mode}>{t("demoMode")}</span></div>
              <div className={styles.conversation} aria-live="polite" aria-atomic="true">
                <p className={styles.conversationDate}>{t("sampleConversation")}</p>
                <div className={styles.customer}><small>{t("customerLabel")}</small><p>{t(`${channel}.message`)}</p></div>
                {step >= 1 && <div className={styles.reply}><small><span aria-hidden="true">{Icon.sparkles("h-3 w-3")}</span>{t("agentLabel")}</small><p>{t("agentReply")}</p><span className={styles.source}><span aria-hidden="true">{Icon.book("h-3 w-3")}</span>{t("source")}</span></div>}
                {step >= 2 && <><div className={styles.customer}><small>{t("customerLabel")}</small><p>{t("handoffRequest")}</p></div><div className={styles.handoff}><span aria-hidden="true">{Icon.users("h-5 w-5")}</span><div><strong>{t("handoffTitle")}</strong><p>{t("handoffDescription")}</p></div></div></>}
                {step === 0 && <div className={styles.waiting}><span aria-hidden="true">{Icon.arrow("h-5 w-5")}</span><p>{t("stepHint")}</p></div>}
              </div>
              <div className={styles.demoControls}>
                <div role="group" aria-label={t("chooseStep")} className={styles.stepDots}>{[0, 1, 2].map((index) => <button key={index} type="button" aria-pressed={step === index} aria-label={t(`stage${index}`)} onClick={() => setStep(index)}><span aria-hidden="true">{index + 1}</span></button>)}</div>
                <button type="button" className={styles.advance} onClick={() => setStep(step === 2 ? 0 : step + 1)}>{t(step === 2 ? "restart" : "advance")}<span aria-hidden="true">{Icon.arrow("h-4 w-4")}</span></button>
              </div>
            </div>
          </DemoFrame>
        </div>

        <div className={styles.publishNote}><span aria-hidden="true">{Icon.shieldCheck("h-5 w-5")}</span><div><strong>{t("publishTitle")}</strong><p>{t("publishDescription")}</p></div><Link href={compact ? "/producto/canales" : "/producto/agente-ia"}>{t(compact ? "exploreChannels" : "exploreAgent")}<span aria-hidden="true">{Icon.arrow("h-4 w-4")}</span></Link></div>
        <p className={styles.scope}>{t("scope")}</p>
      </div>
    </section>
  );
}
