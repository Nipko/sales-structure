import { HeroSection } from "../../components/sections/HeroSection";
import { ResultsBand } from "../../components/sections/ResultsBand";
import { StatsCounter } from "../../components/sections/StatsCounter";
import { TrustRow } from "../../components/sections/TrustRow";
import { VerticalsShowcase } from "../../components/sections/VerticalsShowcase";
import { ToolsShowcase } from "../../components/sections/ToolsShowcase";
import { MobileAppSection } from "../../components/sections/MobileAppSection";
import { AiControlSection } from "../../components/sections/AiControlSection";
import { PricingSection } from "../../components/sections/PricingSection";
import { FAQSection } from "../../components/sections/FAQSection";
import { CTABanner } from "../../components/layout/CTABanner";
import { JsonLd } from "../../components/ui/JsonLd";
import { organizationJsonLd, softwareAppJsonLd } from "../../lib/seo";

export default function HomePage() {
  return (
    <>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={softwareAppJsonLd()} />
      <HeroSection />
      <TrustRow />
      <ResultsBand />
      {/* The three states, one of which is a zero.

          This band existed, was code-backed, and was pinned by the validator —
          and was mounted on NO page, so the certification state it publishes
          reached no reader. A contract enforced over a component nobody renders
          is a contract about nothing: the five connectable channels were on the
          site and the zero certified ones were not. */}
      <StatsCounter />
      <ToolsShowcase />
      <VerticalsShowcase />
      <MobileAppSection />
      <AiControlSection />
      <PricingSection />
      <FAQSection />
      <CTABanner />
    </>
  );
}
