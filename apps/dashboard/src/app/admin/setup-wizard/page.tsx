"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
    ChevronRight, ChevronLeft, Check, Sparkles, Loader2,
    Plug, PartyPopper, LogOut, ArrowRight, Clock, Compass, AlertTriangle,
} from "lucide-react";
import {
    GUIDED_TOUR_START_EVENT,
    type GuidedTourStartDetail,
} from "@parallext/shared";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { guidedTourAnchorId } from "@/lib/guided-tours";
import { readSetupStatusFacts, type SetupStatusDefaultAgent } from "@/lib/onboarding-guide";
import AnimatedLogo from "@/components/AnimatedLogo";
import { HelpPanel } from "@/components/ui/help-panel";
import WhatsAppConnectPanel from "../channels/whatsapp/WhatsAppConnectPanel";
import SecondaryChannels from "./_components/SecondaryChannels";
import AgentTestChat from "./_components/AgentTestChat";
import {
    PRODUCT_TOUR_PENDING_KEY,
    SETUP_COPILOT_PENDING_KEY,
} from "@/lib/product-tour-contract";

/**
 * "Conocé a tu agente" — three steps, on a page.
 *
 * What this replaced: a five-step modal that could not be closed (Escape and
 * click-outside were both suppressed), whose first step asked the owner to pick
 * a template the signup had ALREADY picked from their industry and goals, and
 * whose channel step auto-advanced 1.4 s after connecting — before the person
 * could send themselves the message that proves it works.
 *
 * The three steps left are the three things that actually have to happen:
 * confirm the agent we prepared, connect WhatsApp, and know what comes next.
 * Leaving is allowed at every point and loses nothing: the agent autosaves on
 * blur, and "Conectar después" is recorded so Home can offer it again.
 */

const DRAFT_KEY_PREFIX = "parallly:setupwizard";

type StepIndex = 0 | 1 | 2;
type WizardStage = "agent_reviewed" | "channel_deferred" | "completed";

const STEPS = [
    { key: "agent", icon: Sparkles },
    { key: "connect", icon: Plug },
    { key: "done", icon: PartyPopper },
] as const;

const LAST_STEP: StepIndex = 2;

/**
 * El cuerpo REAL del endpoint del asistente.
 *
 * `api.applySetupTemplate` quedó tipado para el único camino que existía
 * —"aplicá esta plantilla"—, y ese camino reconstruía el agente desde la
 * plantilla en CADA guardado: entrar al asistente y salir borraba las reglas,
 * los traspasos, los temas prohibidos y los horarios que el dueño había
 * ajustado. Hoy el endpoint acepta además `stageOnly` (avanzar la puesta en
 * marcha sin tocar al agente) y deja `templateId` opcional, porque un tenant
 * que ya tiene su agente no necesita ninguna plantilla para cambiarle el
 * nombre.
 */
type WizardSavePayload = {
    templateId?: string;
    customizations?: Record<string, unknown>;
    markCompleted?: boolean;
    stage?: WizardStage;
    channelConnectSkippedAt?: string;
    stageOnly?: boolean;
};

const saveWizard = api.applySetupTemplate as unknown as (
    tenantId: string,
    payload: WizardSavePayload,
) => Promise<{ success?: boolean; error?: string } | undefined>;

/** Etiqueta i18n por tipo de canal conectado. */
const CHANNEL_LABEL_KEY: Record<string, string> = {
    whatsapp: "connect.whatsappBrandTitle",
    instagram: "connect.channel_instagram",
    messenger: "connect.channel_messenger",
    telegram: "connect.channel_telegram",
    email: "connect.channel_email",
    web_widget: "connect.channel_webchat",
    webchat: "connect.channel_webchat",
};

/**
 * Nunca mostrar un marcador sin sustituir.
 *
 * Los saludos de plantilla traen `{company}` y `{agentName}`; la sustitución
 * ocurre en el servidor al guardar. Mostrar el texto crudo le enseñaba al dueño
 * un saludo con llaves que él no escribió y que su cliente tampoco va a leer.
 * Si no se puede completar de verdad, se muestra vacío.
 */
function fillTemplateText(raw: string, company: string, agentName: string): string {
    if (!raw) return "";
    if (raw.includes("{company}") && !company.trim()) return "";
    if (raw.includes("{agentName}") && !agentName.trim()) return "";
    const filled = raw.replace(/\{company\}/g, company).replace(/\{agentName\}/g, agentName);
    // Cualquier otro marcador que no sepamos completar: mejor vacío que crudo.
    return /\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(filled) ? "" : filled;
}

export default function SetupWizardPage() {
    const t = useTranslations("setupWizard");
    const tHelp = useTranslations("help");
    const tCommon = useTranslations("common");
    const { user } = useAuth();
    const router = useRouter();
    const tenantId = user?.tenantId;
    const companyName = user?.tenantName || "";

    const [step, setStep] = useState<StepIndex>(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savedAt, setSavedAt] = useState<number | null>(null);
    /** Un guardado que falla se DICE. Antes devolvía false y nadie lo miraba. */
    const [error, setError] = useState<string | null>(null);

    const [templateId, setTemplateId] = useState<string | null>(null);
    const [agentName, setAgentName] = useState("");
    const [greeting, setGreeting] = useState("");
    const [preparedName, setPreparedName] = useState("");
    const [channelConnected, setChannelConnected] = useState(false);
    /** Tipos de canal ya conectados SEGÚN EL SERVIDOR (no según esta sesión). */
    const [connectedTypes, setConnectedTypes] = useState<string[]>([]);
    const [deferred, setDeferred] = useState(false);

    // El agente ya persiste solo; el borrador local guarda el paso Y lo tipeado,
    // para que un refresh antes de que el campo pierda el foco no se lleve el
    // nombre y el saludo recién escritos.
    const draftKey = tenantId ? `${DRAFT_KEY_PREFIX}:${tenantId}` : null;
    const dirtyRef = useRef(false);
    const savingRef = useRef(false);

    /**
     * WhatsApp ya estaba conectado ANTES de entrar acá. Deliberadamente no se
     * toca cuando la conexión ocurre en esta sesión: ahí manda el panel, que
     * muestra el número y el "probalo" que siguen a un alta recién hecha.
     */
    const whatsappAlreadyConnected = connectedTypes.includes("whatsapp");
    const connectedLabels = connectedTypes
        .map((type) => (CHANNEL_LABEL_KEY[type] ? t(CHANNEL_LABEL_KEY[type]) : null))
        .filter((label): label is string => Boolean(label));

    useEffect(() => {
        if (!tenantId) return;
        let cancelled = false;

        Promise.all([
            api.getSetupStatus(tenantId).catch(() => null),
            api.getPersonaTemplates(tenantId).catch(() => null),
        ]).then(([statusRes, templatesRes]) => {
            if (cancelled) return;
            const facts = readSetupStatusFacts(statusRes);
            const templates: any[] = (templatesRes as any)?.success ? ((templatesRes as any).data || []) : [];

            // La UNICA plantilla que se usa es la que el tenant realmente tiene.
            // Cuando el estado no se pudo leer, o cuando ya hay un agente sin
            // plantilla registrada, no se elige ninguna: `templates[0]` es una
            // plantilla que nadie eligió, y el guardado la habría aplicado
            // encima de la configuración viva del negocio.
            const ownTemplateId: string | null = facts?.defaultAgentTemplateId ?? null;
            const fallbackTemplateId = facts && !facts.hasAgent
                ? (templates.find((tmpl) => !tmpl.nameKey)?.id ?? templates[0]?.id ?? null)
                : null;
            setTemplateId(ownTemplateId ?? fallbackTemplateId);

            const agent: SetupStatusDefaultAgent | null = facts?.defaultAgent ?? null;
            const templateConfig = ownTemplateId
                ? (templates.find((tmpl) => tmpl.id === ownTemplateId)?.config
                    ?? templates.find((tmpl) => tmpl.id === ownTemplateId)?.config_json)
                : null;

            const name = agent?.name
                || (typeof templateConfig?.persona?.name === "string" ? templateConfig.persona.name : "");
            // El saludo del agente ya viene sustituido; el de la plantilla, no.
            const hello = agent?.greeting
                || fillTemplateText(
                    typeof templateConfig?.persona?.greeting === "string" ? templateConfig.persona.greeting : "",
                    companyName,
                    name,
                );
            setPreparedName(name);
            setAgentName(name);
            setGreeting(hello);

            if (facts?.hasAnyChannel) setChannelConnected(true);
            setConnectedTypes(facts?.connectedChannelTypes ?? []);
            if (facts?.channelConnectSkippedAt) setDeferred(true);

            // El borrador devuelve el paso Y lo que se estaba escribiendo. Solo
            // pisa al servidor cuando difiere: si lo hace, queda marcado como
            // sucio para que el próximo guardado lo persista.
            try {
                const raw = draftKey ? localStorage.getItem(draftKey) : null;
                const draft = raw ? JSON.parse(raw) : null;
                if (draft && typeof draft.step === "number") {
                    setStep(Math.min(LAST_STEP, Math.max(0, draft.step)) as StepIndex);
                }
                if (typeof draft?.agentName === "string" && draft.agentName.trim() && draft.agentName !== name) {
                    setAgentName(draft.agentName);
                    dirtyRef.current = true;
                }
                if (typeof draft?.greeting === "string" && draft.greeting.trim() && draft.greeting !== hello) {
                    setGreeting(draft.greeting);
                    dirtyRef.current = true;
                }
            } catch { /* borrador corrupto → empezar en el paso 1 */ }

            setLoading(false);
        }).catch(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [companyName, draftKey, tenantId]);

    useEffect(() => {
        if (!draftKey || loading) return;
        try {
            localStorage.setItem(draftKey, JSON.stringify({ step, agentName, greeting }));
        } catch { /* noop */ }
    }, [agentName, draftKey, greeting, loading, step]);

    interface WizardProgress {
        markCompleted?: boolean;
        stage?: WizardStage;
        channelConnectSkippedAt?: string;
    }

    /**
     * El único punto de escritura del asistente. Devuelve si REALMENTE se
     * guardó y deja el motivo en pantalla cuando no: `apiPost` convierte un 403
     * en `{success:false}` con HTTP 200, así que un fallo silencioso se veía
     * exactamente igual que un guardado exitoso — el asistente no guardaba
     * nada, la etapa no avanzaba y el panel rebotaba de vuelta para siempre.
     */
    const postWizard = useCallback(async (payload: WizardSavePayload): Promise<boolean> => {
        if (!tenantId) return false;
        try {
            const result = await saveWizard(tenantId, payload);
            if (result?.success === true) {
                setError(null);
                return true;
            }
            const message = typeof result?.error === "string" && result.error.trim()
                ? result.error.trim()
                : tCommon("errorSaving");
            console.warn("[setup-wizard] guardado rechazado:", message);
            setError(message);
            return false;
        } catch (err) {
            console.warn("[setup-wizard] no se pudo guardar:", err);
            setError(tCommon("errorSaving"));
            return false;
        }
    }, [tCommon, tenantId]);

    /**
     * Avanzar la puesta en marcha SIN tocar al agente.
     *
     * Es el camino de salir, de "conectar después" y de cerrar sin cambios.
     * Antes los tres mandaban la plantilla: el servidor reconstruía la
     * configuración desde cero y la escribía sobre el agente vivo, así que
     * abrir el asistente y apretar Escape le borraba al dueño sus reglas de
     * comportamiento, sus disparadores de traspaso, sus temas prohibidos, su
     * RAG, su mensaje de respaldo y sus horarios. Sin decírselo.
     */
    const advanceStage = useCallback((options: WizardProgress = {}) => postWizard({
        stageOnly: true,
        stage: options.stage,
        markCompleted: options.markCompleted === true,
        channelConnectSkippedAt: options.channelConnectSkippedAt,
    }), [postWizard]);

    /** Guarda lo que la persona escribió. Solo se llama si hubo edición real. */
    const saveAgentEdits = useCallback((options: WizardProgress = {}) => postWizard({
        // Sin plantilla propia no se manda ninguna: el servidor personaliza
        // sobre la configuración que el agente ya tiene.
        ...(templateId ? { templateId } : {}),
        customizations: {
            agentName: agentName.trim(),
            greeting: greeting.trim(),
            ...(options.channelConnectSkippedAt
                ? { channelConnectSkippedAt: options.channelConnectSkippedAt }
                : {}),
        },
        markCompleted: options.markCompleted === true,
        stage: options.stage,
        channelConnectSkippedAt: options.channelConnectSkippedAt,
    }), [agentName, greeting, postWizard, templateId]);

    /** Guarda si hay algo que guardar; si no, solo avanza la etapa. */
    const saveOrAdvance = useCallback(async (options: WizardProgress = {}): Promise<boolean> => {
        const dirty = dirtyRef.current;
        const ok = dirty ? await saveAgentEdits(options) : await advanceStage(options);
        // Sucio hasta que se confirme el guardado: un fallo no puede hacer
        // desaparecer lo tipeado del próximo intento.
        if (ok && dirty) dirtyRef.current = false;
        return ok;
    }, [advanceStage, saveAgentEdits]);

    const autosave = useCallback(async (): Promise<boolean> => {
        if (!dirtyRef.current) return true;
        setSaving(true);
        savingRef.current = true;
        const ok = await saveAgentEdits({ stage: "agent_reviewed" });
        savingRef.current = false;
        setSaving(false);
        if (ok) {
            dirtyRef.current = false;
            setSavedAt(Date.now());
        }
        return ok;
    }, [saveAgentEdits]);

    /**
     * Salir no es destructivo: lo tipeado se guarda, y lo que no se tocó no se
     * toca.
     *
     * Si falla el guardado de lo TIPEADO nos quedamos: irse escondiendo el
     * error es cómo se llegó a un asistente donde nada se guardaba y nadie se
     * enteraba. Pero si sólo falla el avance del estado —cuando no hay nada que
     * perder— igual se sale: un agente heredado sin reglas hacía fallar esa
     * escritura y dejaba "Salir" muerto, encerrando a la persona en la pantalla
     * de bienvenida. Inicio vuelve a derivar el estado del setup-status, así
     * que perder esa escritura no rompe nada.
     */
    const exit = useCallback(async () => {
        if (tenantId) {
            if (dirtyRef.current) {
                const saved = await autosave();
                if (!saved) return;
            } else {
                await advanceStage({ stage: "agent_reviewed" });
            }
        }
        router.push("/admin");
    }, [advanceStage, autosave, router, tenantId]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            // Escape no puede ser una salida accidental: ni escribiendo en un
            // campo, ni con un guardado en vuelo, ni en el paso de conexión
            // (donde irse deja el alta de WhatsApp a mitad de camino). Para
            // salir está el botón "Salir", que además se ve.
            const target = event.target as HTMLElement | null;
            const tag = target?.tagName?.toLowerCase();
            if (tag === "input" || tag === "textarea" || tag === "select") return;
            if (target?.isContentEditable) return;
            if (savingRef.current) return;
            if (step === 1 && !whatsappAlreadyConnected) return;
            void exit();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [exit, step, whatsappAlreadyConnected]);

    const connectLater = useCallback(async () => {
        const ok = await saveOrAdvance({
            stage: "channel_deferred",
            channelConnectSkippedAt: new Date().toISOString(),
        });
        if (!ok) return;
        setDeferred(true);
        setStep(LAST_STEP);
    }, [saveOrAdvance]);

    const finish = useCallback(async (options: { openTour?: boolean } = {}) => {
        setSaving(true);
        savingRef.current = true;
        const ok = await saveOrAdvance({ markCompleted: true, stage: "completed" });
        savingRef.current = false;
        setSaving(false);
        if (!ok) return;
        try { if (draftKey) localStorage.removeItem(draftKey); } catch { /* noop */ }
        try {
            const openCopilot = localStorage.getItem(SETUP_COPILOT_PENDING_KEY) === "1";
            localStorage.removeItem(SETUP_COPILOT_PENDING_KEY);
            if (openCopilot) localStorage.setItem("parallly:openCopilot", "1");
            // El recorrido del panel se OFRECE, y sólo tiene sentido con un canal
            // conectado: sin él, la primera pantalla que el tour explica está vacía.
            else if (options.openTour && channelConnected) localStorage.setItem(PRODUCT_TOUR_PENDING_KEY, "true");
        } catch { /* mejoras opcionales no bloquean el cierre */ }
        window.location.href = "/admin";
    }, [channelConnected, draftKey, saveOrAdvance]);

    const showConnectTour = () => {
        const detail: GuidedTourStartDetail = { tourId: "first_channel_whatsapp" };
        window.dispatchEvent(new CustomEvent(GUIDED_TOUR_START_EVENT, { detail }));
    };

    if (loading) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center">
                <Loader2 size={24} className="animate-spin text-indigo-500" />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-4xl pb-10">
            {/* Header */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <AnimatedLogo height={28} animate={false} showPoweredBy={false} />
                    <div>
                        <h1 className="text-lg font-semibold text-foreground">{t("pageTitle")}</h1>
                        <p className="text-[12px] text-muted-foreground">{t("pageSubtitle")}</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => void exit()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground dark:border-white/10 cursor-pointer"
                    title={t("exitHint")}
                >
                    <LogOut size={14} /> {t("exit")}
                </button>
            </div>

            <HelpPanel
                title={tHelp("setupWizard.title")}
                description={tHelp("setupWizard.description")}
                tips={tHelp.raw("setupWizard.tips") as string[]}
            />

            {/* Un guardado rechazado se ve. Antes se perdía en la consola. */}
            {error && (
                <div
                    role="alert"
                    className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-50 p-3 text-[13px] text-red-700 dark:bg-red-500/10 dark:text-red-300"
                >
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* Progress */}
            <div id={guidedTourAnchorId("setup-steps")} className="mb-6">
                <div className="mb-2 flex items-center gap-2">
                    {STEPS.map((s, i) => (
                        <div key={s.key} className="flex flex-1 items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setStep(i as StepIndex)}
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors cursor-pointer ${
                                    i < step ? "bg-emerald-500 text-white"
                                        : i === step ? "bg-indigo-500 text-white"
                                            : "bg-neutral-200 text-muted-foreground dark:bg-white/10"
                                }`}
                                aria-current={i === step ? "step" : undefined}
                            >
                                {i < step ? <Check size={14} /> : i + 1}
                            </button>
                            <span className={`hidden text-[12px] sm:block ${i === step ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                                {t(`steps.${s.key}`)}
                            </span>
                            {i < STEPS.length - 1 && <div className={`h-px flex-1 ${i < step ? "bg-emerald-500" : "bg-neutral-200 dark:bg-white/10"}`} />}
                        </div>
                    ))}
                </div>
                <p className="text-[12px] text-muted-foreground">
                    {t("navigation.stepOf", { current: step + 1, total: STEPS.length })}
                </p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-6 dark:border-white/[0.08] dark:bg-white/[0.04]">
                {/* ── Paso 1: Tu agente ── */}
                {step === 0 && (
                    <div>
                        <h2 className="mb-1 text-xl font-semibold text-foreground">{t("agentStep.title")}</h2>
                        <p className="mb-6 text-sm text-muted-foreground">
                            {preparedName
                                ? t("agentStep.prepared", { name: preparedName })
                                : t("agentStep.subtitle")}
                        </p>

                        <div className="grid gap-6 lg:grid-cols-2">
                            <div className="space-y-5">
                                <div>
                                    <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground" htmlFor="setup-agent-name">
                                        {t("customize.agentName")}
                                    </label>
                                    <input
                                        id="setup-agent-name"
                                        type="text"
                                        value={agentName}
                                        onChange={(e) => { dirtyRef.current = true; setAgentName(e.target.value); }}
                                        onBlur={() => void autosave()}
                                        className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-indigo-500 dark:border-white/10 dark:bg-white/5"
                                    />
                                    <p className="mt-1.5 text-[11px] text-muted-foreground">{t("customize.agentNameHint")}</p>
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground" htmlFor="setup-agent-greeting">
                                        {t("customize.greeting")}
                                    </label>
                                    <textarea
                                        id="setup-agent-greeting"
                                        value={greeting}
                                        rows={3}
                                        onChange={(e) => { dirtyRef.current = true; setGreeting(e.target.value); }}
                                        onBlur={() => void autosave()}
                                        className="w-full resize-none rounded-xl border border-neutral-300 bg-neutral-50 px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-indigo-500 dark:border-white/10 dark:bg-white/5"
                                    />
                                </div>

                                <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
                                    {saving
                                        ? <span className="inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> {t("agentStep.saving")}</span>
                                        : savedAt
                                            ? <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"><Check size={12} /> {t("agentStep.saved")}</span>
                                            : <span>{t("agentStep.autosaveHint")}</span>}
                                </div>

                                {/* La grilla de plantillas se mudó al editor: acá sólo se
                                    confirma lo que el alta ya dedujo del rubro. */}
                                <Link
                                    href="/admin/agent"
                                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                                >
                                    {t("agentStep.changeTemplate")} <ArrowRight size={13} />
                                </Link>
                            </div>

                            {tenantId && (
                                <div>
                                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        {t("test.title")}
                                    </p>
                                    <AgentTestChat tenantId={tenantId} />
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Paso 2: Conectá WhatsApp ── */}
                {step === 1 && tenantId && (
                    <div id={guidedTourAnchorId("setup-connect")} className="mx-auto max-w-lg">
                        <h2 className="mb-1 text-xl font-semibold text-foreground">{t("connectStep.title")}</h2>
                        <p className="mb-5 text-sm text-muted-foreground">{t("connectStep.subtitle")}</p>

                        {/* Ya conectado: se muestra el estado REAL en vez de
                            ofrecer conectarlo otra vez. El panel solo conocía
                            las conexiones hechas en esta misma sesión, así que
                            a un admin con WhatsApp en vivo le ofrecía el
                            selector de ruta — y desde ahí podía lanzar un
                            segundo Embedded Signup sobre su número real. */}
                        {whatsappAlreadyConnected ? (
                            <div className="rounded-xl border border-emerald-500/30 bg-emerald-50 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                                    <Check size={16} /> {t("connect.connected")}
                                </p>
                                {connectedLabels.length > 0 && (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {connectedLabels.map((label) => (
                                            <span
                                                key={label}
                                                className="rounded-full border border-emerald-500/30 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:text-emerald-300"
                                            >
                                                {label}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setStep(LAST_STEP)}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-indigo-700 cursor-pointer"
                                    >
                                        {t("connect.continue")} <ChevronRight size={14} />
                                    </button>
                                    <Link
                                        href="/admin/channels"
                                        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                                    >
                                        {t("connect.otherChannels")} <ArrowRight size={13} />
                                    </Link>
                                </div>
                            </div>
                        ) : (
                            <>
                                <WhatsAppConnectPanel
                                    tenantId={tenantId}
                                    variant="onboarding"
                                    onConnected={() => setChannelConnected(true)}
                                    onAcknowledged={() => setStep(LAST_STEP)}
                                />

                                {!channelConnected && (
                                    <>
                                        <div className="mt-7">
                                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                {t("connect.otherChannels")}
                                            </p>
                                            <SecondaryChannels tenantId={tenantId} onConnected={() => setChannelConnected(true)} />
                                        </div>

                                        <div className="mt-7 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                                            <p className="text-[13px] font-medium text-foreground">{t("connectStep.laterTitle")}</p>
                                            <p className="mt-0.5 text-[12px] text-muted-foreground">{t("connectStep.laterHint")}</p>
                                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => void connectLater()}
                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/5 cursor-pointer"
                                                >
                                                    <Clock size={13} /> {t("connect.connectLater")}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={showConnectTour}
                                                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10 cursor-pointer"
                                                >
                                                    <Compass size={13} /> {t("connectStep.showMe")}
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* ── Paso 3: Listo ── */}
                {step === 2 && (
                    <div className="mx-auto max-w-xl">
                        <h2 className="mb-1 text-xl font-semibold text-foreground">{t("doneStep.title")}</h2>
                        <p className="mb-6 text-sm text-muted-foreground">
                            {deferred && !channelConnected ? t("doneStep.subtitleDeferred") : t("doneStep.subtitle")}
                        </p>

                        <ol className="space-y-2">
                            {(["channel", "knowledge", "team"] as const).map((key, index) => (
                                <li key={key} className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-[11px] font-bold text-white">
                                        {index + 1}
                                    </span>
                                    <div className="min-w-0">
                                        <p className="text-[13px] font-semibold text-foreground">{t(`doneStep.essentials.${key}.title`)}</p>
                                        <p className="mt-0.5 text-[12px] text-muted-foreground">{t(`doneStep.essentials.${key}.description`)}</p>
                                    </div>
                                </li>
                            ))}
                        </ol>

                        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                            <button
                                type="button"
                                onClick={() => void finish()}
                                disabled={saving}
                                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-40 cursor-pointer"
                            >
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                {t("doneStep.goToPanel")}
                            </button>
                            {channelConnected && (
                                <button
                                    type="button"
                                    onClick={() => void finish({ openTour: true })}
                                    disabled={saving}
                                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-neutral-300 px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-neutral-100 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5 cursor-pointer"
                                >
                                    <Compass size={16} /> {t("doneStep.tourCta")}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Navigation */}
            <div className="mt-4 flex items-center justify-between gap-3">
                <button
                    type="button"
                    onClick={() => setStep(Math.max(0, step - 1) as StepIndex)}
                    disabled={step === 0}
                    className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 cursor-pointer"
                >
                    <ChevronLeft size={16} /> {t("navigation.previous")}
                </button>

                {step < LAST_STEP && (
                    <button
                        type="button"
                        onClick={async () => {
                            // Un guardado fallido no puede pasar de paso en
                            // silencio: el error queda en pantalla y la persona
                            // decide.
                            if (!(await autosave())) return;
                            setStep(Math.min(LAST_STEP, step + 1) as StepIndex);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-600 cursor-pointer"
                    >
                        {t("navigation.next")} <ChevronRight size={16} />
                    </button>
                )}
            </div>
        </div>
    );
}
