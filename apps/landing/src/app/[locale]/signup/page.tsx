import type { Metadata } from "next";
import Page from "@/app/signup/page";
import { localizedMetadata } from "@/lib/localized-seo";
import { isSupportedLocale } from "@/lib/seo";
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> { const { locale } = await params; return isSupportedLocale(locale) ? localizedMetadata("/signup", locale, true) : {}; }
export default Page;
