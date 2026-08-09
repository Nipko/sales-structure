import { buildMetadata } from "../../lib/seo";

export const metadata = buildMetadata({
  title: "Eliminación de cuenta y datos",
  description: "Solicita la eliminación de una cuenta de Parallly y de sus datos asociados.",
  path: "/data-deletion",
});

export default function DataDeletionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
