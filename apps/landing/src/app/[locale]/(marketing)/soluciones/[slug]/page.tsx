import type { Metadata } from "next";
import Page from "@/app/(marketing)/soluciones/[slug]/page";
import { VERTICALS } from "@/data/verticals";
import { localizedIndustryMetadata } from "@/lib/localized-seo";
import { isSupportedLocale } from "@/lib/seo";
export function generateStaticParams() { return VERTICALS.map(vertical => ({ slug: vertical.slug })); }
export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> { const { locale, slug } = await params; return isSupportedLocale(locale) ? localizedIndustryMetadata(locale, slug) : {}; }
export default Page;
