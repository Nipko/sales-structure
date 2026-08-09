import { buildMetadata } from "../../../lib/seo";

export const metadata = buildMetadata({
  title: "Estado de eliminación de datos",
  description: "Consulta el estado de una solicitud de eliminación de datos en Parallly.",
  path: "/data-deletion/status",
  noIndex: true,
});

export default function DataDeletionStatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}
