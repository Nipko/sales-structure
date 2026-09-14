"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "../LocalizedLink";
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
  const { locale, setLocale, localeNames, hydrated } = useLang();

  const openMenu = (key: string) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setActiveMenu(key);
  };

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setActiveMenu(null), 200);
  };

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      document.querySelector<HTMLButtonElement>('header button[aria-expanded="true"]')?.focus();
      setActiveMenu(null);
      setMobileOpen(false);
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const renderMega = (menu: typeof SOLUTIONS_MENU) => {
    const menuId = `mega-${menu.labelKey}`;

    return (
      <AnimatePresence>
        {activeMenu === menu.labelKey && (
          <motion.div
            id={menuId}
            role="region"
            aria-label={t(menu.labelKey)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="site-mega absolute top-full left-1/2 -translate-x-1/2 mt-2 w-[650px] max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain border rounded-2xl shadow-2xl p-4 grid grid-cols-2 gap-1"
            onMouseEnter={() => openMenu(menu.labelKey)}
            onMouseLeave={scheduleClose}
          >
            <Link href={menu.labelKey === "navProduct" ? "/producto" : "/soluciones"} onClick={() => setActiveMenu(null)} className="col-span-2 flex items-center justify-between px-3 py-3 mb-2 border-b border-border font-semibold text-accent">
              {t(menu.labelKey === "navProduct" ? "menuOverview" : "menuAllBusinesses")}
              <span aria-hidden="true">{Icon.arrow("h-4 w-4")}</span>
            </Link>
            {menu.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-start gap-3 p-3 rounded-xl hover:bg-surface-light transition-colors group"
                onClick={() => setActiveMenu(null)}
              >
                <span className="text-accent mt-0.5" aria-hidden="true">{Icon[item.icon]("h-5 w-5")}</span>
                <div>
                  <p className="text-sm font-semibold text-text-primary group-hover:text-accent transition-colors">
                    {t(item.labelKey)}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">{t(item.descKey)}</p>
                </div>
              </Link>
            ))}
            {menu.labelKey === "navSolutions" && <Link href="/soluciones#adaptabilidad" onClick={() => setActiveMenu(null)} className="col-span-2 px-3 py-3 mt-2 rounded-lg bg-accent/5 text-sm font-semibold text-accent">{t("menuBusinessMissing")} →</Link>}
          </motion.div>
        )}
      </AnimatePresence>
    );
  };

  return (
    <>
      <a
        href="#contenido-principal"
        className="fixed left-4 top-3 z-[60] -translate-y-20 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-lg transition-transform focus:translate-y-0"
      >
        {t("skipToContent")}
      </a>
      <motion.header
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActiveMenu(null); }}
        className="site-header fixed top-0 left-0 right-0 z-50 border-b border-border/50 backdrop-blur-xl"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="mx-auto max-w-[1248px] flex items-center justify-between px-6 h-16">
          <Link href="/" className="flex items-center gap-2">
            <img src="/parallly-logo.svg" alt="Parallly" className="h-9 w-auto" />
          </Link>

          <nav className="hidden lg:flex items-center gap-1 text-sm text-text-secondary">
            {/* Solutions mega menu */}
            <div
              className="relative"
              onMouseLeave={scheduleClose}
            >
              <button
                type="button"
                aria-expanded={activeMenu === SOLUTIONS_MENU.labelKey}
                aria-controls={`mega-${SOLUTIONS_MENU.labelKey}`}
                onClick={() => activeMenu === SOLUTIONS_MENU.labelKey ? setActiveMenu(null) : openMenu(SOLUTIONS_MENU.labelKey)}
                className="flex items-center gap-1 px-3 py-2 rounded-lg hover:text-text-primary hover:bg-surface-light/50 transition-colors"
              >
                {t("navSolutions")}
                {Icon.chevronDown("w-3.5 h-3.5")}
              </button>
              {renderMega(SOLUTIONS_MENU)}
            </div>

            {/* Product mega menu */}
            <div
              className="relative"
              onMouseLeave={scheduleClose}
            >
              <button
                type="button"
                aria-expanded={activeMenu === PRODUCT_MENU.labelKey}
                aria-controls={`mega-${PRODUCT_MENU.labelKey}`}
                onClick={() => activeMenu === PRODUCT_MENU.labelKey ? setActiveMenu(null) : openMenu(PRODUCT_MENU.labelKey)}
                className="flex items-center gap-1 px-3 py-2 rounded-lg hover:text-text-primary hover:bg-surface-light/50 transition-colors"
              >
                {t("navProduct")}
                {Icon.chevronDown("w-3.5 h-3.5")}
              </button>
              {renderMega(PRODUCT_MENU)}
            </div>

            <Link
              href="/precios"
              onFocus={() => setActiveMenu(null)}
              className="px-3 py-2 rounded-lg hover:text-text-primary hover:bg-surface-light/50 transition-colors"
            >
              {t("navPricing")}
            </Link>
          </nav>

          <div className="hidden lg:flex items-center gap-3" onFocus={() => setActiveMenu(null)}>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              disabled={!hydrated}
              aria-label={t("languageAriaLabel")}
              className="bg-transparent text-xs text-text-secondary border border-border rounded-lg px-2 py-1.5 outline-none cursor-pointer hover:border-border-light transition-colors"
            >
              {Object.entries(localeNames).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
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
            className="lg:hidden rounded-lg p-2 text-text-secondary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={t("menuAriaLabel")}
            aria-expanded={mobileOpen}
            aria-controls="mobile-navigation"
          >
            {mobileOpen ? Icon.close("w-6 h-6") : Icon.menu("w-6 h-6")}
          </button>
        </div>
      </motion.header>

      <MobileMenu open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </>
  );
}
