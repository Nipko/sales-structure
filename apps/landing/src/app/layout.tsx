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
  title: "Parallly — IA conversacional para vender, atender y agendar 24/7",
  description:
    "Conecta WhatsApp, Instagram y Messenger. Tu agente IA responde, agenda citas, califica leads y vende sin que muevas un dedo. Adaptado a 16 industrias. Hecho en LatinoAmérica.",
  keywords: [
    "WhatsApp automation",
    "ventas WhatsApp",
    "chatbot IA",
    "CRM WhatsApp",
    "agente IA negocios",
    "Parallly",
    "IA conversacional",
    "automatización ventas LatAm",
    "Meta Tech Provider",
  ],
  openGraph: {
    title: "Parallly — IA conversacional para tu negocio",
    description:
      "Tu agente IA responde en segundos, agenda citas y vende 24/7. Adaptado a 16 industrias. Pagos seguros con MercadoPago. Hecho en LatAm.",
    type: "website",
    locale: "es_LA",
    siteName: "Parallly",
  },
  twitter: {
    card: "summary_large_image",
    title: "Parallly — IA conversacional para tu negocio",
    description:
      "Conecta WhatsApp + Instagram + Messenger. IA que vende y agenda 24/7. Adaptado a tu industria.",
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
    <html lang="es" className={jakarta.variable}>
      <head>
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className={`${jakarta.className} antialiased`}>
        <LangProvider>{children}</LangProvider>
      </body>
    </html>
  );
}
