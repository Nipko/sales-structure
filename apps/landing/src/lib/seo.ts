import type { Metadata } from "next";

const SITE_URL = "https://parallly-chat.cloud";
const SITE_NAME = "Parallly";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og/parallly-social.png`;

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
  locale = "es",
}: SEOInput): Metadata {
  const url = `${SITE_URL}${path}`;
  const fullTitle = path === "/" ? title : `${title} | ${SITE_NAME}`;
  const openGraphLocale: Record<SupportedLocale, string> = {
    es: "es_CO",
    en: "en_US",
    pt: "pt_BR",
    fr: "fr_FR",
  };

  return {
    title: { absolute: fullTitle },
    description,
    metadataBase: new URL(SITE_URL),
    alternates: {
      canonical: url,
    },
    openGraph: {
      title: fullTitle,
      description,
      url,
      siteName: SITE_NAME,
      type,
      locale: openGraphLocale[locale],
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
    description: "Plataforma de IA conversacional para automatizar ventas, atención y agendamiento por WhatsApp, Instagram, Messenger, Telegram y Web Chat.",
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
    operatingSystem: "Web, Android",
    url: SITE_URL,
    description: "IA conversacional para vender, atender y agendar en WhatsApp, Instagram, Messenger, Telegram y Web Chat.",
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

export function pricingJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Precios de Parallly",
    description: "Consulta los planes y condiciones comerciales vigentes de Parallly.",
    url: `${SITE_URL}/precios`,
  };
}
