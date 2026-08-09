import { buildMetadata } from "../../../../lib/seo";

export const metadata = buildMetadata({
  title: "Agentes de IA",
  description:
    "Configura agentes de IA con identidad de negocio, conocimiento, catálogo, políticas, reservas y transferencia al equipo humano.",
  path: "/producto/agente-ia",
});

export default function AiAgentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
