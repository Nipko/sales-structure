import { HeroSection } from "../../components/sections/BusinessHero";
import { StatsCounter } from "../../components/sections/StatsCounter";
import { BusinessSolutions } from "../../components/sections/BusinessSolutions";
import { BusinessRollout } from "../../components/sections/BusinessRollout";
import { BusinessAdaptability } from "../../components/sections/BusinessAdaptability";
import { ChannelExperience } from "../../components/sections/ChannelExperience";
import { IntelligenceShowcase } from "../../components/sections/PlatformIntelligence";
import { MobileAppShowcase } from "../../components/sections/MobileAppShowcase";
import { PricingSection } from "../../components/sections/PricingSection";
import { FAQSection } from "../../components/sections/FAQSection";
import { CTABanner } from "../../components/layout/CTABanner";
import { JsonLd } from "../../components/ui/JsonLd";
import { organizationJsonLd, softwareAppJsonLd } from "../../lib/seo";
import styles from "./home.module.css";

export default function HomePage() {
  return (
    <div className={styles.home}>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={softwareAppJsonLd()} />
      <HeroSection />
      <BusinessRollout />
      <BusinessSolutions />
      <ChannelExperience compact />
      <IntelligenceShowcase />
      <MobileAppShowcase />
      <BusinessAdaptability />
      <div className={styles.productState}>
        <StatsCounter />
      </div>
      <PricingSection />
      <FAQSection />
      <div className={styles.closing}>
        <CTABanner />
      </div>
    </div>
  );
}
