import { buildMetadata } from "../../../../lib/seo";

export const metadata = buildMetadata({
  title: "Parallly para Android — Disponible en Google Play",
  description:
    "Descarga Parallly en Google Play. Atiende conversaciones y sigue contactos, oportunidades y tareas desde Android con los permisos de tu equipo.",
  path: "/producto/app-android",
});

export default function AndroidProductLayout({ children }: { children: React.ReactNode }) {
  return children;
}
