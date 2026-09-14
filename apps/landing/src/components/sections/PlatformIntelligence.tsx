"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Link from "../LocalizedLink";
import { CTABanner } from "../layout/CTABanner";
import styles from "./PlatformIntelligence.module.css";

export type IntelligenceKind = "agent" | "knowledge" | "assist" | "quality";

const INTELLIGENCE = [
  { kind: "agent", href: "/producto/agente-ia" },
  { kind: "knowledge", href: "/producto/conocimiento" },
  { kind: "assist", href: "/producto/parallly-assist" },
  { kind: "quality", href: "/producto/calidad" },
] as const;

const SOURCE_SCENARIOS = ["faq", "policy", "catalog"] as const;
const REVIEW_SCENARIOS = ["knowledge", "tests", "evidence"] as const;
const ASSIST_QUESTIONS = ["sources", "publish", "team"] as const;
const TEAM_ROLES = ["admin", "supervisor", "agent"] as const;

function Arrow({ back = false }: { back?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={back ? "M20 12H4m6-6-6 6 6 6" : "M4 12h16m-6-6 6 6-6 6"} /></svg>;
}

function ProductGlyph({ kind }: { kind: IntelligenceKind }) {
  const paths: Record<IntelligenceKind, ReactNode> = {
    agent: <><path d="M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-6l-6 3v-3a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z" /><path d="M8 10h8m-8 4h5" /></>,
    knowledge: <><path d="M12 6c-3-2-6-2-10-1v14c4-1 7-1 10 1 3-2 6-2 10-1V5c-4-1-7-1-10 1Zm0 0v14" /><path d="m5 9 4 1m6 0 4-1" /></>,
    assist: <><path d="M12 3a9 9 0 1 0 9 9M12 3v6h6" /><path d="m13 13 7-7m-5 0h5v5M8 16l2-2" /></>,
    quality: <><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z" /><path d="m8 12 3 3 5-6" /></>,
  };
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

/** These examples are local illustrations, never recordings or live tenant data. */
function Illustration({ children }: { children: ReactNode }) {
  const t = useTranslations("intelligence");
  const disclosure = useTranslations("labelledDemos");
  return (
    <figure className={styles.illustration} data-demo-kind="illustrative" data-demo-capability-state="implementedNotCertified">
      <figcaption className={styles.demoCaption}>
        <span className={styles.demoBadge}>{disclosure("kind.illustrative")}</span>
        <span>{disclosure("capability.implementedNotCertified")}</span>
      </figcaption>
      {children}
      <p className={styles.demoFootnote}>{t("demoNote")}</p>
    </figure>
  );
}

function SourceExplorer() {
  const t = useTranslations("intelligence.sources");
  const [scenario, setScenario] = useState<(typeof SOURCE_SCENARIOS)[number]>("faq");
  const panelId = useId();

  return (
    <Illustration>
      <div className={styles.workbench}>
        <div className={styles.workbenchHeader}><ProductGlyph kind="knowledge" /><strong>{t("title")}</strong><span>{t("status")}</span></div>
        <div className={styles.scenarioButtons} role="group" aria-label={t("choose")}>
          {SOURCE_SCENARIOS.map((item) => <button key={item} type="button" aria-pressed={scenario === item} aria-controls={panelId} onClick={() => setScenario(item)}>{t(`${item}.label`)}</button>)}
        </div>
        <div id={panelId} className={styles.sourceFlow} aria-live="polite" aria-atomic="true">
          <div className={styles.customerBubble}><span className={styles.smallLabel}>{t("customer")}</span><p>{t(`${scenario}.question`)}</p></div>
          <div className={styles.sourceCard}>
            <div className={styles.sourceHead}><ProductGlyph kind="knowledge" /><span>{t(`${scenario}.sourceType`)}</span><span className={styles.sourceTag}>{t("businessSource")}</span></div>
            <h4>{t(`${scenario}.sourceTitle`)}</h4><p>{t(`${scenario}.sourceText`)}</p>
          </div>
          <div className={styles.answerBubble}><span className={styles.answerMark} aria-hidden="true">P</span><div><span className={styles.smallLabel}>{t("agent")}</span><p>{t(`${scenario}.answer`)}</p><span className={styles.answerSource}>{t("basedOn", { source: t(`${scenario}.sourceTitle`) })}</span></div></div>
        </div>
      </div>
    </Illustration>
  );
}

function AssistExplorer() {
  const t = useTranslations("intelligence.assistance");
  const [question, setQuestion] = useState<(typeof ASSIST_QUESTIONS)[number]>("sources");
  const [role, setRole] = useState<(typeof TEAM_ROLES)[number]>("admin");
  const panelId = useId();

  return (
    <Illustration>
      <div className={styles.workbench}>
        <div className={styles.workbenchHeader}><ProductGlyph kind="assist" /><strong>Parallly Assist</strong><span>{t("internal")}</span></div>
        <div className={styles.roleSelector} role="group" aria-label={t("chooseRole")}><span>{t("roleLabel")}</span>{TEAM_ROLES.map((item) => <button type="button" key={item} aria-pressed={role === item} aria-controls={panelId} onClick={() => setRole(item)}>{t(`roles.${item}.name`)}</button>)}</div>
        <div className={styles.scenarioButtons} role="group" aria-label={t("choose")}>
          {ASSIST_QUESTIONS.map((item) => <button key={item} type="button" aria-pressed={question === item} aria-controls={panelId} onClick={() => setQuestion(item)}>{t(`${item}.label`)}</button>)}
        </div>
        <div id={panelId} className={styles.assistConversation} aria-live="polite" aria-atomic="true">
          <div className={styles.customerBubble}><span className={styles.smallLabel}>{t("yourTeam")}</span><p>{t(`${question}.question`)}</p></div>
          <div className={styles.assistAnswer}><span className={styles.assistMark} aria-hidden="true"><ProductGlyph kind="assist" /></span><div><strong>Parallly Assist</strong><p>{t(`${question}.${role}.answer`)}</p></div></div>
          <div className={styles.routePreview}><span className={styles.smallLabel}>{t("where")}</span><strong>{t(`${question}.${role}.route`)}</strong><span>{t(`roles.${role}.scope`)}</span></div>
          <p className={styles.humanNote}>{t("humanAction")}</p>
        </div>
      </div>
    </Illustration>
  );
}

function QualityExplorer() {
  const t = useTranslations("intelligence.review");
  const [scenario, setScenario] = useState<(typeof REVIEW_SCENARIOS)[number]>("knowledge");
  const panelId = useId();

  return (
    <Illustration>
      <div className={styles.workbench}>
        <div className={styles.workbenchHeader}><ProductGlyph kind="quality" /><strong>{t("title")}</strong><span>{t("access")}</span></div>
        <div className={styles.scenarioButtons} role="group" aria-label={t("choose")}>
          {REVIEW_SCENARIOS.map((item) => <button key={item} type="button" aria-pressed={scenario === item} aria-controls={panelId} onClick={() => setScenario(item)}>{t(`${item}.label`)}</button>)}
        </div>
        <ol id={panelId} className={styles.reviewFlow} aria-live="polite" aria-atomic="true">
          <li><span className={styles.flowPoint} aria-hidden="true" /><div><span className={styles.smallLabel}>{t("signal")}</span><h4>{t(`${scenario}.signal`)}</h4><p>{t(`${scenario}.detail`)}</p></div></li>
          <li><span className={styles.flowPoint} aria-hidden="true" /><div><span className={styles.smallLabel}>{t("guidance")}</span><h4>Parallly Assist</h4><p>{t(`${scenario}.guidance`)}</p></div></li>
          <li><span className={styles.flowPoint} aria-hidden="true" /><div><span className={styles.smallLabel}>{t("decision")}</span><h4>{t(`${scenario}.action`)}</h4><p>{t(`${scenario}.verification`)}</p></div></li>
        </ol>
        <p className={styles.reviewNote}>{t("note")}</p>
      </div>
    </Illustration>
  );
}

function Explorer({ kind }: { kind: IntelligenceKind }) {
  if (kind === "assist") return <AssistExplorer />;
  if (kind === "quality") return <QualityExplorer />;
  return <SourceExplorer />;
}

/** Home-ready: makes the customer agent, business sources and internal guidance distinct. */
export function IntelligenceShowcase() {
  const t = useTranslations("intelligence");
  const [active, setActive] = useState<IntelligenceKind>("assist");
  const panelId = useId();
  const current = INTELLIGENCE.find(({ kind }) => kind === active)!;

  return (
    <section className={styles.showcase} id="inteligencia" aria-labelledby={`${panelId}-title`}>
      <div className={styles.container}>
        <div className={styles.sectionIntro}><p className={styles.eyebrow}>{t("home.eyebrow")}</p><h2 id={`${panelId}-title`}>{t("home.title")}</h2><p>{t("home.description")}</p></div>
        <div className={styles.intelligenceSwitch} role="group" aria-label={t("home.choose")}>
          {INTELLIGENCE.map(({ kind }) => <button key={kind} type="button" aria-pressed={active === kind} aria-controls={panelId} onClick={() => setActive(kind)}><ProductGlyph kind={kind} /><span>{t(`${kind}.name`)}<small>{t(`${kind}.audience`)}</small></span></button>)}
        </div>
        <div id={panelId} className={styles.showcaseGrid}>
          <div className={styles.showcaseCopy}><p className={styles.eyebrow}>{t(`${active}.audience`)}</p><h3>{t(`${active}.shortTitle`)}</h3><p>{t(`${active}.summary`)}</p><Link href={current.href} className={styles.textLink}>{t("explore", { name: t(`${active}.name`) })}<Arrow /></Link></div>
          <div className={styles.explorer}><Explorer key={active} kind={active} /></div>
        </div>
      </div>
    </section>
  );
}

export function IntelligenceProductPage({ kind }: { kind: IntelligenceKind }) {
  const t = useTranslations("intelligence");
  return (
    <>
      <section className={styles.productHero}>
        <div className={styles.container}>
          <Link href="/producto" className={styles.backLink}><Arrow back />{t("platform")}</Link>
          <div className={styles.heroGrid}>
            <div><p className={styles.heroEyebrow}>{t(`${kind}.name`)}</p><h1>{t(`${kind}.title`)}</h1><p className={styles.heroDescription}>{t(`${kind}.description`)}</p><div className={styles.heroActions}><a href="#explorar" className={styles.primaryButton}>{t("seeExample")}<Arrow /></a><Link href="/precios" className={styles.secondaryButton}>{t("plans")}</Link></div></div>
            <aside className={styles.rolePanel}><span className={styles.heroGlyph}><ProductGlyph kind={kind} /></span><p className={styles.heroEyebrow}>{t(`${kind}.audience`)}</p><h2>{t(`${kind}.shortTitle`)}</h2><p>{t(`${kind}.summary`)}</p><div className={styles.roleNote}><span>{t("availability")}</span><p>{t(`${kind}.access`)}</p></div></aside>
          </div>
        </div>
      </section>
      <section className={styles.benefits} aria-label={t("benefits")}><div className={styles.container}><ul>{[1, 2, 3].map((item) => <li key={item}><span aria-hidden="true">{`0${item}`}</span><h2>{t(`${kind}.benefit${item}`)}</h2><p>{t(`${kind}.benefit${item}Text`)}</p></li>)}</ul></div></section>
      {kind === "agent" && (
        <section className={styles.functionSection}>
          <div className={`${styles.container} ${styles.practiceGrid}`}>
            <div className={styles.sectionIntro}><h2>{t("agent.functionTitle")}</h2><p>{t("agent.functionDescription")}</p></div>
            <dl className={styles.functionList}>
              {(["function", "tools", "team"] as const).map((item) => <div key={item}><dt>{t(`agent.${item}Label`)}</dt><dd>{t(`agent.${item}Text`)}</dd></div>)}
            </dl>
          </div>
        </section>
      )}
      <section className={styles.exampleSection} id="explorar"><div className={styles.container}><div className={styles.sectionIntro}><p className={styles.eyebrow}>{t("experience")}</p><h2>{t(`${kind}.exampleTitle`)}</h2><p>{t(`${kind}.exampleText`)}</p></div><div className={styles.largeExplorer}><Explorer kind={kind} /></div></div></section>
      <section className={styles.practiceSection}><div className={`${styles.container} ${styles.practiceGrid}`}><div className={styles.sectionIntro}><p className={styles.eyebrow}>{t("inPractice")}</p><h2>{t(`${kind}.practiceTitle`)}</h2><p>{t(`${kind}.practiceText`)}</p></div><ol className={styles.practiceList}>{[1, 2, 3].map((item) => <li key={item}><span className={styles.practiceNumber} aria-hidden="true">{`0${item}`}</span><div><h3>{t(`${kind}.step${item}`)}</h3><p>{t(`${kind}.step${item}Text`)}</p></div></li>)}</ol></div></section>
      <section className={styles.relatedSection}><div className={styles.container}><h2>{t("connectedTitle")}</h2><div className={styles.relatedLinks}>{INTELLIGENCE.filter((item) => item.kind !== kind).map((item) => <Link href={item.href} key={item.kind}><ProductGlyph kind={item.kind} /><span><strong>{t(`${item.kind}.name`)}</strong><small>{t(`${item.kind}.audience`)}</small></span><Arrow /></Link>)}</div></div></section>
      <CTABanner />
    </>
  );
}

const PLATFORM_GROUPS = [
  { id: "customers", items: [{ key: "channels", href: "/producto/canales" }, { key: "agent", href: "/producto/agente-ia" }, { key: "crm", href: "/producto/crm" }] },
  { id: "operations", items: [{ key: "booking", href: "/producto/reservas" }, { key: "payments", href: "/producto#operacion" }, { key: "team", href: "/producto#equipo" }] },
  { id: "intelligence", items: [{ key: "knowledge", href: "/producto/conocimiento" }, { key: "assist", href: "/producto/parallly-assist" }, { key: "quality", href: "/producto/calidad" }] },
  { id: "visibility", items: [{ key: "analytics", href: "/producto#analitica" }, { key: "mobile", href: "/producto/app-android" }] },
] as const;

export function PlatformProductPage() {
  const t = useTranslations("platformHub");
  return (
    <>
      <section className={styles.productHero}><div className={styles.container}><div className={styles.heroGrid}>
        <div><p className={styles.heroEyebrow}>{t("eyebrow")}</p><h1>{t("title")}</h1><p className={styles.heroDescription}>{t("description")}</p><div className={styles.heroActions}><a href="#mapa-plataforma" className={styles.primaryButton}>{t("explore")}<Arrow /></a><Link href="/precios" className={styles.secondaryButton}>{t("plans")}</Link></div></div>
        <div className={styles.platformDiagram} aria-label={t("diagramLabel")}><div className={styles.diagramTop}><span>{t("customerSide")}</span><span>{t("teamSide")}</span></div><div className={styles.diagramBrand}><img src="/parallly-logo.svg" alt="Parallly" /><span>{t("diagramConnection")}</span></div><div className={styles.diagramTracks}>{["respond", "coordinate", "improve"].map((track) => <div key={track}><span className={styles.trackPoint} aria-hidden="true" /><strong>{t(`diagram.${track}`)}</strong><p>{t(`diagram.${track}Text`)}</p></div>)}</div><p className={styles.diagramNote}>{t("availability")}</p></div>
      </div></div></section>
      <section className={styles.platformMap} id="mapa-plataforma"><div className={styles.container}>
        <div className={styles.sectionIntro}><p className={styles.eyebrow}>{t("mapEyebrow")}</p><h2>{t("mapTitle")}</h2><p>{t("mapDescription")}</p></div>
        <nav className={styles.mapNav} aria-label={t("mapNavigation")}>{PLATFORM_GROUPS.map((group) => <a key={group.id} href={group.id === "operations" ? "#operacion" : `#plataforma-${group.id}`}>{t(`${group.id}.name`)}<Arrow /></a>)}</nav>
        {PLATFORM_GROUPS.map((group, index) => (
          <div key={group.id} className={styles.mapGroup} id={group.id === "operations" ? "operacion" : `plataforma-${group.id}`}>
            <div className={styles.mapGroupHeading}>
              <span className={styles.groupNumber} aria-hidden="true">{`0${index + 1}`}</span>
              <h3>{t(`${group.id}.title`)}</h3><p>{t(`${group.id}.description`)}</p>
            </div>
            <ul className={styles.productList}>
              {group.items.map((item) => {
                const expandable = ["payments", "team", "analytics"].includes(item.key);
                const content = <span><strong>{t(`products.${item.key}.name`)}</strong><span>{t(`products.${item.key}.description`)}</span></span>;
                return (
                  <li key={item.key} id={item.key === "team" ? "equipo" : item.key === "analytics" ? "analitica" : undefined}>
                    {expandable ? (
                      <details className={styles.productDetails}>
                        <summary>{content}<span className={styles.expandMark} aria-hidden="true">+</span></summary>
                        <div><p>{t(`products.${item.key}.details`)}</p></div>
                      </details>
                    ) : <Link href={item.href}>{content}<Arrow /></Link>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div></section>
      <section className={styles.platformExample}><div className={`${styles.container} ${styles.practiceGrid}`}><div className={styles.sectionIntro}><p className={styles.eyebrow}>{t("exampleEyebrow")}</p><h2>{t("exampleTitle")}</h2><p>{t("exampleDescription")}</p><Link href="/producto/parallly-assist" className={styles.textLink}>{t("exampleLink")}<Arrow /></Link></div><AssistExplorer /></div></section>
      <CTABanner />
    </>
  );
}
