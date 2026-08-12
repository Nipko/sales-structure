import { buildMetadata } from "../../../lib/seo";

export const metadata = buildMetadata({
  title: "Centro de soporte",
  description:
    "Contacta al equipo de soporte de Parallly y consulta qué información incluir para recibir ayuda con tu cuenta o la plataforma.",
  path: "/support",
});

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
