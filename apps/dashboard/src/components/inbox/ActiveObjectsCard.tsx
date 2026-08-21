"use client";

/**
 * Los objetos operativos abiertos del contacto, en el panel del Inbox.
 *
 * El panel mostraba el contacto y el canal. Quien atendía leía "confirmame la
 * reserva" y tenía que adivinar cuál, salir a buscarla y volver — mientras el
 * agente de IA recibía ese mismo objeto en cada turno desde hacía un release.
 *
 * Se muestra el contrato acotado que ve el modelo —tipo, estado, referencia,
 * fechas, importe, sujeto— y nada más: este panel no es una ventana a la base.
 * Cada objeto lleva su enlace al registro donde se trabaja, porque un panel
 * que muestra una reserva sin decir dónde está la deja tan lejos que antes.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { deepLinkForActiveObject } from "@parallext/shared";
import { api } from "@/lib/api";
import { ExternalLink, Loader2 } from "lucide-react";

interface ActiveObject {
    kind: string;
    id: string;
    status: string;
    statusClass?: string;
    reference?: string;
    label?: string;
    startsAt?: string;
    endsAt?: string;
    amount?: number | null;
    currency?: string;
    subject?: { label?: string } | null;
}

const STATUS_CLASS_STYLE: Record<string, string> = {
    upcoming: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    in_progress: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    awaiting_payment: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    cancelled: "bg-neutral-500/15 text-neutral-600 dark:text-neutral-400",
};

export function ActiveObjectsCard({ tenantId, conversationId }: {
    tenantId: string;
    conversationId: string;
}) {
    const t = useTranslations("inbox");
    const locale = useLocale();
    const [items, setItems] = useState<ActiveObject[]>([]);
    const [loading, setLoading] = useState(true);
    const [degraded, setDegraded] = useState(false);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        const res = await api.getConversationActiveObjects(tenantId, conversationId)
            .catch(() => null);
        setLoading(false);
        if (!res?.success) {
            // Una consulta caída no puede parecer "este contacto no tiene nada
            // abierto": quien atiende actuaría sobre una ausencia falsa.
            setFailed(true);
            setItems([]);
            return;
        }
        setItems(Array.isArray(res.data?.items) ? res.data.items : []);
        setDegraded(Boolean((res as any).degraded));
    }, [tenantId, conversationId]);

    useEffect(() => { load(); }, [load]);

    if (loading) {
        return (
            <div className="rounded-xl border border-border bg-muted/30 p-3.5 mb-4 flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                {t("activeObjects.loading")}
            </div>
        );
    }

    if (failed) {
        return (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 mb-4 text-[12px] text-amber-700 dark:text-amber-300">
                {t("activeObjects.failed")}
            </div>
        );
    }

    if (items.length === 0) return null;

    const money = (amount?: number | null, currency?: string) => {
        if (amount == null || !currency) return null;
        try {
            return new Intl.NumberFormat(locale, {
                style: "currency", currency, maximumFractionDigits: 0,
            }).format(amount);
        } catch {
            // Una moneda que Intl no conoce se muestra tal cual antes que
            // romper la tarjeta entera.
            return `${currency} ${amount}`;
        }
    };

    const day = (value?: string) => {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? null
            : new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" }).format(date);
    };

    return (
        <div className="rounded-xl border border-border bg-muted/30 p-3.5 mb-4">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                {t("activeObjects.title")}
            </div>
            {degraded && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2">
                    {t("activeObjects.partial")}
                </p>
            )}
            <div className="flex flex-col gap-2">
                {items.map((item) => {
                    const href = deepLinkForActiveObject(item.kind);
                    const dates = [day(item.startsAt), day(item.endsAt)].filter(Boolean).join(" → ");
                    const amount = money(item.amount, item.currency);
                    const title = item.label || item.subject?.label
                        || (t.has(`activeObjects.kind.${item.kind}`)
                            ? t(`activeObjects.kind.${item.kind}` as never)
                            : item.kind);
                    const body = (
                        <>
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[13px] font-medium truncate">{title}</span>
                                <span className={`ml-auto shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                    STATUS_CLASS_STYLE[item.statusClass || ""] || STATUS_CLASS_STYLE.cancelled
                                }`}>
                                    {item.status}
                                </span>
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate">
                                {[item.reference, dates, amount].filter(Boolean).join(" · ")}
                            </div>
                        </>
                    );
                    return href ? (
                        <Link
                            key={`${item.kind}-${item.id}`}
                            href={href}
                            className="rounded-lg border border-border bg-card px-2.5 py-2 hover:border-indigo-400 transition-colors"
                        >
                            {body}
                            <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-indigo-500">
                                <ExternalLink size={10} /> {t("activeObjects.open")}
                            </span>
                        </Link>
                    ) : (
                        // Sin pantalla propia todavía: se muestra sin enlace en vez
                        // de mandar a una ruta inventada que termina en 404.
                        <div
                            key={`${item.kind}-${item.id}`}
                            className="rounded-lg border border-border bg-card px-2.5 py-2"
                        >
                            {body}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
