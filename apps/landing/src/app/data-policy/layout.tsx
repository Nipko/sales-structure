import { buildMetadata } from "../../lib/seo";

export const metadata = buildMetadata({
  title: "Política de tratamiento de datos",
  description: "Consulta la política de tratamiento y protección de datos de Parallly.",
  path: "/data-policy",
});

export default function DataPolicyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
