import { buildMetadata } from "../../../lib/seo";

export const metadata = buildMetadata({
  title: "Soluciones por industria",
  description:
    "Explora configuraciones de Parallly para ventas, atención, CRM y reservas adaptadas a distintos tipos de negocio.",
  path: "/soluciones",
});

export default function SolutionsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
