"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "../LocalizedLink";
import styles from "./BusinessSolutions.module.css";

const SOLUTIONS = [
  { id: "service", href: "/producto/agente-ia" },
  { id: "sales", href: "/producto/crm" },
  { id: "operations", href: "/producto/reservas" },
  { id: "insights", href: "/producto" },
] as const;

type SolutionId = (typeof SOLUTIONS)[number]["id"];
type Translation = ReturnType<typeof useTranslations>;

function SolutionIcon({ id }: { id: SolutionId }) {
  const paths = {
    service: <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8l-6 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 5h10M7 13h6" />,
    sales: <><path d="M4 4h16v5l-6 5v5l-4 2v-7L4 9V4Z" /><path d="M8 8h8" /></>,
    operations: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18m-13 4h3m2 0h3m-8 3h3" /></>,
    insights: <path d="M4 3v17h17M8 16v-5m5 5V7m5 9V4" />,
  };

  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[id]}
    </svg>
  );
}

function Arrow() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>;
}

function ServiceExample({ t }: { t: Translation }) {
  return (
    <div className={styles.serviceExample}>
      <div className={styles.exampleHeading}><SolutionIcon id="service" /><span>{t("service.visualTitle")}</span></div>
      <div className={styles.customerQuestion}><span className={styles.label}>{t("service.customer")}</span><p>{t("service.question")}</p></div>
      <div className={styles.answerCard}>
        <div className={styles.answerHeader}><span className={styles.aiMark} aria-hidden="true">P</span><strong>{t("service.agent")}</strong></div>
        <p>{t("service.answer")}</p>
        <span className={styles.source}><span aria-hidden="true" />{t("service.source")}</span>
      </div>
      <div className={styles.handoff}><span className={styles.handoffLine} aria-hidden="true" /><SolutionIcon id="service" /><span><strong>{t("service.handoffTitle")}</strong><small>{t("service.handoffDetail")}</small></span></div>
    </div>
  );
}

function SalesExample({ t }: { t: Translation }) {
  return (
    <div className={styles.salesExample}>
      <div className={styles.exampleHeading}><SolutionIcon id="sales" /><span>{t("sales.visualTitle")}</span></div>
      <div className={styles.pipeline}>
        {(["new", "followup", "proposal"] as const).map((stage, index) => (
          <div className={styles.pipelineColumn} key={stage}>
            <div className={styles.stageTitle}><span aria-hidden="true" />{t(`sales.${stage}`)}</div>
            <div className={`${styles.dealCard} ${index === 1 ? styles.activeDeal : ""}`}>
              <span className={styles.dealInitial} aria-hidden="true">{["A", "B", "C"][index]}</span>
              <strong>{t(`sales.deal${index + 1}`)}</strong>
              <small>{t(`sales.action${index + 1}`)}</small>
              <div className={styles.dealRule} aria-hidden="true" />
              <span className={styles.dealTag}>{t(`sales.tag${index + 1}`)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className={styles.nextAction}><span className={styles.checkBox} aria-hidden="true" /><div><span className={styles.label}>{t("sales.nextAction")}</span><strong>{t("sales.task")}</strong></div><span className={styles.owner}>{t("sales.owner")}</span></div>
    </div>
  );
}

function OperationsExample({ t }: { t: Translation }) {
  return (
    <div className={styles.operationsExample}>
      <div className={styles.exampleHeading}><SolutionIcon id="operations" /><span>{t("operations.visualTitle")}</span><span className={styles.dayLabel}>{t("operations.day")}</span></div>
      <div className={styles.calendar}>
        <div className={styles.calendarRow}><time>09:00</time><div className={styles.calendarEvent}><strong>{t("operations.appointment")}</strong><span>{t("operations.team")}</span></div></div>
        <div className={styles.calendarRow}><time>10:00</time><div className={styles.availableSlot}><span aria-hidden="true">+</span>{t("operations.available")}</div></div>
        <div className={styles.calendarRow}><time>11:00</time><div className={styles.calendarBlocked}>{t("operations.blocked")}</div></div>
      </div>
      <div className={styles.bookingNote}><span className={styles.checkMark} aria-hidden="true">✓</span><div><strong>{t("operations.confirmation")}</strong><small>{t("operations.confirmationDetail")}</small></div></div>
    </div>
  );
}

function InsightsExample({ t }: { t: Translation }) {
  const bars = [42, 68, 52, 86, 64, 38, 28];

  return (
    <div className={styles.insightsExample}>
      <div className={styles.exampleHeading}><SolutionIcon id="insights" /><span>{t("insights.visualTitle")}</span></div>
      <div className={styles.chartHeader}><strong>{t("insights.chartTitle")}</strong><span>{t("insights.period")}</span></div>
      <div className={styles.chart} aria-hidden="true">
        {bars.map((height, index) => <div className={styles.chartColumn} key={index}><div className={styles.barTrack}><div className={styles.bar} style={{ height: `${height}%` }}><span style={{ height: `${20 + index * 4}%` }} /></div></div><span>{t(`insights.day${index + 1}`)}</span></div>)}
      </div>
      <div className={styles.chartLegend}><span><i aria-hidden="true" />{t("insights.ai")}</span><span><i aria-hidden="true" />{t("insights.human")}</span></div>
      <div className={styles.insightRows}><div><span>{t("insights.responseTime")}</span><Arrow /></div><div><span>{t("insights.handoffReasons")}</span><Arrow /></div></div>
    </div>
  );
}

export function BusinessSolutions() {
  const t = useTranslations("businessSolutions");
  const [activeId, setActiveId] = useState<SolutionId>("service");
  const active = SOLUTIONS.find((solution) => solution.id === activeId)!;
  const illustrations = { service: ServiceExample, sales: SalesExample, operations: OperationsExample, insights: InsightsExample };
  const Example = illustrations[activeId];

  return (
    <section id="herramientas" className={styles.section} aria-labelledby="business-solutions-title">
      <div className={styles.container}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>{t("eyebrow")}</p>
          <h2 id="business-solutions-title">{t("title")}</h2>
          <p className={styles.subtitle}>{t("subtitle")}</p>
        </div>

        <div className={styles.controls} role="group" aria-label={t("selectorLabel")}>
          {SOLUTIONS.map((solution, index) => (
            <button key={solution.id} type="button" id={`solution-${solution.id}`} className={styles.control} aria-pressed={activeId === solution.id} aria-controls="business-solution-panel" onClick={() => setActiveId(solution.id)}>
              <span className={styles.controlNumber} aria-hidden="true">0{index + 1}</span>
              <SolutionIcon id={solution.id} /><span>{t(`${solution.id}.label`)}</span>
            </button>
          ))}
        </div>

        <div id="business-solution-panel" role="region" aria-labelledby={`solution-${activeId}`} className={styles.panel}>
          <div className={styles.panelCopy}>
            <p className={styles.problem}><span>{t("problemLabel")}</span>{t(`${activeId}.problem`)}</p>
            <h3>{t(`${activeId}.outcome`)}</h3>
            <ul className={styles.capabilities}>
              {[1, 2, 3].map((number) => <li key={number}><span aria-hidden="true">✓</span>{t(`${activeId}.capability${number}`)}</li>)}
            </ul>
            <Link href={active.href} className={styles.productLink}>{t(`${activeId}.link`)}<Arrow /></Link>
          </div>
          <figure className={styles.visual}>
            <div className={styles.example}><Example t={t} /></div>
            <figcaption>{t("illustrative")}</figcaption>
          </figure>
        </div>

        <p className={styles.caveat}>{t("caveat")}</p>
      </div>
    </section>
  );
}
