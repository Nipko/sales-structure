"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { FOOTER_SECTIONS } from "../../data/navigation";

export function Footer() {
  const t = useTranslations("nav");

  return (
    <footer className="border-t border-border bg-surface/30">
      <div className="mx-auto max-w-6xl px-6 py-14">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
          <div className="col-span-2 md:col-span-1">
            <img src="/parallly-logo.svg" alt="Parallly" className="h-9 w-auto mb-4" />
            <p className="text-text-muted text-sm leading-relaxed">{t("footerBrandDesc")}</p>
            <div className="mt-5 space-y-3">
              <img src="/logos/meta-tech-provider.svg" alt="Meta Tech Provider" className="h-7 w-auto" />
              <img src="/logos/mercadopago.svg" alt="MercadoPago Partner" className="h-7 w-auto" />
            </div>
          </div>

          {FOOTER_SECTIONS.map((section) => (
            <div key={section.titleKey}>
              <h4 className="text-sm font-semibold mb-4">{t(section.titleKey)}</h4>
              <ul className="space-y-2 text-sm text-text-muted">
                {section.links.map((link) => (
                  <li key={link.href}>
                    {link.href.startsWith("mailto:") || link.href === "#" ? (
                      <a href={link.href} className="hover:text-text-secondary transition-colors">
                        {t(link.labelKey)}
                      </a>
                    ) : (
                      <Link href={link.href} className="hover:text-text-secondary transition-colors">
                        {t(link.labelKey)}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-7 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-text-muted">{t("footerMadeBy")}</p>
          <p className="text-xs text-text-muted">{t("footerCopyright", { year: new Date().getFullYear() })}</p>
        </div>
      </div>
    </footer>
  );
}
