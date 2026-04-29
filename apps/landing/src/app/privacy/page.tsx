"use client";

import { useLang } from "@/components/LangProvider";
import LegalLangSwitcher from "@/components/LegalLangSwitcher";
import PrivacyEs from "./content/es";
import PrivacyEn from "./content/en";
import PrivacyPt from "./content/pt";
import PrivacyFr from "./content/fr";

export default function PrivacyPage() {
  const { locale } = useLang();

  const renderContent = () => {
    switch (locale) {
      case "en":
        return <PrivacyEn />;
      case "pt":
        return <PrivacyPt />;
      case "fr":
        return <PrivacyFr />;
      case "es":
      default:
        return <PrivacyEs />;
    }
  };

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <LegalLangSwitcher />
        {renderContent()}
      </div>
    </div>
  );
}
