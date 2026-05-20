import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import LangProvider from "@/components/LangProvider";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jakarta",
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://parallly-chat.cloud"),
  title: {
    default: "Parallly — IA conversacional para vender, atender y agendar 24/7",
    template: "%s | Parallly",
  },
  description:
    "Conecta WhatsApp, Instagram y Messenger. Tu agente IA responde, agenda citas, califica leads y vende sin que muevas un dedo. Adaptado a 18 industrias. Hecho en LatinoAmérica.",
  keywords: [
    "WhatsApp automation",
    "automatización WhatsApp",
    "chatbot IA WhatsApp",
    "CRM WhatsApp",
    "agente IA negocios",
    "Parallly",
    "IA conversacional",
    "automatización ventas LatAm",
    "Meta Tech Provider",
    "chatbot Instagram",
    "chatbot Messenger",
    "agendamiento por chat",
    "CRM para PYMES",
    "inteligencia artificial para ventas",
    "WhatsApp Business API Colombia",
    "software de ventas LatAm",
  ],
  openGraph: {
    title: "Parallly — IA conversacional para tu negocio",
    description:
      "Tu agente IA responde en segundos, agenda citas y vende 24/7. 18 industrias. Pagos seguros con MercadoPago. Hecho en LatAm.",
    type: "website",
    locale: "es_CO",
    siteName: "Parallly",
    url: "https://parallly-chat.cloud",
    images: [
      {
        url: "/og/default.svg",
        width: 1200,
        height: 630,
        alt: "Parallly — IA conversacional para tu negocio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Parallly — IA conversacional para tu negocio",
    description:
      "Conecta WhatsApp + Instagram + Messenger. IA que vende y agenda 24/7. Adaptado a tu industria.",
    images: ["/og/default.svg"],
  },
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large" as const,
    "max-snippet": -1,
    "max-video-preview": -1,
  },
  alternates: {
    canonical: "https://parallly-chat.cloud",
    languages: {
      es: "https://parallly-chat.cloud",
      en: "https://parallly-chat.cloud",
      pt: "https://parallly-chat.cloud",
      fr: "https://parallly-chat.cloud",
    },
  },
  other: {
    "google-site-verification": "",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={jakarta.variable}>
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://admin.parallly-chat.cloud" />
        <meta name="theme-color" content="#09090b" />
      </head>
      <body className={`${jakarta.className} antialiased`}>
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
