import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Parallly — Automatiza tus ventas en WhatsApp con IA",
  description:
    "Plataforma de IA conversacional para ventas. Automatiza WhatsApp, Instagram y Messenger. Agente IA 24/7, CRM integrado, sin código.",
  keywords: [
    "WhatsApp automation",
    "ventas WhatsApp",
    "chatbot IA",
    "CRM WhatsApp",
    "automatizar ventas",
    "agente IA",
    "Parallly",
  ],
  openGraph: {
    title: "Parallly — Automatiza tus ventas en WhatsApp con IA",
    description:
      "Tu agente IA responde en segundos. Tu equipo cierra en minutos. Todo en una sola plataforma.",
    type: "website",
    locale: "es_LA",
    siteName: "Parallly",
  },
  twitter: {
    card: "summary_large_image",
    title: "Parallly — Automatiza tus ventas en WhatsApp con IA",
    description:
      "Tu agente IA responde en segundos. Tu equipo cierra en minutos.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={inter.variable}>
      <head>
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className={`${inter.className} antialiased`}>{children}</body>
    </html>
  );
}
