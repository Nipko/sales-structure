import { buildMetadata } from "../../../../lib/seo";

export const metadata = buildMetadata({
  title: "Canales conectados",
  description:
    "Centraliza conversaciones de WhatsApp, Instagram, Messenger, Telegram, SMS y Email según la disponibilidad de tu plan.",
  path: "/producto/canales",
});

export default function ChannelsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
