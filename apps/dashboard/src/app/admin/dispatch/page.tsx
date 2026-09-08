"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Loader2, PowerOff, RefreshCw, Search, Send, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ConfirmStep } from "@/components/ui/confirm-step";
import {
    DISPATCH_RESOLUTIONS,
    DISPATCH_ROLLOUT_CHANNELS,
    asQueueRow,
    dispatchAgeParts,
    dispatchErrorKind,
    dispatchResolutionBlock,
    dispatchSlaState,
    dispatchStateFromRefusal,
    isDispatchResolvable,
    isDispatchRolloutInert,
    prepareDispatchResolution,
    prepareDispatchRollout,
    settleQueueRow,
    sortDispatchQueue,
    type DispatchQueueRow,
    type DispatchReconciliationBacklog,
    type DispatchResolution,
    type DispatchRolloutState,
} from "@/lib/dispatch-operations";

/**
 * The durable dispatch, as a person can operate it.
 *
 * Rollout, kill switch and reconciliation shipped as endpoints with no screen,
 * which meant the only way to read the switch or settle an uncertain effect
 * was curl and SQL — and an effect nobody can settle is a message that either
 * reached a customer twice or never.
 *
 * Platform scope on purpose: this decides how replies leave the system for
 * everyone, so it carries no active tenant and picks one explicitly for the
 * queue. Nothing here shows message text or an unmasked recipient:
 * reconciliation asks whether an effect happened, never what it said.
 */

const CARD = "rounded-xl border border-border bg-card";
const FIELD = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground "
    + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const BUTTON = "inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm "
    + "text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 "
    + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

const EMPTY_ROLLOUT: DispatchRolloutState = {
    enabled: false, tenantIds: [], channels: [],
    migratedChannels: [], effectiveChannels: [], ignoredChannels: [],
};
const EMPTY_BACKLOG: DispatchReconciliationBacklog = { total: 0, oldestAgeSeconds: 0, breachingSla: 0 };

interface TenantOption { id: string; name: string }

export default function DispatchOperationsPage() {
    const t = useTranslations("dispatchOperations");

    const [rollout, setRollout] = useState<DispatchRolloutState>(EMPTY_ROLLOUT);
    const [rolloutLoading, setRolloutLoading] = useState(true);
    const [draftEnabled, setDraftEnabled] = useState(false);
    const [draftChannels, setDraftChannels] = useState<string[]>([]);
    const [draftTenants, setDraftTenants] = useState<string[]>([]);
    const [rolloutConfirm, setRolloutConfirm] = useState<"save" | "disable" | null>(null);
    const [rolloutBusy, setRolloutBusy] = useState(false);
    const [rolloutError, setRolloutError] = useState("");
    const [rolloutNotice, setRolloutNotice] = useState("");

    const [tenants, setTenants] = useState<TenantOption[]>([]);
    const [queueTenant, setQueueTenant] = useState("");
    const [search, setSearch] = useState("");
    const [rows, setRows] = useState<DispatchQueueRow[]>([]);
    const [backlog, setBacklog] = useState<DispatchReconciliationBacklog>(EMPTY_BACKLOG);
    const [slaSeconds, setSlaSeconds] = useState(3600);
    const [queueLoading, setQueueLoading] = useState(false);
    const [queueLoaded, setQueueLoaded] = useState(false);
    const [queueError, setQueueError] = useState("");

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [resolution, setResolution] = useState<DispatchResolution>("not_delivered");
    const [evidence, setEvidence] = useState("");
    const [receipt, setReceipt] = useState("");
    const [resolveConfirm, setResolveConfirm] = useState(false);
    const [resolveBusy, setResolveBusy] = useState(false);
    const [resolveError, setResolveError] = useState("");
    const [resolveNotice, setResolveNotice] = useState("");

    const mounted = useRef(true);
    const queueGeneration = useRef(0);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; queueGeneration.current++; }; }, []);

    const applyRollout = useCallback((state: DispatchRolloutState) => {
        setRollout(state);
        setDraftEnabled(state.enabled);
        setDraftChannels([...state.channels]);
        setDraftTenants([...state.tenantIds]);
    }, []);

    const loadRollout = useCallback(async () => {
        setRolloutLoading(true);
        setRolloutError("");
        const [state, list] = await Promise.all([api.getDispatchRollout(), api.getTenants()]);
        if (!mounted.current) return;
        if (state.success && state.data) applyRollout(state.data);
        else setRolloutError(t(`errors.${dispatchErrorKind(state)}`));
        if (list.success && Array.isArray(list.data)) {
            setTenants((list.data as any[]).map(row => ({ id: String(row.id), name: String(row.name ?? row.id) })));
        }
        setRolloutLoading(false);
    }, [applyRollout, t]);

    useEffect(() => { void loadRollout(); }, [loadRollout]);

    const loadQueue = useCallback(async (tenantId: string, term: string) => {
        if (!tenantId) return;
        const generation = ++queueGeneration.current;
        setQueueLoading(true);
        setQueueError("");
        setSelectedId(null);
        setResolveConfirm(false);
        const result = await api.getDispatchReconciliation(tenantId, { search: term.trim() || undefined, limit: 100 });
        if (!mounted.current || generation !== queueGeneration.current) return;
        if (result.success && result.data) {
            setRows(sortDispatchQueue((result.data.entries ?? []).map(asQueueRow)));
            setBacklog(result.data.backlog ?? EMPTY_BACKLOG);
            setSlaSeconds(Number(result.data.slaSeconds) || 3600);
        } else {
            setRows([]);
            setBacklog(EMPTY_BACKLOG);
            setQueueError(t(`errors.${dispatchErrorKind(result)}`));
        }
        setQueueLoaded(true);
        setQueueLoading(false);
    }, [t]);

    const rolloutDraft = useMemo(
        () => prepareDispatchRollout({ enabled: draftEnabled, tenantIds: draftTenants, channels: draftChannels }),
        [draftEnabled, draftTenants, draftChannels],
    );
    const rolloutDirty = useMemo(() => JSON.stringify(rolloutDraft.body)
        !== JSON.stringify({ enabled: rollout.enabled, tenantIds: [...rollout.tenantIds].sort(), channels: [...rollout.channels].sort() }),
    [rolloutDraft, rollout]);

    const commitRollout = async (mode: "save" | "disable") => {
        setRolloutBusy(true);
        setRolloutError("");
        setRolloutNotice("");
        const result = mode === "disable"
            ? await api.disableDispatchRollout()
            : await api.setDispatchRollout(rolloutDraft.body);
        if (!mounted.current) return;
        if (result.success && result.data) {
            applyRollout(result.data);
            setRolloutNotice(t(mode === "disable" ? "rollout.disabledNotice" : "rollout.savedNotice"));
        } else {
            setRolloutError(t(`errors.${dispatchErrorKind(result)}`));
        }
        setRolloutConfirm(null);
        setRolloutBusy(false);
    };

    const selected = rows.find(row => row.id === selectedId) ?? null;
    const block = selected
        ? dispatchResolutionBlock(selected, { resolution, evidence, receipt })
        : "settled" as const;

    const commitResolution = async () => {
        if (!selected || !queueTenant) return;
        setResolveBusy(true);
        setResolveError("");
        setResolveNotice("");
        try {
            const body = prepareDispatchResolution(selected, { resolution, evidence, receipt });
            const result = await api.resolveDispatchReconciliation(queueTenant, selected.id, body);
            if (!mounted.current) return;
            if (result.success && result.data) {
                const settled = settleQueueRow(selected, result.data);
                setRows(current => current.map(row => (row.id === settled.id ? settled : row)));
                setBacklog(current => ({
                    total: Math.max(0, current.total - 1),
                    oldestAgeSeconds: current.oldestAgeSeconds,
                    breachingSla: Math.max(0, current.breachingSla
                        - (dispatchSlaState(selected.ageSeconds, slaSeconds) === "breaching" ? 1 : 0)),
                }));
                setEvidence("");
                setReceipt("");
                setResolveNotice(t(`resolutions.${resolution}.done`));
            } else {
                // A refusal that names the real state is the truth about this
                // row: apply it so no second decision is offered on it.
                const state = dispatchStateFromRefusal(result);
                if (state) setRows(current => current.map(row => (row.id === selected.id ? { ...row, state } : row)));
                setResolveError(t(`errors.${dispatchErrorKind(result)}`));
            }
        } catch (thrown: any) {
            // The only throw here is the local verdict refusing to build a
            // request the server would reject; say which check stopped it.
            const blocked = String(thrown?.message || "").split("dispatch_resolution_blocked:")[1];
            if (mounted.current) setResolveError(blocked ? t(`blocked.${blocked}`) : t("errors.unavailable"));
        } finally {
            if (mounted.current) { setResolveConfirm(false); setResolveBusy(false); }
        }
    };

    const age = (seconds: number) => {
        const { hours, minutes } = dispatchAgeParts(seconds);
        return t("queue.age", { hours, minutes });
    };

    return (
        <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
                        <Send className="h-6 w-6 text-amber-500" aria-hidden="true" />
                        {t("title")}
                    </h1>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("subtitle")}</p>
                </div>
                <button type="button" className={BUTTON} disabled={rolloutLoading || rolloutBusy}
                    onClick={() => void loadRollout()}>
                    {rolloutLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                    {t("refresh")}
                </button>
            </header>

            <p className="rounded-xl border border-blue-500/25 bg-blue-500/5 p-4 text-sm text-blue-800 dark:text-blue-200">
                {t("scopeNote")}
            </p>

            {/* ── Rollout and kill switch ───────────────────────────── */}
            <section aria-labelledby="dispatch-rollout-heading" className={cn(CARD, "p-5")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 id="dispatch-rollout-heading" className="text-lg font-semibold text-foreground">{t("rollout.title")}</h2>
                        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("rollout.help")}</p>
                    </div>
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                        rollout.enabled
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "bg-muted text-muted-foreground")}>
                        {rollout.enabled ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            : <PowerOff className="h-3.5 w-3.5" aria-hidden="true" />}
                        {t(rollout.enabled ? "rollout.on" : "rollout.off")}
                    </span>
                </div>

                {rolloutError && <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{rolloutError}</p>}
                <p aria-live="polite" className="sr-only">{rolloutNotice}</p>
                {rolloutNotice && <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{rolloutNotice}</p>}

                {isDispatchRolloutInert(rollout) && (
                    <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        {t("rollout.inert")}
                    </p>
                )}
                {rollout.ignoredChannels.length > 0 && (
                    <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                        {t("rollout.ignored", { channels: rollout.ignoredChannels.join(", ") })}
                    </p>
                )}

                {rolloutLoading ? (
                    <p role="status" className="mt-4 text-sm text-muted-foreground">{t("loading")}</p>
                ) : (
                    <div className="mt-4 space-y-5">
                        <div className="flex items-start gap-3">
                            <input id="dispatch-enabled" type="checkbox" checked={draftEnabled}
                                onChange={event => { setDraftEnabled(event.target.checked); setRolloutConfirm(null); }}
                                className="mt-0.5 h-4 w-4 accent-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" />
                            <label htmlFor="dispatch-enabled" className="text-sm text-foreground">
                                <span className="font-medium">{t("rollout.enabledLabel")}</span>
                                <span className="block text-muted-foreground">{t("rollout.enabledHelp")}</span>
                            </label>
                        </div>

                        <fieldset>
                            <legend className="text-sm font-medium text-foreground">{t("rollout.channels")}</legend>
                            <p className="mb-2 text-sm text-muted-foreground">{t("rollout.channelsHelp")}</p>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {DISPATCH_ROLLOUT_CHANNELS.map(channel => {
                                    const migrated = rollout.migratedChannels.includes(channel);
                                    return (
                                        <div key={channel} className="flex items-start gap-2 rounded-lg border border-border p-3">
                                            <input id={`dispatch-channel-${channel}`} type="checkbox"
                                                checked={draftChannels.includes(channel)}
                                                onChange={event => {
                                                    setRolloutConfirm(null);
                                                    setDraftChannels(current => event.target.checked
                                                        ? [...new Set([...current, channel])]
                                                        : current.filter(entry => entry !== channel));
                                                }}
                                                className="mt-0.5 h-4 w-4 accent-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" />
                                            <label htmlFor={`dispatch-channel-${channel}`} className="text-sm text-foreground">
                                                <span className="font-medium">{t(`channels.${channel}`)}</span>
                                                <span className={cn("block text-xs", migrated ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400")}>
                                                    {t(migrated ? "rollout.channelMigrated" : "rollout.channelNotMigrated")}
                                                </span>
                                            </label>
                                        </div>
                                    );
                                })}
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend className="text-sm font-medium text-foreground">{t("rollout.tenants")}</legend>
                            <p className="mb-2 text-sm text-muted-foreground">{t("rollout.tenantsHelp")}</p>
                            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                                {tenants.length === 0 && draftTenants.length === 0 && (
                                    <p className="p-2 text-sm text-muted-foreground">{t("rollout.noTenants")}</p>
                                )}
                                {tenants.map(tenant => (
                                    <div key={tenant.id} className="flex items-center gap-2 rounded px-2 py-1">
                                        <input id={`dispatch-tenant-${tenant.id}`} type="checkbox"
                                            checked={draftTenants.includes(tenant.id)}
                                            onChange={event => {
                                                setRolloutConfirm(null);
                                                setDraftTenants(current => event.target.checked
                                                    ? [...new Set([...current, tenant.id])]
                                                    : current.filter(entry => entry !== tenant.id));
                                            }}
                                            className="h-4 w-4 accent-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" />
                                        <label htmlFor={`dispatch-tenant-${tenant.id}`} className="text-sm text-foreground">{tenant.name}</label>
                                    </div>
                                ))}
                                {draftTenants.filter(id => !tenants.some(tenant => tenant.id === id)).map(id => (
                                    <div key={id} className="flex items-center gap-2 rounded px-2 py-1">
                                        <input id={`dispatch-tenant-${id}`} type="checkbox" checked
                                            onChange={() => { setRolloutConfirm(null); setDraftTenants(current => current.filter(entry => entry !== id)); }}
                                            className="h-4 w-4 accent-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" />
                                        <label htmlFor={`dispatch-tenant-${id}`} className="text-sm text-amber-700 dark:text-amber-300">
                                            {t("rollout.unknownTenant", { id })}
                                        </label>
                                    </div>
                                ))}
                            </div>
                        </fieldset>

                        {rolloutDraft.invalidChannels.length > 0 && (
                            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                                {t("rollout.invalidChannels", { channels: rolloutDraft.invalidChannels.join(", ") })}
                            </p>
                        )}
                        {rolloutDraft.invalidTenantIds.length > 0 && (
                            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                                {t("rollout.invalidTenants", { ids: rolloutDraft.invalidTenantIds.join(", ") })}
                            </p>
                        )}

                        <div className="flex flex-wrap gap-2">
                            <button type="button" className={cn(BUTTON, "border-indigo-500 text-indigo-600 dark:text-indigo-300")}
                                disabled={rolloutBusy || !rolloutDirty || rolloutDraft.invalidChannels.length > 0 || rolloutDraft.invalidTenantIds.length > 0}
                                onClick={() => { setRolloutConfirm("save"); setRolloutNotice(""); }}>
                                {t("rollout.save")}
                            </button>
                            <button type="button"
                                className={cn(BUTTON, "border-red-500/60 text-red-600 dark:text-red-400")}
                                disabled={rolloutBusy}
                                onClick={() => { setRolloutConfirm("disable"); setRolloutNotice(""); }}>
                                <ShieldAlert className="h-4 w-4" aria-hidden="true" />{t("rollout.killSwitch")}
                            </button>
                        </div>

                        {rolloutConfirm && (
                            <ConfirmStep
                                title={t(rolloutConfirm === "disable" ? "rollout.confirmDisableTitle" : "rollout.confirmSaveTitle")}
                                consequence={rolloutConfirm === "disable"
                                    ? t("rollout.confirmDisableBody")
                                    : t("rollout.confirmSaveBody", {
                                        channels: rolloutDraft.body.channels
                                            .filter(channel => rollout.migratedChannels.includes(channel))
                                            .join(", ") || t("rollout.none"),
                                        tenants: rolloutDraft.body.tenantIds.length
                                            ? t("rollout.someTenants", { count: rolloutDraft.body.tenantIds.length })
                                            : t("rollout.allTenants"),
                                    })}
                                confirmLabel={t(rolloutConfirm === "disable" ? "rollout.confirmDisable" : "rollout.confirmSave")}
                                cancelLabel={t("cancel")}
                                tone={rolloutConfirm === "disable" ? "danger" : "caution"}
                                busy={rolloutBusy}
                                onConfirm={() => void commitRollout(rolloutConfirm)}
                                onCancel={() => setRolloutConfirm(null)}
                            />
                        )}
                    </div>
                )}
            </section>

            {/* ── Reconciliation queue ──────────────────────────────── */}
            <section aria-labelledby="dispatch-queue-heading" className={cn(CARD, "p-5")}>
                <h2 id="dispatch-queue-heading" className="text-lg font-semibold text-foreground">{t("queue.title")}</h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("queue.help")}</p>

                <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                    <div>
                        <label htmlFor="dispatch-queue-tenant" className="mb-1 block text-xs font-semibold text-muted-foreground">
                            {t("queue.tenant")}
                        </label>
                        <select id="dispatch-queue-tenant" className={FIELD} value={queueTenant}
                            onChange={event => { setQueueTenant(event.target.value); setRows([]); setQueueLoaded(false); setBacklog(EMPTY_BACKLOG); }}>
                            <option value="">{t("queue.selectTenant")}</option>
                            {tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="dispatch-queue-search" className="mb-1 block text-xs font-semibold text-muted-foreground">
                            {t("queue.search")}
                        </label>
                        <input id="dispatch-queue-search" className={FIELD} value={search} placeholder={t("queue.searchPlaceholder")}
                            aria-describedby="dispatch-queue-search-help"
                            onChange={event => setSearch(event.target.value)}
                            onKeyDown={event => { if (event.key === "Enter") void loadQueue(queueTenant, search); }} />
                        <p id="dispatch-queue-search-help" className="mt-1 text-xs text-muted-foreground">{t("queue.searchHelp")}</p>
                    </div>
                    <button type="button" className={BUTTON} disabled={!queueTenant || queueLoading}
                        onClick={() => void loadQueue(queueTenant, search)}>
                        {queueLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            : <Search className="h-4 w-4" aria-hidden="true" />}
                        {t("queue.load")}
                    </button>
                </div>

                {queueError && <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{queueError}</p>}

                {queueLoaded && !queueError && (
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <article className={cn(CARD, "p-4")}>
                            <p className="text-xs text-muted-foreground">{t("queue.backlogTotal")}</p>
                            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{backlog.total}</p>
                        </article>
                        <article className={cn(CARD, "p-4")}>
                            <p className="text-xs text-muted-foreground">{t("queue.backlogOldest")}</p>
                            <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{age(backlog.oldestAgeSeconds)}</p>
                        </article>
                        <article className={cn(CARD, "p-4", backlog.breachingSla > 0 && "border-red-500/50 bg-red-500/5")}>
                            <p className="text-xs text-muted-foreground">{t("queue.backlogBreaching", { hours: Math.round(slaSeconds / 3600) })}</p>
                            <p className={cn("mt-1 text-2xl font-semibold tabular-nums",
                                backlog.breachingSla > 0 ? "text-red-600 dark:text-red-400" : "text-foreground")}>
                                {backlog.breachingSla}
                            </p>
                        </article>
                    </div>
                )}

                {queueLoading && <p role="status" className="mt-4 text-sm text-muted-foreground">{t("loading")}</p>}

                {queueLoaded && !queueLoading && !queueError && rows.length === 0 && (
                    <p className="mt-4 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                        {t("queue.empty")}
                    </p>
                )}

                {rows.length > 0 && (
                    <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <caption className="sr-only">{t("queue.tableCaption")}</caption>
                                <thead>
                                    <tr className="border-b border-border text-left">
                                        <th scope="col" className="py-2 pr-3 font-medium text-muted-foreground">{t("queue.colAge")}</th>
                                        <th scope="col" className="py-2 pr-3 font-medium text-muted-foreground">{t("queue.colBinding")}</th>
                                        <th scope="col" className="py-2 pr-3 font-medium text-muted-foreground">{t("queue.colItem")}</th>
                                        <th scope="col" className="py-2 pr-3 font-medium text-muted-foreground">{t("queue.colAttempts")}</th>
                                        <th scope="col" className="py-2 font-medium text-muted-foreground">{t("queue.colState")}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(row => {
                                        const sla = dispatchSlaState(row.ageSeconds, slaSeconds);
                                        const active = row.id === selectedId;
                                        return (
                                            <tr key={row.id} className={cn("border-b border-border/60", active && "bg-muted")}>
                                                <td className="py-2 pr-3">
                                                    <button type="button" aria-pressed={active}
                                                        className={cn("rounded px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                                                            sla === "breaching" ? "font-semibold text-red-600 dark:text-red-400"
                                                                : sla === "nearing" ? "font-medium text-amber-600 dark:text-amber-400"
                                                                    : "text-foreground")}
                                                        onClick={() => {
                                                            setSelectedId(row.id); setResolveConfirm(false);
                                                            setResolveError(""); setResolveNotice("");
                                                            setEvidence(""); setReceipt(""); setResolution("not_delivered");
                                                        }}>
                                                        {sla === "breaching" && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />}
                                                        {age(row.ageSeconds)}
                                                        <span className="sr-only"> · {t(`queue.sla.${sla}`)}</span>
                                                    </button>
                                                </td>
                                                <td className="py-2 pr-3 text-muted-foreground">
                                                    {t.has(`channels.${row.channelType}`) ? t(`channels.${row.channelType}`) : row.channelType}
                                                    <span className="block text-xs">{row.recipientHint ?? t("queue.noRecipient")}</span>
                                                </td>
                                                <td className="py-2 pr-3 text-muted-foreground">
                                                    {t(`itemKinds.${row.itemKind}`)} · #{row.itemIndex}
                                                </td>
                                                <td className="py-2 pr-3 tabular-nums text-muted-foreground">{row.attempts}</td>
                                                <td className="py-2">
                                                    <span className={cn("rounded-full px-2 py-0.5 text-xs",
                                                        isDispatchResolvable(row)
                                                            ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                                            : "bg-muted text-muted-foreground")}>
                                                        {t(`states.${row.state}`)}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className={cn(CARD, "h-fit p-4")}>
                            {!selected ? (
                                <p className="text-sm text-muted-foreground">{t("detail.selectRow")}</p>
                            ) : (
                                <>
                                    <h3 className="text-sm font-semibold text-foreground">{t("detail.title")}</h3>
                                    <dl className="mt-3 space-y-2 text-sm">
                                        {([
                                            ["detail.reference", selected.id],
                                            ["detail.conversation", selected.conversationId ?? t("detail.none")],
                                            ["detail.inbound", selected.inboundMessageId],
                                            ["detail.account", selected.channelAccountId],
                                            ["detail.recipient", selected.recipientHint ?? t("queue.noRecipient")],
                                            ["detail.receipt", selected.receipt ?? t("detail.none")],
                                            ["detail.errorCode", selected.errorCode ?? t("detail.none")],
                                            ["detail.lease", selected.settledLeaseToken ?? t("detail.none")],
                                        ] as const).map(([key, value]) => (
                                            <div key={key} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2">
                                                <dt className="text-muted-foreground">{t(key)}</dt>
                                                <dd className="break-all text-foreground">{value}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                    {selected.redacted && (
                                        <p className="mt-3 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
                                            {t("detail.redacted")}
                                        </p>
                                    )}

                                    {resolveError && <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{resolveError}</p>}
                                    <p aria-live="polite" className="sr-only">{resolveNotice}</p>
                                    {resolveNotice && <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{resolveNotice}</p>}

                                    {!isDispatchResolvable(selected) ? (
                                        <p className="mt-4 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
                                            {t("detail.alreadySettled", { state: t(`states.${selected.state}`) })}
                                        </p>
                                    ) : (
                                        <div className="mt-4 space-y-4">
                                            <fieldset>
                                                <legend className="text-sm font-medium text-foreground">{t("detail.decision")}</legend>
                                                <div className="mt-2 space-y-2">
                                                    {DISPATCH_RESOLUTIONS.map(option => (
                                                        <div key={option} className="flex items-start gap-2">
                                                            <input id={`dispatch-resolution-${option}`} type="radio" name="dispatch-resolution"
                                                                value={option} checked={resolution === option}
                                                                onChange={() => { setResolution(option); setResolveConfirm(false); setResolveError(""); }}
                                                                className="mt-1 h-4 w-4 accent-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" />
                                                            <label htmlFor={`dispatch-resolution-${option}`} className="text-sm text-foreground">
                                                                <span className="font-medium">{t(`resolutions.${option}.label`)}</span>
                                                                <span className="block text-muted-foreground">{t(`resolutions.${option}.help`)}</span>
                                                            </label>
                                                        </div>
                                                    ))}
                                                </div>
                                            </fieldset>

                                            <div>
                                                <label htmlFor="dispatch-evidence" className="mb-1 block text-sm font-medium text-foreground">
                                                    {t("detail.evidence")}
                                                </label>
                                                <textarea id="dispatch-evidence" rows={3} maxLength={500} value={evidence}
                                                    aria-describedby="dispatch-evidence-help" required
                                                    onChange={event => { setEvidence(event.target.value); setResolveConfirm(false); }}
                                                    className={FIELD} />
                                                <p id="dispatch-evidence-help" className="mt-1 text-xs text-muted-foreground">{t("detail.evidenceHelp")}</p>
                                            </div>

                                            {resolution === "delivered" && (
                                                <div>
                                                    <label htmlFor="dispatch-receipt" className="mb-1 block text-sm font-medium text-foreground">
                                                        {t("detail.receiptInput")}
                                                    </label>
                                                    <input id="dispatch-receipt" value={receipt} maxLength={300} required
                                                        aria-describedby="dispatch-receipt-help"
                                                        onChange={event => { setReceipt(event.target.value); setResolveConfirm(false); }}
                                                        className={FIELD} />
                                                    <p id="dispatch-receipt-help" className="mt-1 text-xs text-muted-foreground">{t("detail.receiptHelp")}</p>
                                                </div>
                                            )}

                                            {block && block !== "settled" && (
                                                <p className="text-sm text-amber-700 dark:text-amber-300">{t(`blocked.${block}`)}</p>
                                            )}

                                            <button type="button" className={cn(BUTTON, "border-indigo-500 text-indigo-600 dark:text-indigo-300")}
                                                disabled={Boolean(block) || resolveBusy}
                                                onClick={() => { setResolveConfirm(true); setResolveNotice(""); }}>
                                                {t("detail.review")}
                                            </button>

                                            {resolveConfirm && !block && (
                                                <ConfirmStep
                                                    title={t(`resolutions.${resolution}.confirmTitle`)}
                                                    consequence={t(`resolutions.${resolution}.confirmBody`)}
                                                    confirmLabel={t(`resolutions.${resolution}.confirm`)}
                                                    tone={resolution === "retry" ? "danger" : "caution"}
                                                    cancelLabel={t("cancel")}
                                                    busy={resolveBusy}
                                                    onConfirm={() => void commitResolution()}
                                                    onCancel={() => setResolveConfirm(false)}
                                                />
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
