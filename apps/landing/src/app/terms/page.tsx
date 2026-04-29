"use client";

import { useLang } from "@/components/LangProvider";
import LegalLangSwitcher from "@/components/LegalLangSwitcher";
import TermsEs from "./content/es";
import TermsEn from "./content/en";
import TermsPt from "./content/pt";
import TermsFr from "./content/fr";

export default function TermsPage() {
  const { locale } = useLang();

  const Content =
    locale === "en"
      ? TermsEn
      : locale === "pt"
      ? TermsPt
      : locale === "fr"
      ? TermsFr
      : TermsEs;

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <LegalLangSwitcher />
        <Content />
      </div>
    </div>
  );
}
