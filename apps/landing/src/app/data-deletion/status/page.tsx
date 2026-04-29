"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLang } from "@/components/LangProvider";
import LegalLangSwitcher from "@/components/LegalLangSwitcher";

const API_BASE =
    (process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1").replace(/\/$/, "");

const STRINGS = {
    es: {
        backHome: "Volver al inicio",
        title: "Estado de la solicitud de eliminación",
        loading: "Consultando...",
        notFound: "No encontramos una solicitud con ese código. Verifica que sea correcto o inicia una nueva solicitud.",
        backToForm: "Crear una nueva solicitud",
        codeLabel: "Código",
        statusLabel: "Estado",
        sourceLabel: "Origen",
        requestedLabel: "Fecha de solicitud",
        processedLabel: "Procesada el",
        statuses: {
            received: "Recibida",
            processing: "En proceso",
            completed: "Completada",
            rejected: "Rechazada",
        } as Record<string, string>,
        sources: {
            meta_callback: "Callback de Meta",
            user_request: "Solicitud del usuario",
        } as Record<string, string>,
        contactNote: "¿Tienes preguntas? Escríbenos a ",
    },
    en: {
        backHome: "Back to home",
        title: "Deletion request status",
        loading: "Loading...",
        notFound: "We couldn't find a request with that code. Please verify it or start a new request.",
        backToForm: "Start a new request",
        codeLabel: "Code",
        statusLabel: "Status",
        sourceLabel: "Source",
        requestedLabel: "Requested at",
        processedLabel: "Processed at",
        statuses: {
            received: "Received",
            processing: "Processing",
            completed: "Completed",
            rejected: "Rejected",
        } as Record<string, string>,
        sources: {
            meta_callback: "Meta callback",
            user_request: "User request",
        } as Record<string, string>,
        contactNote: "Questions? Write to ",
    },
    pt: {
        backHome: "Voltar ao início",
        title: "Status da solicitação de exclusão",
        loading: "Consultando...",
        notFound: "Não encontramos uma solicitação com esse código. Verifique se está correto ou inicie uma nova solicitação.",
        backToForm: "Criar uma nova solicitação",
        codeLabel: "Código",
        statusLabel: "Status",
        sourceLabel: "Origem",
        requestedLabel: "Data da solicitação",
        processedLabel: "Processada em",
        statuses: {
            received: "Recebida",
            processing: "Em processamento",
            completed: "Concluída",
            rejected: "Rejeitada",
        } as Record<string, string>,
        sources: {
            meta_callback: "Callback da Meta",
            user_request: "Solicitação do usuário",
        } as Record<string, string>,
        contactNote: "Dúvidas? Escreva para ",
    },
    fr: {
        backHome: "Retour à l'accueil",
        title: "Statut de la demande de suppression",
        loading: "Chargement...",
        notFound: "Nous n'avons pas trouvé de demande avec ce code. Vérifiez qu'il est correct ou démarrez une nouvelle demande.",
        backToForm: "Démarrer une nouvelle demande",
        codeLabel: "Code",
        statusLabel: "Statut",
        sourceLabel: "Origine",
        requestedLabel: "Date de demande",
        processedLabel: "Traitée le",
        statuses: {
            received: "Reçue",
            processing: "En cours",
            completed: "Terminée",
            rejected: "Rejetée",
        } as Record<string, string>,
        sources: {
            meta_callback: "Rappel Meta",
            user_request: "Demande utilisateur",
        } as Record<string, string>,
        contactNote: "Des questions ? Écrivez à ",
    },
} as const;

interface DeletionStatus {
    success: boolean;
    status?: string;
    code?: string;
    source?: string;
    requestedAt?: string;
    processedAt?: string;
}

function StatusInner() {
    const { locale } = useLang();
    const t = STRINGS[(locale as keyof typeof STRINGS) || "es"] || STRINGS.es;
    const params = useSearchParams();
    const code = params.get("code") || "";

    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<DeletionStatus | null>(null);

    useEffect(() => {
        if (!code) {
            setLoading(false);
            setData({ success: false });
            return;
        }
        fetch(`${API_BASE}/meta/data-deletion/status?code=${encodeURIComponent(code)}`)
            .then((r) => r.json())
            .then((d) => setData(d))
            .catch(() => setData({ success: false }))
            .finally(() => setLoading(false));
    }, [code]);

    return (
        <div className="min-h-screen bg-bg text-text-primary">
            <div className="mx-auto max-w-2xl px-6 py-16">
                <Link
                    href="/"
                    className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-accent transition-colors mb-12"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    {t.backHome}
                </Link>

                <LegalLangSwitcher />

                <h1 className="text-3xl font-bold tracking-tight mb-8">{t.title}</h1>

                {loading ? (
                    <p className="text-text-muted">{t.loading}</p>
                ) : !data?.success ? (
                    <div className="rounded-xl border border-border bg-surface p-6">
                        <p className="text-sm text-text-secondary mb-4">{t.notFound}</p>
                        <Link
                            href="/data-deletion"
                            className="inline-flex items-center gap-2 text-sm bg-accent text-white px-4 py-2 rounded-lg font-medium hover:bg-accent/90 transition-colors"
                        >
                            {t.backToForm}
                        </Link>
                    </div>
                ) : (
                    <div className="rounded-xl border border-border bg-surface divide-y divide-border">
                        <Row label={t.codeLabel}>
                            <code className="font-mono text-text-primary">{data.code}</code>
                        </Row>
                        <Row label={t.statusLabel}>
                            <StatusBadge status={data.status} label={t.statuses[data.status || ""] || data.status || "—"} />
                        </Row>
                        <Row label={t.sourceLabel}>
                            <span>{t.sources[data.source || ""] || data.source || "—"}</span>
                        </Row>
                        <Row label={t.requestedLabel}>
                            <span>{data.requestedAt ? new Date(data.requestedAt).toLocaleString() : "—"}</span>
                        </Row>
                        <Row label={t.processedLabel}>
                            <span>
                                {data.processedAt ? new Date(data.processedAt).toLocaleString() : "—"}
                            </span>
                        </Row>
                    </div>
                )}

                <p className="text-xs text-text-muted mt-8">
                    {t.contactNote}
                    <a href="mailto:cloud.manager@parallext.com" className="text-accent hover:underline">
                        cloud.manager@parallext.com
                    </a>
                    .
                </p>
            </div>
        </div>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-4 px-6 py-4 text-sm">
            <span className="text-text-muted">{label}</span>
            <div className="text-right text-text-primary">{children}</div>
        </div>
    );
}

function StatusBadge({ status, label }: { status?: string; label: string }) {
    const cls =
        status === "completed"
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
            : status === "rejected"
              ? "bg-red-500/10 text-red-400 border-red-500/30"
              : status === "processing"
                ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                : "bg-amber-500/10 text-amber-400 border-amber-500/30";
    return (
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${cls}`}>
            {label}
        </span>
    );
}

export default function DataDeletionStatusPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-bg" />}>
            <StatusInner />
        </Suspense>
    );
}
