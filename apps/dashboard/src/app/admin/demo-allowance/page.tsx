"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Link2, Loader2, Save } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import {
    DEMO_ALLOWANCE_ENDPOINT,
    canSaveDemoAllowance,
    demoAllowanceFieldProblem,
    readDemoAllowanceSnapshot,
    type DemoAllowanceField,
    type DemoAllowanceFieldProblem,
    type DemoAllowanceSnapshot,
} from "./demo-allowance";

/**
 * What the platform pays on every account's public link ("El enlace de
 * {Nombre}", D19): a switch, the lifetime replies per account and the replies
 * per link and day.
 *
 * These three numbers are a cost the platform carries for every tenant whose
 * plan does not include the web chat, and until now they could only be moved
 * by SQL. The API validates and audits every change under the real operator
 * (`PUT /platform/demo-allowance`); this screen says what each number does in
 * the operator's words and refuses, before sending, what the API would refuse.
 *
 * When the platform could not read what is stored, the API answers the
 * defaults with `source: "fallback"` (F0). Those are not the numbers in force,
 * so the screen says so and does not let them be saved back over the real row.
 */

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "failed" };

export default function DemoAllowancePage() {
    const t = useTranslations("demoAllowancePage");
    const ids = useId();
    const [snapshot, setSnapshot] = useState<DemoAllowanceSnapshot | null>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
    const [enabled, setEnabled] = useState(true);
    const [draft, setDraft] = useState<Record<DemoAllowanceField, string>>({ messagesPerTenant: "", dailyCapPerPage: "" });
    const [save, setSave] = useState<SaveState>({ kind: "idle" });

    const adopt = useCallback((next: DemoAllowanceSnapshot) => {
        setSnapshot(next);
        setEnabled(next.allowance.enabled);
        setDraft({
            messagesPerTenant: String(next.allowance.messagesPerTenant),
            dailyCapPerPage: String(next.allowance.dailyCapPerPage),
        });
    }, []);

    const load = useCallback(async () => {
        setStatus("loading");
        try {
            const next = readDemoAllowanceSnapshot(await api.fetch(DEMO_ALLOWANCE_ENDPOINT));
            if (!next) { setStatus("unavailable"); return; }
            adopt(next);
            setStatus("ready");
        } catch {
            setStatus("unavailable");
        }
    }, [adopt]);

    useEffect(() => { void load(); }, [load]);

    if (status !== "ready" || !snapshot) {
        return (
            <div className="max-w-[900px] mx-auto space-y-6">
                <PageHeader title={t("title")} subtitle={t("subtitle")} icon={Link2} />
                {status === "loading" ? (
                    <p role="status" className="inline-flex items-center gap-2 text-sm text-neutral-500">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t("loading")}
                    </p>
                ) : (
                    <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                        <p>{t("unavailable")}</p>
                        <button
                            type="button"
                            onClick={() => void load()}
                            className="mt-2 rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-medium hover:bg-amber-100 dark:border-amber-500/40 dark:hover:bg-amber-500/20"
                        >
                            {t("retry")}
                        </button>
                    </div>
                )}
            </div>
        );
    }

    const problems: Record<DemoAllowanceField, DemoAllowanceFieldProblem | null> = {
        messagesPerTenant: demoAllowanceFieldProblem(draft.messagesPerTenant, snapshot.limits.messagesPerTenant),
        dailyCapPerPage: demoAllowanceFieldProblem(draft.dailyCapPerPage, snapshot.limits.dailyCapPerPage),
    };
    const invalid = Object.values(problems).some(Boolean);
    const unreadable = !canSaveDemoAllowance(snapshot);
    const changed = enabled !== snapshot.allowance.enabled
        || draft.messagesPerTenant.trim() !== String(snapshot.allowance.messagesPerTenant)
        || draft.dailyCapPerPage.trim() !== String(snapshot.allowance.dailyCapPerPage);

    async function submit() {
        if (!snapshot || invalid || !changed || unreadable) return;
        setSave({ kind: "saving" });
        try {
            const next = readDemoAllowanceSnapshot(await api.fetch(DEMO_ALLOWANCE_ENDPOINT, {
                method: "PUT",
                body: JSON.stringify({
                    enabled,
                    messagesPerTenant: Number(draft.messagesPerTenant.trim()),
                    dailyCapPerPage: Number(draft.dailyCapPerPage.trim()),
                }),
            }));
            if (!next) { setSave({ kind: "failed" }); return; }
            adopt(next);
            setSave({ kind: "saved" });
        } catch {
            setSave({ kind: "failed" });
        }
    }

    const edit = (field: DemoAllowanceField, value: string) => {
        setDraft((current) => ({ ...current, [field]: value }));
        setSave({ kind: "idle" });
    };

    const fieldCls = "w-40 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:border-neutral-700 dark:bg-neutral-900";

    const numberField = (field: DemoAllowanceField) => {
        const inputId = `${ids}-${field}`;
        const hintId = `${inputId}-hint`;
        const errorId = `${inputId}-error`;
        const problem = problems[field];
        const bounds = snapshot.limits[field];
        return (
            <div>
                <label htmlFor={inputId} className="block text-sm font-medium text-foreground">{t(`${field}.label`)}</label>
                <p id={hintId} className="mt-0.5 text-[12px] text-neutral-500 dark:text-neutral-400">
                    {t(`${field}.hint`)} {t("defaultValue", { value: snapshot.defaults[field] })}
                </p>
                <input
                    id={inputId}
                    type="number"
                    inputMode="numeric"
                    min={bounds.min}
                    max={bounds.max}
                    step={1}
                    value={draft[field]}
                    onChange={(event) => edit(field, event.target.value)}
                    disabled={unreadable}
                    aria-describedby={problem ? `${hintId} ${errorId}` : hintId}
                    aria-invalid={problem ? true : undefined}
                    className={`mt-2 ${fieldCls}`}
                />
                {problem && (
                    <p id={errorId} className="mt-1 text-[12px] text-red-600 dark:text-red-400">
                        {t(`problems.${problem}`, { min: bounds.min, max: bounds.max })}
                    </p>
                )}
            </div>
        );
    };

    return (
        <div className="max-w-[900px] mx-auto space-y-6">
            <PageHeader title={t("title")} subtitle={t("subtitle")} icon={Link2} />

            {unreadable && (
                <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    <p className="font-semibold">{t("fallback.title")}</p>
                    <p className="mt-1">{t("fallback.body")}</p>
                    <button
                        type="button"
                        onClick={() => void load()}
                        className="mt-2 rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-medium hover:bg-amber-100 dark:border-amber-500/40 dark:hover:bg-amber-500/20"
                    >
                        {t("retry")}
                    </button>
                </div>
            )}

            <form
                aria-labelledby={`${ids}-heading`}
                onSubmit={(event) => { event.preventDefault(); void submit(); }}
                className="space-y-5 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
            >
                <div>
                    <h2 id={`${ids}-heading`} className="text-sm font-semibold text-foreground">{t("heading")}</h2>
                    <p className="mt-1 text-[13px] text-neutral-600 dark:text-neutral-400">{t("scope")}</p>
                </div>

                <div className="flex items-start gap-3">
                    <input
                        id={`${ids}-enabled`}
                        type="checkbox"
                        checked={enabled}
                        disabled={unreadable}
                        onChange={(event) => { setEnabled(event.target.checked); setSave({ kind: "idle" }); }}
                        aria-describedby={`${ids}-enabled-hint`}
                        className="mt-1 h-4 w-4 rounded border-neutral-300 dark:border-neutral-600"
                    />
                    <div>
                        <label htmlFor={`${ids}-enabled`} className="text-sm font-medium text-foreground">{t("enabled.label")}</label>
                        <p id={`${ids}-enabled-hint`} className="mt-0.5 text-[12px] text-neutral-500 dark:text-neutral-400">
                            {t("enabled.hint")}
                        </p>
                    </div>
                </div>

                {numberField("messagesPerTenant")}
                {numberField("dailyCapPerPage")}

                <p className="text-[12px] text-neutral-500 dark:text-neutral-400">{t("audited")}</p>

                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="submit"
                        disabled={unreadable || invalid || !changed || save.kind === "saving"}
                        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {save.kind === "saving"
                            ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            : <Save className="h-4 w-4" aria-hidden="true" />}
                        {t("save")}
                    </button>
                    <p role="status" aria-live="polite" className="min-h-[1.25rem] text-[13px]">
                        {save.kind === "saved" && <span className="text-emerald-700 dark:text-emerald-400">{t("saved")}</span>}
                        {save.kind === "failed" && <span className="text-red-600 dark:text-red-400">{t("failed")}</span>}
                    </p>
                </div>
            </form>
        </div>
    );
}
