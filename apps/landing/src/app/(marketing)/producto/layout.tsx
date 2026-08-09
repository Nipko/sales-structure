import { buildMetadata } from "../../../lib/seo";

export const metadata = buildMetadata({
  title: "Producto",
  description:
    "Descubre cómo Parallly conecta canales, agentes de IA, CRM, agenda y el trabajo de tu equipo desde la web y Android.",
  path: "/producto",
});

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return children;
}
