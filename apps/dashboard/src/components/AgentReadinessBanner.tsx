"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Sparkles, Check, ArrowRight, MessageSquare, FileText, Clock, BookOpen } from "lucide-react";
import { api } from "@/lib/api";

interface Props {
  tenantId: string | null | undefined;
  /** Whether THIS agent has at least one channel assigned (from the editor state). */
  channelAssigned: boolean;
}

interface ReadinessItem {
  key: string;
  done: boolean;
  href: string;
  icon: React.ElementType;
}

/**
 * Banner de readiness del agente (Fase 2.5): muestra las 4 piezas que hacen que el
 * agente esté "100% listo" para vender — canal asignado, descripción del negocio
 * (about, el campo de mayor impacto en el prompt), horarios y conocimiento/FAQ.
 * Solo aparece si falta algo; si todo está completo, no renderiza nada.
 */
export function AgentReadinessBanner({ tenantId, channelAssigned }: Props) {
  const t = useTranslations("agent.readiness");
  const [status, setStatus] = useState<any | null>(null);

  useEffect(() => {
    let active = true;
    if (!tenantId) return;
    api
      .getSetupStatus(tenantId)
      .then((res: any) => { if (active && res?.success) setStatus(res.data); })
      .catch(() => { /* no bloquear el editor por esto */ });
    return () => { active = false; };
  }, [tenantId]);

  // No mostrar nada hasta tener datos (evita parpadeo) ni si falta el tenant.
  if (!tenantId || !status) return null;

  const items: ReadinessItem[] = [
    { key: "channel",   done: channelAssigned,             href: "/admin/channels/whatsapp",      icon: MessageSquare },
    { key: "about",     done: !!status.hasBusinessAbout,   href: "/admin/settings/business-info", icon: FileText },
    { key: "hours",     done: !!status.hasBusinessHours,   href: "/admin/settings/business-hours", icon: Clock },
    { key: "knowledge", done: !!status.hasKnowledge,       href: "/admin/knowledge",              icon: BookOpen },
  ];

  const pending = items.filter((i) => !i.done);
  if (pending.length === 0) return null; // todo listo → sin banner

  const doneCount = items.length - pending.length;

  return (
    <div className="rounded-xl border border-indigo-300 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/10 p-4 mb-6">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center shrink-0">
          <Sparkles size={18} className="text-indigo-600 dark:text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">{t("title")}</p>
          <p className="text-xs text-indigo-700 dark:text-indigo-400/80 mt-0.5">
            {t("subtitle", { done: doneCount, total: items.length })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {items.map((item) => {
              const Icon = item.icon;
              if (item.done) {
                return (
                  <span
                    key={item.key}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  >
                    <Check size={13} /> {t(`items.${item.key}`)}
                  </span>
                );
              }
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className="group inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-white/10 border border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-colors"
                >
                  <Icon size={13} /> {t(`items.${item.key}`)}
                  <ArrowRight size={12} className="opacity-60 group-hover:opacity-100" />
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
