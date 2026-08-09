import { buildMetadata } from "../../lib/seo";

export const metadata = buildMetadata({
  title: "Eliminación de datos",
  description: "Consulta el proceso para solicitar la eliminación de datos asociados a Parallly.",
  path: "/data-deletion",
});

export default function DataDeletionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
