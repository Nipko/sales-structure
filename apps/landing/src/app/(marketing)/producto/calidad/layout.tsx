import { buildMetadata } from "../../../../lib/seo";

export const metadata = buildMetadata({
  title: "Centro de calidad",
  description: "Revisa preparación, pruebas y evidencia del agente IA con orientación de Assist y decisiones humanas.",
  path: "/producto/calidad",
});

export default function QualityLayout({ children }: { children: React.ReactNode }) {
  return children;
}
