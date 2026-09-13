import type { Metadata } from "next";
import HomePage from "@/app/(marketing)/page";
import { localizedMetadata } from "@/lib/localized-seo";
import { isSupportedLocale } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return isSupportedLocale(locale) ? localizedMetadata("/", locale) : {};
}
export default HomePage;
