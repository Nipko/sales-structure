"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "../LocalizedLink";
import { Icon } from "../ui/Icon";
import { DemoFrame } from "../demos/DemoFrame";
import { demoContract } from "../../data/demo-catalog";
import { CTABanner } from "../layout/CTABanner";
import { ThreePaymentsNotice } from "./ThreePaymentsNotice";
import { ChannelExperience, ChannelMark } from "./ChannelExperience";
import { ANDROID_PLAY_STORE_URL, SIGNUP_URL } from "../../lib/constants";
import styles from "./ProductOperations.module.css";

type ProductKind = "channels" | "crm" | "booking" | "mobile";
type Translation = ReturnType<typeof useTranslations>;
const STAGES = ["new", "qualified", "proposal", "decision"] as const;
const PRODUCT_ICONS = { channels: Icon.inbox, crm: Icon.trendingUp, booking: Icon.calendar, mobile: Icon.layers };
const PRODUCT_PATHS = { channels: "canales", crm: "crm", booking: "reservas", mobile: "app-android" };

function CrmDemo({ t }: { t: Translation }) {
  const [stage, setStage] = useState(0);
  const [tab, setTab] = useState("profile");
  const [owner, setOwner] = useState(false);
  const [completed, setCompleted] = useState(false);
  const instanceId = useId();
  const pipelineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pipeline = pipelineRef.current;
    const column = pipeline?.children[stage] as HTMLElement | undefined;
    if (!pipeline || !column || pipeline.scrollWidth <= pipeline.clientWidth) return;
    const left = column.getBoundingClientRect().left - pipeline.getBoundingClientRect().left + pipeline.scrollLeft;
    pipeline.scrollTo({ left: left - 20, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [stage]);
  const reset = () => { setStage(0); setOwner(false); setCompleted(false); setTab("profile"); };
  return <div className={styles.crmDemo} data-demo-kind="illustrative">
    <div className={styles.demoTop}><span><span aria-hidden="true">{Icon.trendingUp("h-5 w-5")}</span>{t("crm.demoTitle")}</span><button type="button" onClick={reset}>{t("reset")}</button></div>
    <div className={styles.crmWorkspace}>
      <div className={styles.pipelineArea}>
        <div ref={pipelineRef} className={styles.pipeline} aria-live="polite" aria-atomic="true">
          {STAGES.map((key, index) => <div key={key} className={styles.pipelineColumn}><p className={styles.stage}><i aria-hidden="true" />{t(`crm.stage.${key}`)}</p>{stage === index ? <div className={styles.opportunity}><span className={styles.initials} aria-hidden="true">LM</span><strong>{t("crm.contact")}</strong><p>{t("crm.interest")}</p><span className={styles.contactTag}>WhatsApp</span><div className={styles.cardOwner}><span aria-hidden="true">{Icon.users("h-3 w-3")}</span>{t(owner ? "crm.ownerB" : "crm.ownerA")}</div></div> : <div className={styles.emptyStage} aria-hidden="true"><span /></div>}</div>)}
        </div>
        <div className={styles.pipelineControls}><p>{t("crm.tryMove")}</p><div><button type="button" disabled={stage === 0} onClick={() => setStage(stage - 1)}>{t("back")}</button><button type="button" disabled={stage === STAGES.length - 1} onClick={() => setStage(stage + 1)} className={styles.blueButton}>{t("crm.moveNext")}<span aria-hidden="true">{Icon.arrow("h-4 w-4")}</span></button></div></div>
        <div className={styles.contextNote}><span aria-hidden="true">{Icon.inbox("h-5 w-5")}</span><div><strong>{t("crm.handoffTitle")}</strong><p>{t("crm.handoffDescription")}</p></div></div>
      </div>
      <aside className={styles.contactDetail} aria-label={t("crm.contactPanel")}>
        <div className={styles.profileHeading}><span className={styles.initials} aria-hidden="true">LM</span><div><strong>{t("crm.contact")}</strong><small>{t("crm.sampleContact")}</small></div></div>
        <div className={styles.detailTabs} role="group" aria-label={t("crm.chooseDetail")}>{["profile", "history", "task"].map((key) => <button type="button" key={key} aria-pressed={tab === key} aria-controls={`${instanceId}-detail`} onClick={() => setTab(key)}>{t(`crm.tab.${key}`)}</button>)}</div>
        <div className={styles.detailContent} id={`${instanceId}-detail`}>
          {tab === "profile" && <><dl><div><dt>{t("crm.interestLabel")}</dt><dd>{t("crm.interest")}</dd></div><div><dt>{t("crm.stageLabel")}</dt><dd>{t(`crm.stage.${STAGES[stage]}`)}</dd></div><div><dt>{t("crm.ownerLabel")}</dt><dd>{t(owner ? "crm.ownerB" : "crm.ownerA")}</dd></div></dl><button className={styles.inlineButton} type="button" onClick={() => setOwner(!owner)}>{t("crm.changeOwner")}<span aria-hidden="true">{Icon.users("h-4 w-4")}</span></button></>}
          {tab === "history" && <ol className={styles.timeline}><li>{t("crm.historyReceived")}</li><li>{t("crm.historyHandoff")}</li>{stage > 0 && <li>{t("crm.historyStage", { stage: t(`crm.stage.${STAGES[stage]}`) })}</li>}{owner && <li>{t("crm.historyOwner")}</li>}{completed && <li>{t("crm.historyTask")}</li>}</ol>}
          {tab === "task" && <div className={styles.taskDetail}><span className={styles.smallLabel}>{t("crm.nextTask")}</span><label><input type="checkbox" checked={completed} onChange={(event) => setCompleted(event.target.checked)} /><span>{t("crm.taskName")}</span></label><p>{t(completed ? "crm.taskDone" : "crm.taskPending")}</p><small>{t("crm.taskOwner", { owner: t(owner ? "crm.ownerB" : "crm.ownerA") })}</small></div>}
        </div>
      </aside>
    </div>
    <p className={styles.demoFoot}>{t("crm.localOnly")}</p>
  </div>;
}

function BookingDemo({ t }: { t: Translation }) {
  const [service, setService] = useState("consultation");
  const [staff, setStaff] = useState("teamA");
  const [time, setTime] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const instanceId = useId();
  const slots = staff === "teamA" ? ["09:00", "10:30", "14:00"] : ["11:00", "15:00", "16:30"];
  const reset = () => { setTime(null); setConfirmed(false); };
  return <div className={styles.bookingDemo}>
    <div className={styles.demoTop}><span><span aria-hidden="true">{Icon.calendar("h-5 w-5")}</span>{t("booking.demoTitle")}</span><button type="button" onClick={reset}>{t("reset")}</button></div>
    <div className={styles.bookingGrid}>
      <div className={styles.bookingForm}>
        <label htmlFor={`${instanceId}-service`}>{t("booking.serviceLabel")}</label><select id={`${instanceId}-service`} value={service} onChange={(event) => { setService(event.target.value); reset(); }}><option value="consultation">{t("booking.consultation")}</option><option value="followup">{t("booking.followup")}</option></select>
        <label htmlFor={`${instanceId}-staff`}>{t("booking.staffLabel")}</label><select id={`${instanceId}-staff`} value={staff} onChange={(event) => { setStaff(event.target.value); reset(); }}><option value="teamA">{t("booking.teamA")}</option><option value="teamB">{t("booking.teamB")}</option></select>
        <span className={styles.smallLabel}>{t("booking.dayLabel")}</span><p className={styles.sampleDay}>{t("booking.sampleDay")}</p>
        <div className={styles.slots} role="group" aria-label={t("booking.chooseSlot")}>{slots.map((slot) => <button type="button" key={slot} aria-pressed={time === slot} onClick={() => { setTime(slot); setConfirmed(false); }}>{slot}</button>)}</div><p className={styles.slotNote}>{t("booking.slotNote")}</p>
      </div>
      <div className={styles.bookingSummary} aria-live="polite" aria-atomic="true"><span className={styles.summaryIcon} aria-hidden="true">{confirmed ? Icon.check("h-7 w-7") : Icon.calendar("h-7 w-7")}</span><span className={styles.smallLabel}>{t(confirmed ? "booking.simulated" : "booking.review")}</span><h3>{t(`booking.${service}`)}</h3><dl><div><dt>{t("booking.staffLabel")}</dt><dd>{t(`booking.${staff}`)}</dd></div><div><dt>{t("booking.timeLabel")}</dt><dd>{time ?? t("booking.chooseTime")}</dd></div><div><dt>{t("booking.statusLabel")}</dt><dd>{t(confirmed ? "booking.demoConfirmed" : "booking.pending")}</dd></div></dl><button type="button" className={styles.blueButton} disabled={!time || confirmed} onClick={() => setConfirmed(true)}>{t(confirmed ? "booking.done" : "booking.confirm")}</button><p>{t("booking.localOnly")}</p></div>
    </div>
  </div>;
}

function MobileDemo({ t }: { t: Translation }) {
  const [tab, setTab] = useState("inbox");
  const instanceId = useId();
  return <figure className={styles.mobileFigure}><figcaption>{t("illustrative")}</figcaption><div className={styles.phone}>
    <div className={styles.phoneTop}><span aria-hidden="true" /><strong>Parallly</strong><span className={styles.storePill}>{t("mobile.storeBadge")}</span></div>
    <div className={styles.phoneScreen} id={`${instanceId}-screen`}><p className={styles.phoneEyebrow}>{t("mobile.workspace")}</p><h3>{t(`mobile.screen.${tab}`)}</h3>
      {tab === "inbox" && <><div className={styles.mobileHandoff}><span aria-hidden="true">{Icon.users("h-4 w-4")}</span>{t("mobile.handoff")}</div>{[1, 2, 3].map((number) => <div key={number} className={styles.phoneRow}><span className={styles.initials} aria-hidden="true">{["LM", "AR", "CD"][number - 1]}</span><div><strong>{t(`mobile.contact${number}`)}</strong><p>{t(`mobile.preview${number}`)}</p><small>{number === 2 ? "Instagram" : "WhatsApp"}</small></div></div>)}</>}
      {tab === "crm" && <><div className={styles.mobileProfile}><span className={styles.initials} aria-hidden="true">LM</span><h4>{t("crm.contact")}</h4><p>{t("crm.interest")}</p></div><dl><div><dt>{t("crm.stageLabel")}</dt><dd>{t("crm.stage.proposal")}</dd></div><div><dt>{t("crm.ownerLabel")}</dt><dd>{t("crm.ownerA")}</dd></div></dl><p className={styles.mobileContext}>{t("mobile.contactContext")}</p></>}
      {tab === "tasks" && <div className={styles.mobileTasks}>{[1, 2, 3].map((number) => <div key={number}><span aria-hidden="true" /><p>{t(`mobile.task${number}`)}</p></div>)}<p className={styles.mobileContext}>{t("mobile.taskScope")}</p></div>}
    </div>
    <div className={styles.phoneNav} role="group" aria-label={t("mobile.chooseScreen")}>{(["inbox", "crm", "tasks"] as const).map((key) => <button key={key} type="button" aria-pressed={tab === key} aria-controls={`${instanceId}-screen`} onClick={() => setTab(key)}><span aria-hidden="true">{key === "inbox" ? Icon.inbox("h-5 w-5") : key === "crm" ? Icon.users("h-5 w-5") : Icon.check("h-5 w-5")}</span>{t(`mobile.screen.${key}`)}</button>)}</div>
  </div><p>{t("mobile.demoNote")}</p></figure>;
}

function ProductPreview({ kind, t }: { kind: ProductKind; t: Translation }) {
  if (kind === "mobile") return <MobileDemo t={t} />;
  return <figure className={styles.heroPreview}><figcaption>{t("illustrative")}</figcaption><div className={styles.previewCard}>
    <div className={styles.previewTop}><strong>Parallly</strong><span>{t(`${kind}.previewLabel`)}</span></div>
    {kind === "channels" ? <><div className={styles.channelMarks}>{(["whatsapp", "instagram", "messenger", "telegram", "web"] as const).map((channel) => <span key={channel}><ChannelMark channel={channel} /></span>)}</div><div className={styles.connectionLines} aria-hidden="true" /><div className={styles.hub}><span aria-hidden="true">{Icon.inbox("h-7 w-7")}</span><strong>{t("channels.previewTitle")}</strong><p>{t("channels.previewDescription")}</p></div></> : <><div className={styles.previewMessage}><span className={styles.smallLabel}>{t("customer")}</span><p>{t(`${kind}.previewMessage`)}</p></div><div className={styles.previewOutcome}><span className={styles.previewIcon} aria-hidden="true">{PRODUCT_ICONS[kind]("h-6 w-6")}</span><div><span className={styles.smallLabel}>{t(`${kind}.previewStep`)}</span><strong>{t(`${kind}.previewTitle`)}</strong><p>{t(`${kind}.previewDescription`)}</p></div></div></>}
    <div className={styles.previewTeam}><span aria-hidden="true">{Icon.users("h-5 w-5")}</span><div><strong>{t("teamContext")}</strong><p>{t(`${kind}.previewTeam`)}</p></div></div>
  </div></figure>;
}

export function ProductOperationsPage({ kind }: { kind: ProductKind }) {
  const t = useTranslations("productOperations");
  return <div className={styles.page}>
    <section className={styles.hero}><div className={styles.heroInner}><div><Link href="/producto" className={styles.backLink}><span aria-hidden="true">←</span>{t("backProduct")}</Link><p className={styles.eyebrow}>{t(`${kind}.eyebrow`)}</p><h1>{t(`${kind}.title`)}<span>{t(`${kind}.accent`)}</span></h1><p className={styles.heroDescription}>{t(`${kind}.description`)}</p><div className={styles.heroActions}><a className={styles.primaryCta} href={kind === "mobile" ? ANDROID_PLAY_STORE_URL : SIGNUP_URL} target={kind === "mobile" ? "_blank" : undefined} rel={kind === "mobile" ? "noopener noreferrer" : undefined}>{t(kind === "mobile" ? "mobile.downloadCta" : "start")}<span aria-hidden="true">{kind === "mobile" ? Icon.externalLink("h-4 w-4") : Icon.arrow("h-4 w-4")}</span></a><a className={styles.secondaryCta} href="#explorar">{t(`${kind}.explore`)}</a></div><p className={styles.heroNote}>{t(`${kind}.note`)}</p></div><ProductPreview kind={kind} t={t} /></div></section>
    <nav className={styles.productNav} aria-label={t("productNavigation")}><div>{(Object.keys(PRODUCT_PATHS) as ProductKind[]).map((key) => <Link key={key} href={`/producto/${PRODUCT_PATHS[key]}`} aria-current={kind === key ? "page" : undefined}>{t(`${key}.shortName`)}</Link>)}</div></nav>
    <div id="explorar" className={styles.anchor}>
      {kind === "channels" && <ChannelExperience />}
      {kind === "crm" && <section className={styles.demoSection}><div className={styles.container}><div className={styles.sectionHeading}><p className={styles.eyebrow}>{t("crm.demoEyebrow")}</p><h2>{t("crm.demoHeading")}</h2><p>{t("crm.demoDescription")}</p></div><div className={styles.demoLabel}>{t("illustrative")}</div><CrmDemo t={t} /></div></section>}
      {kind === "booking" && <section className={styles.demoSection}><div className={styles.container}><div className={styles.sectionHeading}><p className={styles.eyebrow}>{t("booking.demoEyebrow")}</p><h2>{t("booking.demoHeading")}</h2><p>{t("booking.demoDescription")}</p></div><DemoFrame contract={demoContract("appointment")} className={styles.lightDemoFrame}><BookingDemo t={t} /></DemoFrame></div></section>}
    </div>
    <section className={styles.featuresSection}><div className={styles.container}><div className={styles.sectionHeading}><p className={styles.eyebrow}>{t(`${kind}.featuresEyebrow`)}</p><h2>{t(`${kind}.featuresTitle`)}</h2><p>{t(`${kind}.featuresDescription`)}</p></div><div className={styles.featureGrid}>{[1, 2, 3, 4].map((number) => <article className={styles.feature} key={number}><span className={styles.featureNumber} aria-hidden="true">0{number}</span><h3>{t(`${kind}.feature${number}Title`)}</h3><p>{t(`${kind}.feature${number}Description`)}</p></article>)}</div></div></section>
    <section className={styles.rolesSection}><div className={styles.container}><div className={styles.rolesHeading}><p className={styles.eyebrow}>{t("rolesEyebrow")}</p><h2>{t(`${kind}.rolesTitle`)}</h2><p>{t(`${kind}.rolesDescription`)}</p></div><div className={styles.rolesGrid}>{["admin", "supervisor", "agent"].map((role) => <article key={role}><span aria-hidden="true">{role === "admin" ? Icon.shield("h-5 w-5") : role === "supervisor" ? Icon.chart("h-5 w-5") : Icon.users("h-5 w-5")}</span><h3>{t(`roles.${role}`)}</h3><p>{t(`${kind}.role.${role}`)}</p></article>)}</div></div></section>
    {kind === "channels" && <div className={styles.payments}><ThreePaymentsNotice /></div>}
    <section className={styles.guideSection}><div className={styles.guideInner}><div className={styles.assistMark} aria-hidden="true">{Icon.sparkles("h-7 w-7")}</div><div><p className={styles.eyebrow}>{t("guideEyebrow")}</p><h2>{t(`${kind}.guideTitle`)}</h2><p>{t(`${kind}.guideDescription`)}</p></div><Link href="/producto/parallly-assist" className={styles.guideLink}>{t("guideLink")}<span aria-hidden="true">{Icon.arrow("h-4 w-4")}</span></Link></div><p className={styles.scope}>{t(`${kind}.scope`)}</p></section>
    <CTABanner />
  </div>;
}
