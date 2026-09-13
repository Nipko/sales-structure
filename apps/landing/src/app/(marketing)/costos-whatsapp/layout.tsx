import { buildMetadata } from "../../../lib/seo";

export const metadata = buildMetadata({
  title: "Costos de WhatsApp: quién cobra qué",
  description:
    "Tres cobros distintos: tu suscripción a Parallly, los mensajes que Meta le cobra a tu propia cuenta de WhatsApp Business desde el 1 de octubre de 2026, y lo que tus clientes le pagan a tu negocio por tu pasarela.",
  path: "/costos-whatsapp",
});

export default function WhatsappCostsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
