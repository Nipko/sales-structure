"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";
import { useLang } from "./LangProvider";
import { isSupportedLocale, localizeInternalHref } from "../lib/seo";

export default function LocalizedLink({ href, ...props }: ComponentProps<typeof NextLink>) {
  const { locale } = useLang();
  const localized = typeof href === "string" && isSupportedLocale(locale)
    ? localizeInternalHref(href, locale)
    : href;
  return <NextLink href={localized} {...props} />;
}
