import type { Metadata } from "next";
import "./globals.css";
import LangProvider from "@/components/LangProvider";
import esMessages from "../../messages/es.json";

export const metadata: Metadata = {
  metadataBase: new URL("https://parallly-chat.cloud"),
  title: {
    default: esMessages.meta.title,
    template: "%s | Parallly",
  },
  description: esMessages.meta.description,
  keywords: [
    "WhatsApp automation",
    "automatización WhatsApp",
    "chatbot IA WhatsApp",
    "CRM WhatsApp",
    "agente IA negocios",
    "Parallly",
    "IA conversacional",
    "automatización ventas LatAm",
    "Meta Cloud API",
    "chatbot Instagram",
    "chatbot Messenger",
    "agendamiento por chat",
    "CRM para PYMES",
    "inteligencia artificial para ventas",
    "WhatsApp Business API Colombia",
    "software de ventas LatAm",
    "app Android para agentes",
  ],
  openGraph: {
    title: esMessages.meta.title,
    description: esMessages.meta.description,
    type: "website",
    locale: "es_CO",
    siteName: "Parallly",
    url: "https://parallly-chat.cloud/es",
    images: [
      {
        url: "/og/parallly-social.png",
        width: 1200,
        height: 630,
        alt: "Parallly conecta conversaciones, IA, CRM, agenda y equipo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: esMessages.meta.title,
    description: esMessages.meta.description,
    images: ["/og/parallly-social.png"],
  },
  robots: {
    index: true,
    follow: true,
    "max-image-preview": "large" as const,
    "max-snippet": -1,
    "max-video-preview": -1,
  },
  alternates: {
    canonical: "https://parallly-chat.cloud/es",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var m=location.pathname.match(/^\\/(es|en|pt|fr)(?:\\/|$)/);document.documentElement.lang=m?m[1]:'es';})();` }} />
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="dns-prefetch" href="https://admin.parallly-chat.cloud" />
        <meta name="theme-color" content="#102337" />
      </head>
      <body className="antialiased">
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
