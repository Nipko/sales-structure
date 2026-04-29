"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams, useRouter } from "next/navigation";
import { Plug, CheckCircle2, AlertCircle, Trash2, RefreshCw, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const PROVIDER_META: Record<string, { name: string; logo: string; description: string }> = {
    hubspot: {
        name: "HubSpot",
        logo: "https://www.hubspot.com/favicon.ico",
        description: "Sincroniza contactos, deals y conversaciones con tu portal de HubSpot.",
    },
    pipedrive: {
        name: "Pipedrive",
        logo: "https://www.pipedrive.com/favicon.ico",
        description: "Empuja leads y notas a tu pipeline de Pipedrive.",
    },
    kommo: {
        name: "Kommo",
        logo: "https://www.kommo.com/favicon.ico",
        description: "Comparte contactos y conversaciones con tu cuenta Kommo.",
    },
};

export default function CrmIntegrationsPage() {
    const t = useTranslations("crmIntegrations");
    const { user } = useAuth();
    const tenantId = user?.tenantId;
    const search = useSearchParams();
    const router = useRouter();

    const [available, setAvailable] = useState<string[]>([]);
    const [connections, setConnections] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    function showToast(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(null), 3000);
    }

    useEffect(() => {
        if (!tenantId) return;
        load();
    }, [tenantId]);

    // Show feedback from OAuth callback redirect.
    useEffect(() => {
        const connected = search.get("connected");
        const error = search.get("error");
        const account = search.get("account");
        if (connected) {
            showToast(t("connectedAs", { provider: PROVIDER_META[connected]?.name ?? connected, account: account ?? "" }));
            router.replace("/admin/settings/integrations/crm");
        }
        if (error) {
            showToast(t("connectError", { msg: error }));
            router.replace("/admin/settings/integrations/crm");
        }
    }, [search]);

    async function load() {
        setLoading(true);
        const [a, c] = await Promise.all([api.listCrmProviders(), api.listCrmConnections(tenantId!)]);
        setAvailable(a.data?.providers ?? []);
        setConnections(c.data ?? []);
        setLoading(false);
    }

    async function connect(provider: string) {
        if (!tenantId) return;
        setBusyId(provider);
        const r = await api.startCrmConnect(tenantId, provider);
        setBusyId(null);
        if (r.success && r.data?.authorizeUrl) {
            window.location.href = r.data.authorizeUrl;
        } else {
            showToast(r.error ?? "Error");
        }
    }

    async function test(connectionId: string) {
        if (!tenantId) return;
        setBusyId(connectionId);
        const r = await api.testCrmConnection(tenantId, connectionId);
        setBusyId(null);
        if (r.success && r.data?.ok) {
            showToast(t("testOk", { details: r.data.details ?? "" }));
        } else {
            showToast(t("testFail", { details: r.data?.details ?? r.error ?? "" }));
        }
    }

    async function disconnect(connectionId: string) {
        if (!tenantId) return;
        if (!confirm(t("confirmDisconnect"))) return;
        setBusyId(connectionId);
        await api.disconnectCrm(tenantId, connectionId);
        setBusyId(null);
        showToast(t("disconnected"));
        load();
    }

    const connectedProviders = new Set(connections.filter((c) => c.status === "active").map((c) => c.provider));

    return (
        <div>
            {toast && (
                <div className="fixed top-6 right-6 z-[9999] bg-neutral-900 text-white px-4 py-2 rounded-xl text-sm shadow-lg max-w-md">
                    {toast}
                </div>
            )}
            <PageHeader title={t("title")} subtitle={t("subtitle")} icon={Plug} />

            {connections.length > 0 && (
                <div className="mb-6">
                    <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">{t("connectedTitle")}</h2>
                    <div className="space-y-2">
                        {connections.map((c) => (
                            <div
                                key={c.id}
                                className="flex items-center gap-4 p-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl"
                            >
                                {PROVIDER_META[c.provider] ? (
                                    <img src={PROVIDER_META[c.provider].logo} alt={c.provider} className="w-8 h-8" />
                                ) : (
                                    <Plug size={20} className="text-neutral-400" />
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <p className="text-sm font-medium">{PROVIDER_META[c.provider]?.name ?? c.provider}</p>
                                        {c.status === "active" ? (
                                            <span className="text-xs px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-md flex items-center gap-1">
                                                <CheckCircle2 size={12} /> {t("status.active")}
                                            </span>
                                        ) : (
                                            <span className="text-xs px-2 py-0.5 bg-red-500/10 text-red-600 dark:text-red-400 rounded-md flex items-center gap-1">
                                                <AlertCircle size={12} /> {t(`status.${c.status}`)}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-neutral-500 mt-1">
                                        {c.externalAccountName ?? c.externalAccountId ?? "—"}
                                        {c.lastSyncAt && (
                                            <span className="ml-2">
                                                · {t("lastSync")}: {new Date(c.lastSyncAt).toLocaleString()}
                                            </span>
                                        )}
                                    </p>
                                    {c.lastErrorMessage && (
                                        <p className="text-xs text-red-500 mt-1 truncate">{c.lastErrorMessage}</p>
                                    )}
                                </div>
                                <button
                                    onClick={() => test(c.id)}
                                    disabled={busyId === c.id}
                                    className="px-3 py-1.5 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg flex items-center gap-1 disabled:opacity-50"
                                >
                                    <RefreshCw size={12} /> {t("test")}
                                </button>
                                <button
                                    onClick={() => disconnect(c.id)}
                                    disabled={busyId === c.id}
                                    className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg flex items-center gap-1 disabled:opacity-50"
                                >
                                    <Trash2 size={12} /> {t("disconnect")}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div>
                <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">{t("availableTitle")}</h2>
                {loading ? (
                    <div className="text-sm text-neutral-500 py-8 text-center">{t("loading")}</div>
                ) : available.length === 0 ? (
                    <div className="text-sm text-neutral-500 py-8 text-center">{t("noProviders")}</div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {available.map((p) => {
                            const meta = PROVIDER_META[p];
                            const connected = connectedProviders.has(p);
                            return (
                                <div
                                    key={p}
                                    className="p-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl flex items-start gap-3"
                                >
                                    {meta?.logo ? (
                                        <img src={meta.logo} alt={p} className="w-10 h-10 rounded" />
                                    ) : (
                                        <Plug size={24} className="text-neutral-400" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium">{meta?.name ?? p}</p>
                                        <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{meta?.description ?? ""}</p>
                                    </div>
                                    <button
                                        onClick={() => connect(p)}
                                        disabled={busyId === p || connected}
                                        className={`shrink-0 px-3 py-1.5 text-xs rounded-lg flex items-center gap-1 ${
                                            connected
                                                ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                                                : "bg-indigo-500 text-white hover:bg-indigo-600"
                                        } disabled:opacity-50`}
                                    >
                                        {connected ? (
                                            <>
                                                <CheckCircle2 size={12} /> {t("connectedShort")}
                                            </>
                                        ) : (
                                            <>
                                                <ExternalLink size={12} /> {t("connect")}
                                            </>
                                        )}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
