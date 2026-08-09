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
    default: "Parallly — Convierte conversaciones en ventas, citas y tareas",
    template: "%s | Parallly",
  },
  description:
    "Conecta conversaciones, IA, CRM, agenda, automatizaciones y equipo en una sola plataforma. Opera desde la web y la app Android para agentes en acceso anticipado.",
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
    title: "Parallly — Convierte conversaciones en ventas, citas y tareas",
    description:
      "IA con el contexto de tu negocio, CRM, agenda y equipo conectados en una sola operación.",
    type: "website",
    locale: "es_CO",
    siteName: "Parallly",
    url: "https://parallly-chat.cloud",
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
    title: "Parallly — Convierte conversaciones en ventas, citas y tareas",
    description:
      "IA con el contexto de tu negocio, CRM, agenda y equipo conectados en una sola operación.",
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
    canonical: "https://parallly-chat.cloud",
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
        <link rel="dns-prefetch" href="https://admin.parallly-chat.cloud" />
        <meta name="theme-color" content="#09090b" />
      </head>
      <body className={`${jakarta.className} antialiased`}>
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
