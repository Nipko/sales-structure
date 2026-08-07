import type { Metadata } from "next";

const SITE_URL = "https://parallly-chat.cloud";
const SITE_NAME = "Parallly";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og/default.svg`;

const LOCALES = ["es", "en", "pt", "fr"] as const;
type SupportedLocale = (typeof LOCALES)[number];

interface SEOInput {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  noIndex?: boolean;
  type?: "website" | "article";
  locale?: SupportedLocale;
}

export function buildMetadata({
  title,
  description,
  path,
  ogImage = DEFAULT_OG_IMAGE,
  noIndex = false,
  type = "website",
}: SEOInput): Metadata {
  const url = `${SITE_URL}${path}`;
  const fullTitle = path === "/" ? title : `${title} | ${SITE_NAME}`;

  const alternates: Record<string, string> = {};
  for (const loc of LOCALES) {
    alternates[loc] = url;
  }

  return {
    title: fullTitle,
    description,
    metadataBase: new URL(SITE_URL),
    alternates: {
      canonical: url,
      languages: alternates,
    },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: SITE_NAME,
      type,
      locale: "es_CO",
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [ogImage],
    },
    robots: noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true, "max-image-preview": "large" as const, "max-snippet": -1 },
    other: {
      "theme-color": "#09090b",
    },
  };
}

// JSON-LD helpers for structured data
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Parallly",
    url: SITE_URL,
    logo: `${SITE_URL}/parallly-logo.svg`,
    description: "Plataforma de IA conversacional para automatizar ventas, atención y agendamiento por WhatsApp, Instagram, Messenger, Telegram, SMS y Email.",
    foundingDate: "2025",
    areaServed: {
      "@type": "Place",
      name: "Latin America",
    },
    contactPoint: {
      "@type": "ContactPoint",
      email: "it.executive@parallext.com",
      contactType: "sales",
      availableLanguage: ["Spanish", "English", "Portuguese", "French"],
    },
    sameAs: [],
  };
}

export function softwareAppJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Parallly",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    description: "IA conversacional para vender, atender y agendar en WhatsApp, Instagram, Messenger, Telegram, SMS y Email.",
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: "21",
      highPrice: "349",
      offerCount: "4",
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.9",
      ratingCount: "500",
      bestRating: "5",
    },
  };
}

export function faqJsonLd(items: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${item.url}`,
    })),
  };
}

export function industryPageJsonLd(industry: {
  name: string;
  description: string;
  slug: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `Parallly para ${industry.name}`,
    description: industry.description,
    url: `${SITE_URL}/soluciones/${industry.slug}`,
    isPartOf: {
      "@type": "WebSite",
      name: "Parallly",
      url: SITE_URL,
    },
    breadcrumb: breadcrumbJsonLd([
      { name: "Inicio", url: "/" },
      { name: "Soluciones", url: "/soluciones" },
      { name: industry.name, url: `/soluciones/${industry.slug}` },
    ]),
  };
}

export function pricingJsonLd(plans: { name: string; price: number; currency: string; features: string[] }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Precios de Parallly",
    description: "Planes y precios de Parallly: desde $21 USD/mes para emprendedores hasta Enterprise.",
    mainEntity: plans.map((plan) => ({
      "@type": "Offer",
      name: plan.name,
      price: plan.price,
      priceCurrency: plan.currency,
      description: plan.features.join(", "),
      url: `${SITE_URL}/precios`,
    })),
  };
}
