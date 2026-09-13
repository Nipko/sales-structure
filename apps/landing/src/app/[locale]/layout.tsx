import { notFound } from "next/navigation";
import LangProvider from "@/components/LangProvider";
import { isSupportedLocale, LOCALES } from "@/lib/seo";

export const dynamicParams = false;

export function generateStaticParams() {
  return LOCALES.map(locale => ({ locale }));
}

export default async function LocaleLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return <LangProvider initialLocale={locale}>{children}</LangProvider>;
}
