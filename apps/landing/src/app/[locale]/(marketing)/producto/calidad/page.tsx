import type { Metadata } from "next";
import Page from "@/app/(marketing)/producto/calidad/page";
import { localizedMetadata } from "@/lib/localized-seo";
import { isSupportedLocale } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return isSupportedLocale(locale) ? localizedMetadata("/producto/calidad", locale) : {};
}

export default Page;
