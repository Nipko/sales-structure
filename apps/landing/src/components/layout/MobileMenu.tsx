"use client";

import { motion, AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useLang } from "../LangProvider";
import { SIGNUP_URL, LOGIN_URL } from "../../lib/constants";
import { PRODUCT_MENU } from "../../data/navigation";

interface MobileMenuProps {
  open: boolean;
  onClose: () => void;
}

export function MobileMenu({ open, onClose }: MobileMenuProps) {
  const t = useTranslations("nav");
  const { locale, setLocale, localeNames } = useLang();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          id="mobile-navigation"
          role="navigation"
          aria-label={t("mobileNavigationAriaLabel")}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed top-16 left-0 right-0 z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-b border-border bg-bg lg:hidden"
        >
          <div className="px-6 py-4 flex flex-col gap-4">
            <Link href="/soluciones" onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
              {t("navSolutions")}
            </Link>
            <div>
              <Link href="/producto" onClick={onClose} className="text-text-primary font-semibold hover:text-accent transition-colors">
                {t("navProduct")}
              </Link>
              <div className="grid grid-cols-2 gap-2 mt-3">
                {PRODUCT_MENU.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-xs text-text-secondary hover:border-accent/40 hover:text-text-primary transition-colors"
                  >
                    <span aria-hidden="true">{item.emoji}</span>
                    <span>{t(item.labelKey)}</span>
                  </Link>
                ))}
              </div>
            </div>
            <Link href="/precios" onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
              {t("navPricing")}
            </Link>
            <hr className="border-border" />
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              aria-label={t("languageAriaLabel")}
              className="bg-transparent text-sm border border-border rounded-lg px-2 py-1 outline-none cursor-pointer"
            >
              {Object.entries(localeNames).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
            <a href={LOGIN_URL} className="text-text-secondary" onClick={onClose}>
              {t("navLogin")}
            </a>
            <a
              href={SIGNUP_URL}
              className="bg-accent text-white px-4 py-2.5 rounded-lg font-semibold text-center"
              onClick={onClose}
            >
              {t("navStartFree")}
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
