"use client";

import { useLang } from "@/components/LangProvider";
import LegalLangSwitcher from "@/components/LegalLangSwitcher";
import DataPolicyEs from "./content/es";
import DataPolicyEn from "./content/en";
import DataPolicyPt from "./content/pt";
import DataPolicyFr from "./content/fr";

export default function DataPolicyPage() {
  const { locale } = useLang();

  const Content =
    locale === "en"
      ? DataPolicyEn
      : locale === "pt"
      ? DataPolicyPt
      : locale === "fr"
      ? DataPolicyFr
      : DataPolicyEs;

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <LegalLangSwitcher />
        <Content />
      </div>
    </div>
  );
}
