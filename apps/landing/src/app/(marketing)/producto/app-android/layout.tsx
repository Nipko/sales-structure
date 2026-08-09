import { buildMetadata } from "../../../../lib/seo";

export const metadata = buildMetadata({
  title: "App Android para agentes",
  description:
    "Conoce la app Android de Parallly para agentes: conversaciones multicanal, copiloto de IA, CRM y operación diaria desde el teléfono. Acceso anticipado; Google Play próximamente.",
  path: "/producto/app-android",
});

export default function AndroidProductLayout({ children }: { children: React.ReactNode }) {
  return children;
}
