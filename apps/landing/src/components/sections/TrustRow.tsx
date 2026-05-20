"use client";

import { type ReactNode } from "react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Section } from "../ui/Section";
import { Icon } from "../ui/Icon";

interface TrustItem {
  key: string;
  titleKey: string;
  descKey: string;
  logo: string | null;
  logoAlt: string;
  icon?: ReactNode;
  badge: string;
  bg: string;
  ring: string;
}

export function TrustRow() {
  const t = useTranslations("trust");

  const items: TrustItem[] = [
    {
      key: "meta",
      titleKey: "metaTitle",
      descKey: "metaDesc",
      logo: "/logos/meta-tech-provider.svg",
      logoAlt: "Meta Tech Provider",
      badge: t("metaBadge"),
      bg: "bg-[#0064E0]/5",
      ring: "ring-[#0064E0]/20",
    },
    {
      key: "mp",
      titleKey: "mpTitle",
      descKey: "mpDesc",
      logo: "/logos/mercadopago.svg",
      logoAlt: "MercadoPago",
      badge: t("mpBadge"),
      bg: "bg-[#00B1EA]/5",
      ring: "ring-[#00B1EA]/20",
    },
    {
      key: "latam",
      titleKey: "latamTitle",
      descKey: "latamDesc",
      logo: null,
      logoAlt: "",
      icon: (
        <svg className="w-9 h-9 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
      ),
      badge: t("latamBadge"),
      bg: "bg-emerald-500/5",
      ring: "ring-emerald-500/20",
    },
    {
      key: "enc",
      titleKey: "encTitle",
      descKey: "encDesc",
      logo: null,
      logoAlt: "",
      icon: Icon.lock("w-9 h-9 text-emerald-400"),
      badge: "AES-256-GCM",
      bg: "bg-emerald-500/5",
      ring: "ring-emerald-500/20",
    },
  ];

  return (
    <Section id="confianza" className="bg-surface/30 border-y border-border/50">
      <div className="text-center mb-12">
        <h2 className="text-2xl sm:text-3xl font-bold">{t("title")}</h2>
      </div>

      {/* Logo strip */}
      <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6 mb-12 opacity-90">
        <img src="/logos/whatsapp.svg" alt="WhatsApp" className="h-7 w-auto" />
        <img src="/logos/instagram.svg" alt="Instagram" className="h-7 w-auto" />
        <img src="/logos/messenger.svg" alt="Messenger" className="h-7 w-auto" />
        <span className="w-px h-7 bg-border" aria-hidden />
        <img src="/logos/meta.svg" alt="Meta" className="h-6 w-auto" />
        <img src="/logos/mercadopago.svg" alt="MercadoPago" className="h-9 w-auto" />
      </div>

      {/* Trust cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {items.map((item, i) => (
          <motion.div
            key={item.key}
            className={`glass-card rounded-2xl p-5 hover:border-border-light transition-colors ring-1 ${item.ring}`}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
          >
            <div
              className={`mb-4 flex items-center justify-center w-full h-16 rounded-xl ${item.bg} px-4`}
            >
              {item.logo ? (
                <img src={item.logo} alt={item.logoAlt} className="h-9 w-auto" />
              ) : (
                item.icon ?? null
              )}
            </div>
            <h3 className="font-semibold text-text-primary leading-tight mb-2">
              {t(item.titleKey)}
            </h3>
            <p className="text-sm text-text-secondary leading-relaxed mb-3">
              {t(item.descKey)}
            </p>
            <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
              {item.badge}
            </span>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}
