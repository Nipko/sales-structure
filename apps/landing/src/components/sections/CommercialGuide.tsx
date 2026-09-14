"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CONTACT_EMAIL } from "../../lib/constants";
import { Icon } from "../ui/Icon";

const needs = ["channels", "team", "tools", "volume"] as const;
type Need = typeof needs[number];

export function PageContents({ kind }: { kind: "pricing" | "costs" | "compare" }) {
  const t = useTranslations("commercialGuide");
  const sections = { pricing: ["planes", "comparar", "orientacion", "costos", "preguntas"], costs: ["pagos", "reglas", "estimador", "conexion", "preguntas"], compare: ["criterios", "alcance", "tareas", "elegir", "fuentes"] }[kind];
  return <nav className="page-contents" aria-label={t("contents")}><div><span>{t("contents")}</span>{sections.map(id => <a key={id} href={`#${id}`}>{t(`${kind}.${id}`)}</a>)}</div></nav>;
}

export function PricingIntro() {
  const t = useTranslations("commercialGuide");
  return <div className="pricing-intro">{["setup", "capacity", "clarity"].map((key, i) => <article key={key}><span aria-hidden="true">{[Icon.sparkles, Icon.users, Icon.layers][i]("h-5 w-5")}</span><strong>{t(`intro.${key}Title`)}</strong><p>{t(`intro.${key}Body`)}</p></article>)}</div>;
}

export function PlanGuide() {
  const t = useTranslations("commercialGuide");
  const [selected, setSelected] = useState<Need[]>(["channels"]);
  const body = [t("emailIntro"), ...selected.map(key => `${t(`needs.${key}`)}: ${t(`notes.${key}`)}`)].join("\n\n");
  return <div className="pricing-guide">
    <h2>{t("guideTitle")}</h2><p>{t("guideBody")}</p>
    <fieldset><legend>{t("needsLabel")}</legend>{needs.map(key => <button key={key} type="button" aria-pressed={selected.includes(key)} onClick={() => setSelected(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key])}>{t(`needs.${key}`)}</button>)}</fieldset>
    <aside aria-live="polite">{selected.length ? <ul>{selected.map(key => <li key={key}><strong>{t(`needs.${key}`)}: </strong>{t(`notes.${key}`)}</li>)}</ul> : <p>{t("chooseNeed")}</p>}</aside>
    <p>{t("guideNote")}</p>
    <a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t("emailSubject"))}&body=${encodeURIComponent(body)}`}>{t("emailCta")} →</a>
  </div>;
}
