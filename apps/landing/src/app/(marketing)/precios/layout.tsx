import { buildMetadata } from "../../../lib/seo";

export const metadata = buildMetadata({
  title: "Planes y precios",
  description:
    "Consulta el catálogo activo de Parallly: precios, moneda, prueba, límites y funcionalidades publicados desde la configuración de la plataforma.",
  path: "/precios",
});

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
