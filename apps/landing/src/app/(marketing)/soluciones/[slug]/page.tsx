import type { Metadata } from "next";
import { VERTICALS } from "../../../../data/verticals";
import { buildMetadata } from "../../../../lib/seo";
import IndustryPageClient from "./IndustryPageClient";

export function generateStaticParams() {
  return VERTICALS.map((v) => ({ slug: v.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const vertical = VERTICALS.find((item) => item.slug === slug);
  const name = (vertical?.slug ?? slug)
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  return buildMetadata({
    title: `Parallly para ${name}`,
    description: `Conoce cómo Parallly conecta conversaciones, IA, CRM y operación para negocios de ${name.toLocaleLowerCase("es")}.`,
    path: `/soluciones/${slug}`,
  });
}

export default function IndustryPage() {
  return <IndustryPageClient />;
}
