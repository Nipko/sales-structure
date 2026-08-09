import { HeroSection } from "../../components/sections/HeroSection";
import { ResultsBand } from "../../components/sections/ResultsBand";
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
