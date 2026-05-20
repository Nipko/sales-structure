"use client";

import { motion, AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useLang } from "../LangProvider";
import { SIGNUP_URL, LOGIN_URL } from "../../lib/constants";

interface MobileMenuProps {
  open: boolean;
  onClose: () => void;
}

export function MobileMenu({ open, onClose }: MobileMenuProps) {
  const t = useTranslations("nav");
  const { locale, setLocale, localeNames } = useLang();

  const links = [
    { labelKey: "navSolutions", href: "/soluciones" },
    { labelKey: "navProduct", href: "/producto" },
    { labelKey: "navPricing", href: "/precios" },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed top-16 left-0 right-0 z-40 lg:hidden border-b border-border bg-bg overflow-hidden"
        >
          <div className="px-6 py-4 flex flex-col gap-4">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={onClose}
                className="text-text-secondary hover:text-text-primary transition-colors"
              >
                {t(link.labelKey)}
              </Link>
            ))}
            <hr className="border-border" />
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="bg-transparent text-sm border border-border rounded-lg px-2 py-1 outline-none cursor-pointer"
            >
              {Object.entries(localeNames).map(([code, name]) => (
                <option key={code} value={code} className="text-black">{name}</option>
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
