import { buildMetadata } from "../../../../lib/seo";

export const metadata = buildMetadata({
  title: "Base de conocimiento",
  description: "Organiza FAQs, artículos y documentos para dar contexto a tu agente IA con las fuentes del negocio.",
  path: "/producto/conocimiento",
});

export default function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
