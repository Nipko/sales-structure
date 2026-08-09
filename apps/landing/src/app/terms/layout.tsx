import { buildMetadata } from "../../lib/seo";

export const metadata = buildMetadata({
  title: "Términos del servicio",
  description: "Consulta los términos que regulan el uso de la plataforma Parallly.",
  path: "/terms",
});

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
