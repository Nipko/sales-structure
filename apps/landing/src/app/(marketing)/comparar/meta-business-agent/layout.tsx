import { buildMetadata } from "../../../../lib/seo";

export const metadata = buildMetadata({
  title: "Parallly y el agente de negocios de Meta",
  description:
    "Comparación tarea por tarea con fuentes públicas de Meta, fecha de consulta y lo que no pudimos comprobar. Sin superlativos ni resultados sin banco de pruebas.",
  path: "/comparar/meta-business-agent",
});

export default function CompareMetaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
