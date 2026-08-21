"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Briefcase, Loader2, MessageSquare } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTenant } from "@/contexts/TenantContext";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Los casos del estudio, con el vocabulario del estudio.
 *
 * El manifiesto declara `professional_case` como **objeto primario** de
 * `servicios_profesionales` y le daba una sola ruta: la agenda. El objeto
 * central del rubro no tenía pantalla, así que el equipo abría el embudo de
 * ventas y leía "Oportunidades", "Valor del negocio" y "Probabilidad de cierre"
 * sobre el expediente de un cliente. Y el enlace de un caso mencionado en el
 * Inbox llevaba a `null`, sin destino, porque no había a dónde.
 *
 * Un caso **es** una oportunidad del embudo — eso ya estaba decidido y la tool
 * `get_case_status` lo usa así. Lo que faltaba no era una tabla nueva, que
 * habría partido el dato en dos, sino leerla con las palabras del rubro.
 *
 * Sólo lectura, a propósito: abrir y mover un caso pasa por el motor de
 * transiciones del embudo, con las reglas que el estudio configuró. Una
 * escritura paralela las volvería decorativas.
 */

interface ProfessionalCase {
    id: string;
    reference: string;
    stage: string;
    isClosed: boolean;
    openedAt: string;
    lastUpdate: string;
    clientName: string | null;
    clientPhone: string | null;
    contactId: string | null;
    assignedTo: string | null;
}

export default function CasesPage() {
    const t = useTranslations("cases");
    const { activeTenantId } = useTenant();
    const [cases, setCases] = useState<ProfessionalCase[]>([]);
    const [filter, setFilter] = useState<"open" | "closed" | "all">("open");
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        setLoading(true);
        try {
            const res: any = await api.listProfessionalCases(activeTenantId, filter);
            if (res?.success) setCases(res.data || []);
        } catch { /* noop */ }
        setLoading(false);
    }, [activeTenantId, filter]);

    useEffect(() => { load(); }, [load]);

    return (
        <div className="space-y-5">
            <PageHeader icon={Briefcase} title={t("title")} subtitle={t("subtitle")} />

            <div className="flex gap-2">
                {(["open", "closed", "all"] as const).map((value) => (
                    <button
                        key={value}
                        onClick={() => setFilter(value)}
                        className={cn(
                            "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                            filter === value
                                ? "border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
                                : "border-border text-muted-foreground hover:bg-muted",
                        )}
                    >
                        {t(`filter_${value}`)}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground" /></div>
            ) : cases.length === 0 ? (
                <div className="rounded-xl border border-border bg-card px-6 py-14 text-center">
                    <Briefcase className="mx-auto h-10 w-10 text-muted-foreground/60" />
                    <h2 className="mt-3 font-semibold text-foreground">{t("emptyTitle")}</h2>
                    <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">{t("emptyDescription")}</p>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                    <table className="w-full min-w-[46rem] text-left text-sm">
                        <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th className="px-4 py-3 font-medium">{t("columnReference")}</th>
                                <th className="px-4 py-3 font-medium">{t("columnClient")}</th>
                                <th className="px-4 py-3 font-medium">{t("columnStage")}</th>
                                <th className="px-4 py-3 font-medium">{t("columnLastUpdate")}</th>
                                <th className="px-4 py-3 text-right font-medium">{t("columnActions")}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {cases.map((item) => (
                                <tr key={item.id} className="transition hover:bg-muted/20">
                                    <td className="px-4 py-3">
                                        {/* La MISMA referencia corta que el agente le dice
                                            al cliente por chat: que el equipo vea otra
                                            haría imposible cruzarlos por teléfono. */}
                                        <span className="font-mono text-xs font-semibold text-foreground">
                                            {item.reference}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-foreground">
                                        {item.clientName || t("unknownClient")}
                                        {item.clientPhone && (
                                            <span className="block text-xs text-muted-foreground">{item.clientPhone}</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={cn(
                                            "rounded-full px-2 py-0.5 text-[11px] font-medium",
                                            item.isClosed
                                                ? "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
                                                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
                                        )}>
                                            {item.stage}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-muted-foreground">
                                        {new Date(item.lastUpdate).toLocaleDateString()}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        {item.contactId && (
                                            <Link
                                                href={`/admin/inbox?contactId=${item.contactId}`}
                                                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                                            >
                                                <MessageSquare className="h-3 w-3" /> {t("openConversation")}
                                            </Link>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
