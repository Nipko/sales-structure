import { VERTICALS } from "../../../../data/verticals";
import IndustryPageClient from "./IndustryPageClient";

export function generateStaticParams() {
  return VERTICALS.map((v) => ({ slug: v.slug }));
}

export default function IndustryPage() {
  return <IndustryPageClient />;
}
