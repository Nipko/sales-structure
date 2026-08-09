import { buildMetadata } from "../../../../lib/seo";

export const metadata = buildMetadata({
  title: "CRM conversacional",
  description:
    "Convierte conversaciones en contactos, oportunidades, tareas y seguimiento comercial dentro del CRM integrado de Parallly.",
  path: "/producto/crm",
});

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return children;
}
