"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
    ChevronRight, ChevronLeft, Check, Sparkles, Loader2,
    Plug, PartyPopper, LogOut, ArrowRight, Clock, Compass, AlertTriangle,
} from "lucide-react";
import {
    GUIDED_TOUR_START_EVENT,
    isOnboardingBeforeLive,
    type GuidedTourStartDetail,
    type AgentConfigurationWorkspace,
} from "@parallext/shared";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { guidedTourAnchorId } from "@/lib/guided-tours";
import {
    demoLinkPause,
    readSetupStatusFacts,
    type SetupStatusDefaultAgent,
    type SetupStatusDemoLink,
} from "@/lib/onboarding-guide";
import { isDeferringWhatsAppTriageAnswer } from "@/lib/home-day-zero";
import AnimatedLogo from "@/components/AnimatedLogo";
import { prepareDraftSave, type DraftSaveAttempt } from '@/lib/agent-draft-save';
import { HelpPanel } from "@/components/ui/help-panel";
import WhatsAppConnectPanel from "../channels/whatsapp/WhatsAppConnectPanel";
import WhatsAppConnectedState from "../channels/whatsapp/WhatsAppConnectedState";
import { BILLING_READINESS_ENDPOINT, billingZoneAccess } from "../channels/whatsapp/billing-time-zone";
import type { ConnectedPending, ConnectedReadiness, WhatsAppConnectedPayload } from "../channels/whatsapp/connected-readiness";
import {
    doneStepChannel,
    doneStepFixesOnWhatsappScreen,
    readConnectedReadiness,
    readExistingWhatsAppNumber,
    settledReadiness,
} from "./done-step-channel";
import SecondaryChannels from "./_components/SecondaryChannels";
import { ConnectedChannelSuccess } from "./_components/ConnectedChannelSuccess";
import {
    WIZARD_CHANNELS,
    emailBlocksConnect,
    isChannelInPlan,
    isSecondaryChannel,
    isWizardChannel,
    leadChannel,
    orderWizardChannels,
    readPlanChannels,
    readRecipeRecommendations,
    wizardChannelOrderToSave,
    type ChannelRecommendation,
    type ConnectedChannelDetails,
    type WizardChannel,
} from "./connect-channels";
import {
    doneStepEssentials,
    readSetupActivationFacts,
    readSetupProgressFacts,
    type SetupActivationFacts,
    type SetupProgressFacts,
} from "./done-step-essentials";
import AgentTestChat from "./_components/AgentTestChat";
import DemoLinkCard from "./_components/DemoLinkCard";
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
 * confirm the agent we prepared, connect the channel the customers already
 * write through, and know what comes next.
 *
 * During day 0 (`isOnboardingBeforeLive`) the step IS the guide: no help strip
 * about how the wizard works, no "Mostrarme dónde" tour, no link out to the
 * expert editor. Six surfaces at once is how the 14-sep recording lost 48
 * minutes; after the first real reply the wizard is a tool again and gets them
 * back.
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
 * The line "Listo" says for each thing still stopping WhatsApp: what it is,
 * and where it is fixed. A `Record` so a new kind of pending cannot reach the
 * screen without its own sentence.
 */
const DONE_STEP_PENDING_LINE: Record<ConnectedPending, string> = {
    billing_zone: "doneStep.essentials.channel.pendingZone",
    payment_method: "doneStep.essentials.channel.pendingPayment",
    phone_registration: "doneStep.essentials.channel.pendingRegistration",
    webhook_subscription: "doneStep.essentials.channel.pendingWebhook",
};

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
    /**
     * The channels in the order the connect step offers them. Only on the
     * `stageOnly` path: on the create-the-agent path the server takes this
     * same field as the new agent's channel assignments. Left out when the
     * plan's channels are not known (`wizardChannelOrderToSave`).
     */
    selectedChannels?: WizardChannel[];
};

const saveWizard = api.applySetupTemplate as unknown as (
    tenantId: string,
    payload: WizardSavePayload,
) => Promise<{ success?: boolean; error?: string } | undefined>;

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
    const tDraft = useTranslations('agentDraft');
    const { user, planFeatures } = useAuth();
    const locale = useLocale();
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
    /**
     * "El enlace de {Nombre}": the public page where anyone can already write
     * to the agent (D11). It comes from setup-status because the API provisions
     * it on day 0; this page never creates one, it only hands it out.
     */
    const [demoLink, setDemoLink] = useState<SetupStatusDemoLink | null>(null);
    /** Where this business should start, from its recipe. Empty = default order. */
    const [recommendations, setRecommendations] = useState<ChannelRecommendation[]>([]);
    /**
     * Her answer to "¿Dónde vive hoy tu número?" as the account recorded it
     * (`setupStatus.whatsappTriage`), and whether she answered it HERE with a
     * reason that leaves WhatsApp for later. Either way she chose WhatsApp:
     * see `whatsappChosen`.
     */
    const [recordedTriageAnswer, setRecordedTriageAnswer] = useState<string | null>(null);
    const [whatsappPostponedHere, setWhatsappPostponedHere] = useState(false);
    /** What "Listo" can say is already done. `undefined` fields = not known. */
    const [progress, setProgress] = useState<SetupProgressFacts>({});
    /** The day-0 facts as setup-status reads them now, fresher than the session's. */
    const [activation, setActivation] = useState<SetupActivationFacts>({});
    /** Instagram, Messenger or Telegram connected in this session, with what it said about itself. */
    const [connectedHere, setConnectedHere] = useState<ConnectedChannelDetails | null>(null);
    /** El nombre con el que el enlace presenta al agente: lo tipeado gana. */
    const linkAgentName = agentName.trim() || demoLink?.agentName || t("demoLink.agentFallback");
    /** El número que se conectó EN ESTA SESIÓN, tal como lo devolvió el alta. */
    const [whatsappHere, setWhatsappHere] = useState<WhatsAppConnectedPayload | null>(null);
    /**
     * Se salió del paso de conexión después de conectar acá. Al volver, el
     * panel se montaría de cero —sin su "conectado"— y ofrecería otra vez el
     * selector de ruta: un segundo alta de Meta sobre el número recién
     * conectado. Desde ese momento el paso muestra el estado conectado.
     */
    const [leftConnectedPanel, setLeftConnectedPanel] = useState(false);
    /** El número que ya estaba conectado antes de entrar. `undefined` = leyendo. */
    const [existingNumber, setExistingNumber] = useState<WhatsAppConnectedPayload | undefined>(undefined);
    /**
     * Si el agente puede responder por WhatsApp. `undefined` = todavía no se
     * sabe (se lee en "Listo"); `null` = no se pudo leer. Lo trae "Continuar"
     * desde el estado conectado; si se llegó por otro camino, se lee de nuevo.
     */
    const [whatsappReadiness, setWhatsappReadiness] = useState<ConnectedReadiness | null | undefined>(undefined);
    const [workspace, setWorkspace] = useState<AgentConfigurationWorkspace | null>(null);
    const workspaceRef = useRef<AgentConfigurationWorkspace | null>(null);
    const hasAgentRef = useRef(false);
    const saveAttempt = useRef<DraftSaveAttempt | null>(null);
    const editRevision = useRef(0);

    // El agente ya persiste solo; el borrador local guarda el paso Y lo tipeado,
    // para que un refresh antes de que el campo pierda el foco no se lleve el
    // nombre y el saludo recién escritos.
    const draftKey = tenantId ? `${DRAFT_KEY_PREFIX}:${tenantId}` : null;
    /**
     * Hay algo escrito sin guardar. En dos formas, y las dos hacen falta.
     *
     * La ref es lo que leen los callbacks: `saveOrAdvance` y `autosave`
     * necesitan el valor de AHORA, no el de la ultima vez que se dibujo.
     * El estado es lo que lee el render, y esa es la mitad que faltaba: una ref
     * no programa un dibujo, asi que `blocked` —la condicion que impide probar
     * un borrador con cambios sin guardar— dependia de un valor que podia
     * cambiar sin que la pantalla se enterara. Funcionaba solo porque cada
     * escritura venia acompanada de un `setState` vecino.
     */
    const dirtyRef = useRef(false);
    const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
    const markDirty = useCallback((value: boolean) => {
        dirtyRef.current = value;
        setHasUnsavedEdits(value);
    }, []);
    const savingRef = useRef(false);

    /**
     * WhatsApp ya estaba conectado ANTES de entrar acá. Deliberadamente no se
     * toca cuando la conexión ocurre en esta sesión: ahí manda el panel, que
     * muestra el número y el "probalo" que siguen a un alta recién hecha.
     */
    const whatsappAlreadyConnected = connectedTypes.includes("whatsapp");
    const whatsappInPlay = whatsappAlreadyConnected || whatsappHere !== null;
    /** El paso de conexión muestra el estado conectado en vez del panel de alta. */
    const showConnectedState = whatsappAlreadyConnected || (whatsappHere !== null && leftConnectedPanel);
    const connectedStatePayload = whatsappAlreadyConnected ? existingNumber : whatsappHere ?? undefined;

    useEffect(() => {
        if (!tenantId) return;
        let cancelled = false;

        Promise.all([
            api.getSetupStatus(tenantId).catch(() => null),
            api.getPersonaTemplates(tenantId).catch(() => null),
            // The recipe orders the channels. Read with the rest so the connect
            // step never reshuffles under the person's finger; a failure is the
            // default order, never an error.
            api.fetch(`/verticals/${tenantId}/recipe?lang=${encodeURIComponent(locale)}`).catch(() => null),
        ]).then(async ([statusRes, templatesRes, recipeRes]) => {
            if (cancelled) return;
            const facts = readSetupStatusFacts(statusRes);
            setRecommendations(readRecipeRecommendations(recipeRes, locale));
            setProgress(readSetupProgressFacts(statusRes));
            setActivation(readSetupActivationFacts(statusRes));
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
            hasAgentRef.current = facts?.hasAgent !== false;
            const configuration = agent?.id ? await api.getAgentConfiguration(tenantId, agent.id).catch(() => null) : null;
            if (cancelled) return;
            const current = configuration?.success ? configuration.data ?? null : null;
            workspaceRef.current = current; setWorkspace(current);
            if (hasAgentRef.current && !current) setError(tDraft('loadUnavailable'));
            // `?.` all the way down, not one level short.
            //
            // `current` was already treated as possibly absent — the line above
            // sets an error for it — but `current?.operational.body` still
            // throws for a workspace that arrives without `operational`. The
            // throw escapes into the tour's error boundary and the wizard is
            // left on its spinner forever: no message, no retry, and the one
            // screen a new account cannot get past. The contract says
            // `operational` is always there; if it ever is not, the person gets
            // the error this file already writes instead of a white page.
            const editable = current?.draft?.body ?? current?.operational?.body;
            const templateConfig = ownTemplateId
                ? (templates.find((tmpl) => tmpl.id === ownTemplateId)?.config
                    ?? templates.find((tmpl) => tmpl.id === ownTemplateId)?.config_json)
                : null;

            const name = editable?.name || agent?.name
                || (typeof templateConfig?.persona?.name === "string" ? templateConfig.persona.name : "");
            // El saludo del agente ya viene sustituido; el de la plantilla, no.
            const hello = editable?.configJson.persona?.greeting || agent?.greeting
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
            setDemoLink(facts?.demoLink ?? null);
            setRecordedTriageAnswer(facts?.whatsappTriage?.answerId ?? null);

            // El borrador devuelve el paso Y lo que se estaba escribiendo. Solo
            // pisa al servidor cuando difiere: si lo hace, queda marcado como
            // sucio para que el próximo guardado lo persista.
            try {
                const raw = draftKey ? localStorage.getItem(draftKey) : null;
                const draft = raw ? JSON.parse(raw) : null;
                if (draft && typeof draft.step === "number") {
                    const restored = Math.min(LAST_STEP, Math.max(0, draft.step)) as StepIndex;
                    // "Listo" sólo después de responder la pregunta del canal.
                    // Un borrador de antes de esta regla podía haber llegado ahí
                    // con "Siguiente" y sin dejar anotado el "después": se lo
                    // devuelve a la conexión en vez de a un final sin canal.
                    const channelUndecided = !facts?.hasAnyChannel && !facts?.channelConnectSkippedAt;
                    setStep(restored === LAST_STEP && channelUndecided ? 1 : restored);
                }
                const matchingBase = draft?.operationalVersion === current?.operational?.version && draft?.revisionId === (current?.draft?.id ?? null);
                if (matchingBase && typeof draft?.agentName === "string" && draft.agentName.trim() && draft.agentName !== name) {
                    setAgentName(draft.agentName);
                    markDirty(true);
                }
                if (matchingBase && typeof draft?.greeting === "string" && draft.greeting.trim() && draft.greeting !== hello) {
                    setGreeting(draft.greeting);
                    markDirty(true);
                }
            } catch { /* borrador corrupto → empezar en el paso 1 */ }

            setLoading(false);
        }).catch(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [companyName, draftKey, locale, tenantId, tDraft]);

    useEffect(() => {
        if (!draftKey || loading) return;
        try {
            localStorage.setItem(draftKey, JSON.stringify({ step, agentName, greeting,
                operationalVersion: workspace?.operational?.version, revisionId: workspace?.draft?.id ?? null }));
        } catch { /* noop */ }
    }, [agentName, draftKey, greeting, loading, step, workspace]);

    /**
     * Qué número estaba conectado antes de entrar, para leer SU zona horaria y
     * SU método de pago. Un fallo no es un error: el estado conectado lo
     * encuentra solo cuando la cuenta tiene un único número.
     */
    useEffect(() => {
        if (!whatsappAlreadyConnected) return;
        let cancelled = false;
        void api.fetch("/channels/whatsapp/status").catch(() => null).then((res) => {
            if (!cancelled) setExistingNumber(readExistingWhatsAppNumber(res));
        });
        return () => { cancelled = true; };
    }, [whatsappAlreadyConnected]);

    /**
     * Volver al paso de conexión vuelve a preguntar: lo que la persona haga
     * ahí (confirmar la zona, agregar el método de pago) cambia lo que "Listo"
     * puede decir.
     */
    useEffect(() => {
        if (step === 1) {
            setWhatsappReadiness(undefined);
        } else if (whatsappHere) {
            setLeftConnectedPanel(true);
        }
    }, [step, whatsappHere]);

    /**
     * "Listo" sin la lectura de "Continuar" —se llegó con "Siguiente", con el
     * círculo del paso o recargando— la hace él mismo, con los mismos datos.
     */
    useEffect(() => {
        if (step !== LAST_STEP || !whatsappInPlay || whatsappReadiness !== undefined) return;
        const connected = whatsappHere ?? existingNumber;
        if (!connected) return; // todavía se está leyendo cuál es el número
        let cancelled = false;
        void Promise.all([
            api.fetch(BILLING_READINESS_ENDPOINT).catch(() => null),
            api.getWhatsappFundingReadiness().catch(() => null),
        ]).then(([zones, funding]) => {
            if (!cancelled) setWhatsappReadiness(readConnectedReadiness(zones, funding, connected, Date.now()));
        });
        return () => { cancelled = true; };
    }, [existingNumber, step, whatsappHere, whatsappInPlay, whatsappReadiness]);

    interface WizardProgress {
        markCompleted?: boolean;
        stage?: WizardStage;
        channelConnectSkippedAt?: string;
        /**
         * The channel she chose in this very action, before the state that
         * remembers it has been drawn: the WhatsApp answer that postpones it
         * saves in the same click.
         */
        leadWith?: WizardChannel;
    }

    /**
     * She chose WhatsApp and left it for later: she answered the WhatsApp
     * question with "con otro proveedor" or "no lo tengo a mano" — here, or
     * before (the account recorded it). The recipe may lead with Instagram,
     * but the channel she is waiting on is WhatsApp, so "Listo" names it and
     * the order this page saves puts it first — which is what the server's
     * setup step, "Salud de agentes", Assist and Inicio's reminder (whose note
     * repeats that same answer) read. Only while nothing is connected.
     */
    const whatsappChosen = !channelConnected
        && (whatsappPostponedHere || isDeferringWhatsAppTriageAnswer(recordedTriageAnswer));

    /**
     * The channels as the connect step offers them: the recipe's order, only
     * those the plan lets her connect — the same `orderWizardChannels` and
     * `isChannelInPlan` the step renders with, so the first one is the channel
     * the step leads with (or WhatsApp, once she chose it). It rides on every
     * progress save (leaving the connect step, "Conectar después", finishing)
     * instead of a request of its own, for the server to keep as
     * `setupWizardChannels`: that is where "Salud de agentes" and Assist read
     * which channel to connect first, and with it empty they told a beauty
     * salon "WhatsApp" while this step and Inicio led with Instagram. With the
     * plan not known it is left out (`wizardChannelOrderToSave`).
     */
    const channelOrderToSave = useCallback((leadWith?: WizardChannel) => wizardChannelOrderToSave({
        recommendations,
        planChannels: readPlanChannels(planFeatures),
        first: leadWith ?? (whatsappChosen ? "whatsapp" : null),
    }), [planFeatures, recommendations, whatsappChosen]);

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
    const advanceStage = useCallback((options: WizardProgress = {}) => {
        const order = channelOrderToSave(options.leadWith);
        return postWizard({
            stageOnly: true,
            stage: options.stage,
            markCompleted: options.markCompleted === true,
            channelConnectSkippedAt: options.channelConnectSkippedAt,
            ...(order ? { selectedChannels: order } : {}),
        });
    }, [channelOrderToSave, postWizard]);

    /**
     * Connecting a channel binds the agent and bumps its version on the server.
     * Re-read the workspace so a later edit does not save against a stale base.
     */
    const refreshWorkspace = useCallback(async () => {
        const agentId = workspaceRef.current?.agentId;
        if (!tenantId || !agentId) return;
        const res = await api.getAgentConfiguration(tenantId, agentId).catch(() => null);
        if (res?.success && res.data) { workspaceRef.current = res.data; setWorkspace(res.data); }
    }, [tenantId]);

    /** Guarda lo que la persona escribió. Solo se llama si hubo edición real. */
    const saveAgentEdits = useCallback(async (options: WizardProgress = {}): Promise<boolean> => {
        const current = workspaceRef.current;
        if (current && tenantId) {
            try {
                const body = structuredClone(current.draft?.body ?? current.operational.body);
                body.name = agentName.trim(); body.configJson.persona = { ...body.configJson.persona, name: body.name, greeting: greeting.trim() };
                saveAttempt.current = prepareDraftSave(current, body, saveAttempt.current);
                const result = await api.saveAgentDraft(tenantId, current.agentId, saveAttempt.current.request);
                if (!result.success || !result.data) { setError(tDraft('saveFailed')); return false; }
                workspaceRef.current = result.data.workspace; setWorkspace(result.data.workspace); saveAttempt.current = null;
                // With immediate changes the revision was applied and the draft
                // pointer is gone by design; only a reviewed draft can go stale.
                if (!result.data.workspace.directCommit && result.data.savedRevision.id !== result.data.workspace.draft?.id) { setError(tDraft('baseChanged')); return false; }
                return advanceStage(options);
            } catch { setError(tDraft('saveFailed')); return false; }
        }
        if (hasAgentRef.current) { setError(tDraft('loadUnavailable')); return false; }
        return postWizard({
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
        });
    }, [agentName, greeting, postWizard, templateId, tenantId, advanceStage, tDraft]);

    /** Guarda si hay algo que guardar; si no, solo avanza la etapa. */
    const saveOrAdvance = useCallback(async (options: WizardProgress = {}): Promise<boolean> => {
        const dirty = dirtyRef.current;
        const revision = editRevision.current;
        const ok = dirty ? await saveAgentEdits(options) : await advanceStage(options);
        // Sucio hasta que se confirme el guardado: un fallo no puede hacer
        // desaparecer lo tipeado del próximo intento.
        if (ok && dirty && revision === editRevision.current) markDirty(false);
        return ok;
    }, [advanceStage, saveAgentEdits]);

    const autosave = useCallback(async (): Promise<boolean> => {
        if (savingRef.current) return false;
        if (!dirtyRef.current) return true;
        const revision = editRevision.current;
        setSaving(true);
        savingRef.current = true;
        const ok = await saveAgentEdits({ stage: "agent_reviewed" });
        savingRef.current = false;
        setSaving(false);
        if (ok) {
            if (revision === editRevision.current) markDirty(false);
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

    const connectLater = useCallback(async (leadWith?: WizardChannel) => {
        const ok = await saveOrAdvance({
            stage: "channel_deferred",
            channelConnectSkippedAt: new Date().toISOString(),
            leadWith,
        });
        if (!ok) return;
        setStep(LAST_STEP);
    }, [saveOrAdvance]);

    /**
     * Moverse entre pasos, con una regla: a "Listo" sin canal se llega SOLO
     * como "conectar después".
     *
     * "Siguiente" en el paso de conexión —y el círculo del paso 3— salteaban
     * WhatsApp sin anotarlo, y "Listo" decía "tu agente ya responde por el
     * canal conectado" sin canal conectado. Así terminó la grabación del
     * 14-sep: WhatsApp pendiente, ningún recordatorio y un final que afirmaba lo
     * contrario. Ahora ese salto guarda la decisión igual que el botón
     * "Conectar después", y un guardado fallido se queda donde está.
     */
    const goToStep = useCallback(async (target: StepIndex) => {
        if (target === step) return;
        if (target === LAST_STEP && !channelConnected) {
            await connectLater();
            return;
        }
        // Un guardado fallido no puede pasar de paso en silencio: el error
        // queda en pantalla y la persona decide.
        if (target > step && !(await autosave())) return;
        setStep(target);
    }, [autosave, channelConnected, connectLater, step]);

    const finish = useCallback(async (options: { openTour?: boolean; destination?: string } = {}) => {
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
            // The tour is offered, never fired on its own: only the explicit
            // "ver el recorrido" button arms it, and Home runs it once.
            if (options.openTour) localStorage.setItem(PRODUCT_TOUR_PENDING_KEY, "true");
        } catch { /* mejoras opcionales no bloquean el cierre */ }
        window.location.href = options.destination ?? "/admin";
    }, [draftKey, saveOrAdvance]);

    /** "Continuar" desde el estado conectado: trae lo que falta para responder. */
    const acknowledgeWhatsapp = useCallback((readiness: ConnectedReadiness) => {
        setWhatsappReadiness(settledReadiness(readiness));
        void goToStep(LAST_STEP);
    }, [goToStep]);

    /**
     * Day 0: the account is still waiting for its agent's first real reply.
     * setup-status is read on every open and wins over the session's copy; a
     * first reply either side knows about ends it (it is never undone).
     */
    const dayZero = isOnboardingBeforeLive(activation.stage ?? user?.onboardingStage, {
        firstReplyAt: activation.firstReplyAt ?? user?.firstReplyAt ?? null,
        createdAt: activation.tenantCreatedAt ?? user?.tenantCreatedAt ?? null,
    });

    const channelLabel = (channel: WizardChannel) => t(`connect.channel_${channel}`);
    const joinNames = (names: string[]) => {
        try { return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(names); }
        catch { return names.join(", "); }
    };
    const planChannels = readPlanChannels(planFeatures);
    const channelOrder = orderWizardChannels(recommendations);
    /** The channel the step leads with: the recipe's first one the plan includes. */
    const lead = leadChannel(channelOrder, planChannels);
    /** The channel "Listo" says is pending: the one she chose, else the one the step led with. */
    const pendingChannel: WizardChannel = whatsappChosen ? "whatsapp" : lead;
    /**
     * Whether the agent answers on its link today. Every "ya responde por su
     * enlace" and every offer to open it waits on this: a paused trial link
     * is not somewhere to send her.
     */
    const linkPause = demoLinkPause(demoLink);
    const linkAnswers = demoLink !== null && linkPause === null;
    const meanwhileLine = demoLink
        ? (linkPause
            ? t(`demoLink.paused.${linkPause}`, { agentName: linkAgentName })
            : t("demoLink.meanwhile", { agentName: linkAgentName }))
        : null;
    const secondaryOrder = channelOrder.filter(isSecondaryChannel);
    const firstRecommendation = recommendations[0] ?? null;
    const firstRecommendationInPlan = firstRecommendation ? isChannelInPlan(firstRecommendation.channel, planChannels) : false;

    /**
     * A channel other than WhatsApp that is connected — here, or before the
     * wizard opened. It gets its own victory instead of the WhatsApp question
     * staying on screen as if nothing had happened.
     */
    const serverOtherChannel = connectedTypes.find(isSecondaryChannel);
    const otherConnected: ConnectedChannelDetails | null = connectedHere
        ?? (serverOtherChannel ? { channel: serverOtherChannel, label: null, href: null } : null);
    const showOtherConnected = !showConnectedState && whatsappHere === null && otherConnected !== null;

    /** Every channel connected so far, by name, for "Listo". */
    const connectedNames = WIZARD_CHANNELS.filter((channel) => (
        connectedTypes.filter(isWizardChannel).includes(channel)
        || (channel === "whatsapp" && whatsappHere !== null)
        || connectedHere?.channel === channel
    )).map(channelLabel);

    const channelOutcome = doneStepChannel({ channelConnected, whatsapp: whatsappInPlay, readiness: whatsappReadiness });
    /** What the channel item of "Listo" says, once there is a channel. */
    const channelLines: string[] = channelOutcome.kind === "pending"
        ? channelOutcome.pending.map((item) => t(DONE_STEP_PENDING_LINE[item]))
        : channelOutcome.kind === "unconfirmed"
            ? [t("doneStep.essentials.channel.unconfirmedDescription")]
            : channelOutcome.kind === "checking"
                ? [t("doneStep.essentials.channel.checkingDescription")]
                : channelOutcome.kind === "answering"
                    ? [
                        t("doneStep.essentials.channel.connectedDescription"),
                        ...(channelOutcome.paymentSoon ? [t("doneStep.essentials.channel.paymentSoon")] : []),
                    ]
                    : [];
    const isAdmin = user?.role === "super_admin" || user?.role === "tenant_admin";

    const showConnectTour = () => {
        const detail: GuidedTourStartDetail = { tourId: "first_channel_whatsapp" };
        window.dispatchEvent(new CustomEvent(GUIDED_TOUR_START_EVENT, { detail }));
    };

    const whatsappPanel = tenantId ? (
        <WhatsAppConnectPanel
            tenantId={tenantId}
            variant="onboarding"
            onConnected={(data) => {
                setChannelConnected(true);
                setWhatsappHere(data);
                setWhatsappReadiness(undefined);
                void refreshWorkspace();
            }}
            onAcknowledged={acknowledgeWhatsapp}
            // Quien contesta que su número está con otro proveedor, o que no
            // lo tiene a mano, no se queda sin salida: se apunta el "después"
            // y el agente sigue atendiendo por su enlace mientras tanto (si el
            // enlace responde; si no, se dice que está en pausa). Eligió
            // WhatsApp: el orden que se guarda lo pone primero.
            onPostponed={() => {
                setWhatsappPostponedHere(true);
                void connectLater("whatsapp");
            }}
            meanwhile={meanwhileLine ? (
                <p className="text-[12px] text-muted-foreground">{meanwhileLine}</p>
            ) : undefined}
        />
    ) : null;

    const secondaryChannels = tenantId ? (
        <SecondaryChannels
            tenantId={tenantId}
            channels={secondaryOrder}
            recommended={firstRecommendationInPlan ? firstRecommendation?.channel ?? null : null}
            planChannels={planChannels}
            emailBlocked={emailBlocksConnect(user)}
            email={user?.email ?? ""}
            channelName={channelLabel}
            // "Abrir el enlace de {Nombre}" only while it answers.
            demoLink={linkAnswers ? demoLink : null}
            agentName={agentName}
            onConnected={(details) => {
                setChannelConnected(true);
                setConnectedHere(details);
                void refreshWorkspace();
            }}
        />
    ) : null;

    if (loading) {
        return (
            <div role="status" aria-label={tCommon("loading")}
                className="flex min-h-[60vh] items-center justify-center">
                <h1 className="sr-only">{t("title")}</h1>
                <Loader2 size={24} aria-hidden="true" className="animate-spin text-indigo-500" />
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

            {/* Day 0: the step is the guide. A strip explaining the wizard on
                top of the wizard was one of the six voices of the recording. */}
            {!dayZero && (
                <HelpPanel
                    title={tHelp("setupWizard.title")}
                    description={tHelp("setupWizard.description")}
                    tips={tHelp.raw("setupWizard.tips") as string[]}
                />
            )}

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
                                onClick={() => void goToStep(i as StepIndex)}
                                aria-label={`${t("navigation.stepOf", { current: i + 1, total: STEPS.length })}: ${t(`steps.${s.key}`)}`}
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors cursor-pointer ${
                                    i < step ? "bg-emerald-500 text-white"
                                        : i === step ? "bg-indigo-500 text-white"
                                            : "bg-neutral-200 text-muted-foreground dark:bg-white/10"
                                }`}
                                aria-current={i === step ? "step" : undefined}
                            >
                                {i < step ? <Check size={14} aria-hidden="true" /> : i + 1}
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
                                        onChange={(e) => { markDirty(true); editRevision.current++; setAgentName(e.target.value); }}
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
                                        onChange={(e) => { markDirty(true); editRevision.current++; setGreeting(e.target.value); }}
                                        onBlur={() => void autosave()}
                                        className="w-full resize-none rounded-xl border border-neutral-300 bg-neutral-50 px-3.5 py-2.5 text-sm text-foreground outline-none focus:border-indigo-500 dark:border-white/10 dark:bg-white/5"
                                    />
                                </div>

                                <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
                                    {saving
                                        ? <span className="inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> {t("agentStep.saving")}</span>
                                        : savedAt && !hasUnsavedEdits
                                            ? <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"><Check size={12} /> {tDraft(workspace?.directCommit ? 'savedLive' : 'saved')}</span>
                                            : <span>{t("agentStep.autosaveHint")}</span>}
                                </div>

                                {/* La grilla de plantillas se mudó al editor: acá sólo se
                                    confirma lo que el alta ya dedujo del rubro. En el día 0
                                    no se ofrece la salida al editor experto: ahí esperan
                                    cinco superficies más, y este paso ya dice qué cambiar
                                    (el nombre, el saludo) y deja probarlo al lado. */}
                                {!dayZero && (
                                    <Link
                                        href="/admin/agent"
                                        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                                    >
                                        {t("agentStep.changeTemplate")} <ArrowRight size={13} aria-hidden="true" />
                                    </Link>
                                )}
                            </div>

                            {tenantId && (
                                <div>
                                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        {t("test.title")}
                                    </p>
                                    <AgentTestChat tenantId={tenantId} agentId={workspace?.agentId ?? null} configurationRevisionId={workspace?.evaluationRevisionId ?? undefined}
                                        blocked={!workspace || Boolean(workspace.draft && !workspace.draft.currentBase) || hasUnsavedEdits || saving} />
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Paso 2: El canal por el que te escriben ── */}
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
                        {showConnectedState ? (
                            // "¡Conectado!" a secas no alcanzaba: la zona
                            // horaria de facturación y el método de pago en
                            // Meta deciden si las respuestas salen. Es el mismo
                            // estado que ve quien conecta acá, con su "Continuar".
                            <div className="space-y-3">
                                {connectedStatePayload ? (
                                    <WhatsAppConnectedState
                                        connected={connectedStatePayload}
                                        access={billingZoneAccess(user)}
                                        // The Meta check is admin-only on the server.
                                        canCheckFunding={isAdmin}
                                        onAcknowledged={acknowledgeWhatsapp}
                                    />
                                ) : (
                                    <div role="status" aria-label={tCommon("loading")} className="flex justify-center py-6">
                                        <Loader2 size={20} aria-hidden="true" className="animate-spin text-indigo-500" />
                                    </div>
                                )}
                                <Link
                                    href="/admin/channels"
                                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                                >
                                    {t("connect.otherChannels")} <ArrowRight size={13} aria-hidden="true" />
                                </Link>
                            </div>
                        ) : showOtherConnected && otherConnected ? (
                            // Instagram, Messenger o Telegram conectados: su
                            // propia victoria, y la pregunta de WhatsApp se va.
                            <div className="space-y-3">
                                <ConnectedChannelSuccess
                                    connected={otherConnected}
                                    channelName={channelLabel(otherConnected.channel)}
                                    onContinue={() => void goToStep(LAST_STEP)}
                                />
                                <Link
                                    href="/admin/channels"
                                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                                >
                                    {t("connect.otherChannels")} <ArrowRight size={13} aria-hidden="true" />
                                </Link>
                            </div>
                        ) : (
                            <>
                                {/* Por dónde le conviene empezar a ESTE negocio,
                                    y por qué: la receta ya lo sabía. Sin receta
                                    no se dice nada y WhatsApp va primero. */}
                                {firstRecommendation && (
                                    <div
                                        data-recommended-channel={firstRecommendation.channel}
                                        className="mb-5 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-500/30 dark:bg-indigo-500/5"
                                    >
                                        <p className="text-[13px] font-semibold text-foreground">
                                            {firstRecommendationInPlan
                                                ? t("connectStep.recommendedTitle", { channel: channelLabel(firstRecommendation.channel) })
                                                : t("connectStep.recommendedLockedTitle", { channel: channelLabel(firstRecommendation.channel) })}
                                        </p>
                                        {firstRecommendation.why && (
                                            <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{firstRecommendation.why}</p>
                                        )}
                                        {!firstRecommendationInPlan && (
                                            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                                                {t("connectStep.recommendedLockedMeanwhile", { channel: channelLabel(lead) })}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {lead === "whatsapp" ? (
                                    <>
                                        {whatsappPanel}
                                        {!channelConnected && (
                                            <div className="mt-7">
                                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                    {t("connect.otherChannels")}
                                                </p>
                                                {secondaryChannels}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        {!channelConnected && secondaryChannels}
                                        <div className={channelConnected ? undefined : "mt-7"}>
                                            {!channelConnected && (
                                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                    {t("connect.orWhatsapp")}
                                                </p>
                                            )}
                                            {whatsappPanel}
                                        </div>
                                    </>
                                )}

                                {!channelConnected && (
                                    <div className="mt-7 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                                        <p className="text-[13px] font-medium text-foreground">{t("connectStep.laterTitle")}</p>
                                        <p className="mt-0.5 text-[12px] text-muted-foreground">{t("connectStep.laterHint")}</p>
                                        {meanwhileLine && (
                                            <p className="mt-0.5 text-[12px] text-muted-foreground">{meanwhileLine}</p>
                                        )}
                                        <div className="mt-3 flex flex-wrap items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => void connectLater()}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/5 cursor-pointer"
                                            >
                                                <Clock size={13} aria-hidden="true" /> {t("connect.connectLater")}
                                            </button>
                                            {/* The tour is a second guide on top of this step;
                                                it waits for after the first real reply. */}
                                            {!dayZero && (
                                                <button
                                                    type="button"
                                                    onClick={showConnectTour}
                                                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-500/10 cursor-pointer"
                                                >
                                                    <Compass size={13} aria-hidden="true" /> {t("connectStep.showMe")}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* ── Paso 3: Listo ── */}
                {step === 2 && (
                    <div className="mx-auto max-w-xl">
                        <h2 className="mb-1 text-xl font-semibold text-foreground">{t("doneStep.title")}</h2>
                        {/* Lo que dice tiene que ser cierto: "ya responde"
                            sólo cuando nada conocido lo impide; si falta la
                            zona horaria o el método de pago de WhatsApp, lo
                            dice; sin canal, contesta por su enlace y el canal
                            queda pendiente. */}
                        <p className="mb-6 text-sm text-muted-foreground" role="status" data-channel-outcome={channelOutcome.kind}>
                            {channelOutcome.kind === "answering" && t("doneStep.subtitle")}
                            {channelOutcome.kind === "checking" && t("doneStep.subtitleChecking")}
                            {channelOutcome.kind === "pending" && t("doneStep.subtitlePending")}
                            {channelOutcome.kind === "unconfirmed" && t("doneStep.subtitleUnconfirmed")}
                            {channelOutcome.kind === "no_channel" && (linkAnswers
                                ? t("doneStep.subtitleLink", { agentName: linkAgentName, channel: channelLabel(pendingChannel) })
                                : t("doneStep.subtitleDeferred", { channel: channelLabel(pendingChannel) }))}
                        </p>

                        {/* The one thing that works today, channel or no channel:
                            the agent's public link, to try now and to share.
                            Paused, the card says so instead — and only while
                            it is her way to see the agent, with no channel. */}
                        {demoLink && (linkAnswers || channelOutcome.kind === "no_channel") && (
                            <div className="mb-6">
                                <DemoLinkCard demoLink={demoLink} agentName={agentName} />
                            </div>
                        )}

                        {/* What is done is said as done, and a count nobody could
                            read is left out: the list used to be the same three
                            chores for everybody, numbered as pending, even for
                            an owner who had already done two of them. */}
                        <ol className="space-y-2">
                            {doneStepEssentials(progress).map(({ key, done }, index) => {
                                // The channel item is done (said as done), being
                                // checked, pending with what is missing, or not
                                // connected; "sin un canal no recibe mensajes de
                                // nadie" is false once the agent has its link.
                                const outcome = key === "channel" ? channelOutcome.kind : null;
                                const itemDone = key === "channel" ? outcome === "answering" : done === true;
                                const channelStuck = outcome === "pending" || outcome === "unconfirmed";
                                const connectedTitle = connectedNames.length > 0
                                    ? t("doneStep.essentials.channel.connectedTitleNamed", { channels: joinNames(connectedNames), count: connectedNames.length })
                                    : t("doneStep.essentials.channel.connectedTitle");
                                const title = key !== "channel"
                                    ? t(`doneStep.essentials.${key}.${itemDone ? "doneTitle" : "title"}`)
                                    : outcome === "pending"
                                        ? t("doneStep.essentials.channel.pendingTitle")
                                        : outcome === "unconfirmed"
                                            ? t("doneStep.essentials.channel.unconfirmedTitle")
                                            : outcome === "answering" || outcome === "checking"
                                                ? connectedTitle
                                                : t("doneStep.essentials.channel.title", { channel: channelLabel(pendingChannel) });
                                const lines = key !== "channel"
                                    ? [t(`doneStep.essentials.${key}.${itemDone ? "doneDescription" : "description"}`)]
                                    : outcome !== "no_channel"
                                        ? channelLines
                                        : [linkAnswers
                                            ? t("doneStep.essentials.channel.descriptionWithLink", { channel: channelLabel(pendingChannel) })
                                            : t("doneStep.essentials.channel.description")];
                                return (
                                    <li key={key} data-essential={key} data-done={itemDone ? "true" : "false"} data-channel-item={outcome ?? undefined}
                                        className={`flex items-start gap-3 rounded-xl border p-4 ${channelStuck
                                            ? "border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
                                            : "border-neutral-200 bg-neutral-50 dark:border-white/10 dark:bg-white/[0.03]"}`}>
                                        <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${itemDone ? "bg-emerald-500" : channelStuck ? "bg-amber-600" : "bg-indigo-500"}`}>
                                            {itemDone
                                                ? <Check size={12} />
                                                : channelStuck
                                                    ? <AlertTriangle size={12} />
                                                    : outcome === "checking"
                                                        ? <Loader2 size={12} className="animate-spin" />
                                                        : index + 1}
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-[13px] font-semibold text-foreground">
                                                {outcome !== "checking" && (
                                                    <span className="sr-only">{t(itemDone ? "doneStep.itemDone" : "doneStep.itemPending")}: </span>
                                                )}
                                                {title}
                                            </p>
                                            {lines.map((line) => (
                                                <p key={line} className="mt-0.5 text-[12px] text-muted-foreground">{line}</p>
                                            ))}
                                            {channelStuck && doneStepFixesOnWhatsappScreen(channelOutcome) && (
                                                // Termina el asistente y abre la pantalla donde
                                                // se confirma la zona y se ve el método de pago.
                                                // Lo que Meta dejó abierto en el alta no se
                                                // arregla ahí: la línea dice dónde.
                                                <button
                                                    type="button"
                                                    onClick={() => void finish({ destination: "/admin/channels/whatsapp" })}
                                                    disabled={saving}
                                                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-amber-800 disabled:opacity-40 cursor-pointer"
                                                >
                                                    {t("doneStep.essentials.channel.finishOnWhatsapp")} <ArrowRight size={13} aria-hidden="true" />
                                                </button>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
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
                            {workspace && (
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
                        // En el paso de conexión, sin canal, esto es "conectar
                        // después": se anota igual que el botón de ese nombre.
                        onClick={() => void goToStep(Math.min(LAST_STEP, step + 1) as StepIndex)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-600 cursor-pointer"
                    >
                        {t("navigation.next")} <ChevronRight size={16} />
                    </button>
                )}
            </div>
        </div>
    );
}
