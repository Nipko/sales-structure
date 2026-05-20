"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useLang } from "../LangProvider";
import { SIGNUP_URL, LOGIN_URL } from "../../lib/constants";
import { SOLUTIONS_MENU, PRODUCT_MENU } from "../../data/navigation";
import { Icon } from "../ui/Icon";
import { MobileMenu } from "./MobileMenu";

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = useTranslations("nav");
  const { locale, setLocale, localeNames } = useLang();

  const openMenu = (key: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setActiveMenu(key);
  };

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setActiveMenu(null), 200);
  };

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const renderMega = (menu: typeof SOLUTIONS_MENU) => (
    <AnimatePresence>
      {activeMenu === menu.labelKey && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.15 }}
          className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-[540px] bg-bg/95 backdrop-blur-xl border border-border rounded-2xl shadow-2xl p-4 grid grid-cols-2 gap-1"
          onMouseEnter={() => openMenu(menu.labelKey)}
          onMouseLeave={scheduleClose}
        >
          {menu.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-start gap-3 p-3 rounded-xl hover:bg-surface-light transition-colors group"
              onClick={() => setActiveMenu(null)}
            >
              <span className="text-xl mt-0.5">{item.emoji}</span>
              <div>
                <p className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors">
                  {t(item.labelKey)}
                </p>
                <p className="text-xs text-text-muted mt-0.5">{t(item.descKey)}</p>
              </div>
            </Link>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <motion.header
        className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-bg/80 backdrop-blur-xl"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 h-16">
          <Link href="/" className="flex items-center gap-2">
            <img src="/parallly-logo.svg" alt="Parallly" className="h-9 w-auto" />
          </Link>

          <nav className="hidden lg:flex items-center gap-1 text-sm text-text-secondary">
            {/* Solutions mega menu */}
            <div
              className="relative"
              onMouseEnter={() => openMenu(SOLUTIONS_MENU.labelKey)}
              onMouseLeave={scheduleClose}
            >
              <Link
                href="/soluciones"
                className="flex items-center gap-1 px-3 py-2 rounded-lg hover:text-text-primary hover:bg-surface-light/50 transition-colors"
              >
                {t("navSolutions")}
                {Icon.chevronDown("w-3.5 h-3.5")}
              </Link>
              {renderMega(SOLUTIONS_MENU)}
            </div>

            {/* Product mega menu */}
            <div
              className="relative"
              onMouseEnter={() => openMenu(PRODUCT_MENU.labelKey)}
              onMouseLeave={scheduleClose}
            >
              <Link
                href="/producto"
                className="flex items-center gap-1 px-3 py-2 rounded-lg hover:text-text-primary hover:bg-surface-light/50 transition-colors"
              >
                {t("navProduct")}
                {Icon.chevronDown("w-3.5 h-3.5")}
              </Link>
              {renderMega(PRODUCT_MENU)}
            </div>

            <Link
              href="/precios"
              className="px-3 py-2 rounded-lg hover:text-text-primary hover:bg-surface-light/50 transition-colors"
            >
              {t("navPricing")}
            </Link>
          </nav>

          <div className="hidden lg:flex items-center gap-3">
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="bg-transparent text-xs text-text-secondary border border-border rounded-lg px-2 py-1.5 outline-none cursor-pointer hover:border-border-light transition-colors"
            >
              {Object.entries(localeNames).map(([code, name]) => (
                <option key={code} value={code} className="text-black">{name}</option>
              ))}
            </select>
            <a href={LOGIN_URL} className="text-sm text-text-secondary hover:text-text-primary transition-colors">
              {t("navLogin")}
            </a>
            <a
              href={SIGNUP_URL}
              className="text-sm bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded-lg font-semibold transition-colors"
            >
              {t("navStartFree")}
            </a>
          </div>

          <button
            className="lg:hidden text-text-secondary cursor-pointer"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Menu"
          >
            {mobileOpen ? Icon.close("w-6 h-6") : Icon.menu("w-6 h-6")}
          </button>
        </div>
      </motion.header>

      <MobileMenu open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </>
  );
}
