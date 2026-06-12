"use client";

import { HeroSection } from "../../components/sections/HeroSection";
import { ProblemSection } from "../../components/sections/ProblemSection";
import { ResultsBand } from "../../components/sections/ResultsBand";
import { TrustRow } from "../../components/sections/TrustRow";
import { VerticalsShowcase } from "../../components/sections/VerticalsShowcase";
import { VibeSellingBand } from "../../components/sections/VibeSellingBand";
import { ToolsShowcase } from "../../components/sections/ToolsShowcase";
import { HowItWorks } from "../../components/sections/HowItWorks";
import { FeaturesGrid } from "../../components/sections/FeaturesGrid";
import { AiControlSection } from "../../components/sections/AiControlSection";
import { ComparisonTable } from "../../components/sections/ComparisonTable";
import { StatsCounter } from "../../components/sections/StatsCounter";
import { TestimonialsSection } from "../../components/sections/TestimonialsSection";
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
      <ProblemSection />
      <ResultsBand />
      <HowItWorks />
      <VerticalsShowcase />
      <VibeSellingBand />
      <ToolsShowcase />
      <FeaturesGrid />
      <AiControlSection />
      <ComparisonTable />
      <StatsCounter />
      <TestimonialsSection />
      <TrustRow />
      <PricingSection />
      <FAQSection />
      <CTABanner />
    </>
  );
}
