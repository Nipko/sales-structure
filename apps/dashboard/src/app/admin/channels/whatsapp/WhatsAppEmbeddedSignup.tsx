"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useEffect, useCallback, useRef } from "react";
import { AlertTriangle, ArrowRight, Monitor, RotateCw } from "lucide-react";
import { guidedTourAnchorId } from "@/lib/guided-tours";
import {
  EMBEDDED_SIGNUP_FINISH_EVENTS,
  EmbeddedSignupSessionData,
  buildEmbeddedSignupLoginOptions,
  extractEmbeddedSignupSessionData,
  getEmbeddedSignupErrorDetails,
  parseEmbeddedSignupEvent,
} from "./embedded-signup-events";

// ============================================
// Types
// ============================================
interface EmbeddedSignupProps {
  tenantId: string;
  mode?: "standard" | "coexistence";
  onSuccess: (data: OnboardingResult) => void;
  /** Plain text for a parent banner. The structured failure is rendered here. */
  onError: (error: string) => void;
}

interface OnboardingResult {
  id: string;
  status: string;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  /** Codes emitted when Meta completed the connection with reservations. */
  warnings?: string[];
}

interface FacebookLoginResponse {
  authResponse?: {
    code?: string;
    business_id?: string | number;
    waba_id?: string | number;
    phone_number_id?: string | number;
  };
  status?: string;
  error?: unknown;
  error_message?: unknown;
  error_description?: unknown;
  message?: unknown;
}

/**
 * A failure the person can act on: what happened, and the one thing to do next.
 *
 * Until now every one of these arrived as raw Spanish prose from the WhatsApp
 * service — untranslated for three of our four locales, and with no next step
 * attached. The service already emits stable codes; this maps them.
 */
interface ConnectFailure {
  /** i18n key under `channels.whatsapp.errors`. */
  key: string;
  /** Server prose, kept as a detail line when it adds something. */
  detail?: string;
  /** Where the fix lives, when it is another screen. */
  href?: string;
  hrefLabelKey?: string;
  retryable: boolean;
}

// ============================================
// WhatsApp Service API base
// ============================================
const WA_SERVICE_URL = process.env.NEXT_PUBLIC_WA_SERVICE_URL || "https://wa.parallly-chat.cloud/api/v1";
const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || "";
const META_CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID || "";
// Solution ID from Meta Business Manager → Partner Center → Solutions
// Required for Tech Provider Embedded Signup
const META_SOLUTION_ID = process.env.NEXT_PUBLIC_META_SOLUTION_ID || "";

/**
 * El vigilante de la ventana de Meta.
 *
 * Meta sólo postea un mensaje al TERMINAR (FINISH/CANCEL/ERROR), así que "no
 * recibimos ninguna señal" NO significa que la ventana no se abrió: significa
 * que la persona sigue adentro eligiendo su portafolio, aceptando términos o
 * esperando el SMS. El único indicio real de que la ventana se abrió es que
 * esta pestaña perdió el foco. El backstop existe sólo para el caso contrario
 * —el popup bloqueado que nunca robó el foco— y por eso comparte exactamente
 * la misma condición que la sonda rápida.
 */
const META_WINDOW_TIMEOUT_MS = 75_000;
const META_WINDOW_FOCUS_PROBE_MS = 4_000;
/** Below this width the Meta flow is genuinely painful; say so before the click. */
const MOBILE_BREAKPOINT_PX = 768;

/** Service code → i18n key. Both prefixed and bare forms are seen in the wild. */
const ERROR_KEY_BY_CODE: Record<string, string> = {
  WA_ES_DUPLICATE_CUSTOMER_BINDING: "onboardingInProgress",
  WHATSAPP_TOKEN_COVERAGE_REQUIRED: "tokenCoverage",
  WHATSAPP_TOKEN_MISSING_WABA_SCOPE: "tokenCoverage",
  PLAN_LIMIT_REACHED: "planLimit",
  CHANNEL_ACCESS_DENIED: "channelNotInPlan",
  CHANNEL_ENTITLEMENT_CHECK_UNAVAILABLE: "entitlementUnavailable",
  WA_ES_CONFIG_INVALID: "invalidConfig",
  WA_ES_PHONE_REGISTRATION_FAILED: "phoneRegistration",
  WA_ES_PERMISSIONS_INSUFFICIENT: "permissions",
  WA_ES_COEXISTENCE_NOT_ACKNOWLEDGED: "coexistenceNotAcknowledged",
  WA_ES_CODE_EXPIRED: "codeExpired",
  WA_ES_RATE_LIMITED: "rateLimited",
  WA_ES_TENANT_NOT_FOUND: "invalidConfig",
};

const RETRYABLE_ERROR_KEYS = new Set([
  "network",
  "onboardingInProgress",
  "entitlementUnavailable",
  "rateLimited",
  "codeExpired",
  "popupBlocked",
  "generic",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readServerErrorCode(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const direct = body.code ?? body.errorCode;
  if (typeof direct === "string" && direct) return direct.toUpperCase();
  // Nest wraps the thrown object under `message` for some exception filters.
  if (isRecord(body.message)) return readServerErrorCode(body.message);
  return null;
}

/**
 * Lo ÚNICO del servidor que se le puede mostrar a una persona.
 *
 * `userMessage` es el campo que el servicio escribe pensado para leerse; el
 * resto no. `message` en un 500 sin mapear de Nest vale literalmente "Internal
 * server error", y así salía impreso bajo la tarjeta ámbar, en inglés, en las
 * cuatro configuraciones de idioma.
 */
function readServerUserMessage(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const direct = body.userMessage;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (isRecord(body.message)) return readServerUserMessage(body.message);
  return undefined;
}

/** Prosa técnica del servidor: sirve para la consola, nunca para la pantalla. */
function readServerDiagnostics(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  for (const candidate of [body.message, body.error]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  if (isRecord(body.message)) return readServerDiagnostics(body.message);
  return undefined;
}

function readOnboardingId(body: unknown): string | null {
  if (!isRecord(body)) return null;
  for (const key of ["onboardingId", "id", "existingOnboardingId"]) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (isRecord(body.message)) return readOnboardingId(body.message);
  return null;
}

/** Map a failed `/onboarding/start` into something with a next step. */
export function mapConnectFailure(status: number, body: unknown): ConnectFailure {
  const code = readServerErrorCode(body);
  const key = (code && ERROR_KEY_BY_CODE[code])
    || (status === 409 ? "onboardingInProgress" : null)
    || (status === 402 || status === 403 ? "channelNotInPlan" : null)
    || "generic";
  const serverRetryable = isRecord(body) && typeof body.retryable === "boolean" ? body.retryable : null;

  return {
    key,
    detail: readServerUserMessage(body),
    href: key === "planLimit" ? "/admin/settings/billing" : undefined,
    hrefLabelKey: key === "planLimit" ? "goToBilling" : undefined,
    retryable: serverRetryable ?? RETRYABLE_ERROR_KEYS.has(key),
  };
}

/** Bounded warning codes; anything else is shown verbatim as the server wrote it. */
export const KNOWN_WHATSAPP_WARNINGS = [
  "business_not_verified",
  "webhook_subscription_failed",
  "phone_registration_deferred",
  "template_sync_failed",
] as const;

export function isKnownWhatsAppWarning(value: string): boolean {
  return (KNOWN_WHATSAPP_WARNINGS as readonly string[]).includes(value);
}

// ============================================
// Component
// ============================================
export default function WhatsAppEmbeddedSignup({ tenantId, mode = "standard", onSuccess, onError }: EmbeddedSignupProps) {
  const tc = useTranslations("common");
  const t = useTranslations("channels.whatsapp");
  const te = useTranslations("channels.whatsapp.errors");
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState<string>("");
  const [failure, setFailure] = useState<ConnectFailure | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  // Fase numérica para el stepper visual (progreso del Embedded Signup).
  const [phase, setPhase] = useState<"" | "exchanging" | "registering" | "done">("");
  // onSuccess suele desmontar este componente (el padre pasa al estado "conectado").
  // Evita setState tras el unmount en el finally del happy path.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  // Use a ref to capture session data from window message (available immediately, no React state delay)
  const sessionDataRef = useRef<EmbeddedSignupSessionData>({});
  const terminalEventRef = useRef<"cancel" | "error" | null>(null);
  const onErrorRef = useRef(onError);
  const tRef = useRef(t);

  // ---- Meta window watchdog ----
  // `launchingRef` mirrors the state so the timers can read it without being
  // re-created on every render (which would restart the clock endlessly).
  const launchingRef = useRef(false);
  const metaSignalRef = useRef(false);
  const focusLostRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearWindowWatchdog = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    launchingRef.current = false;
  }, []);

  useEffect(() => () => clearWindowWatchdog(), [clearWindowWatchdog]);

  useEffect(() => {
    onErrorRef.current = onError;
    tRef.current = t;
  }, [onError, t]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setIsNarrow(window.innerWidth < MOBILE_BREAKPOINT_PX);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  // Losing focus is the proof the Meta window actually opened.
  useEffect(() => {
    const onBlur = () => { focusLostRef.current = true; };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  const reportFailure = useCallback((next: ConnectFailure, plainText: string) => {
    clearWindowWatchdog();
    if (!mountedRef.current) return;
    setFailure(next);
    setLaunching(false);
    setProcessing(false);
    setStep("");
    setPhase("");
    onErrorRef.current(plainText);
  }, [clearWindowWatchdog]);

  // ---- Listen for Embedded Signup session completion messages ----
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
      const embeddedEvent = parseEmbeddedSignupEvent(event.data);
      if (!embeddedEvent) return;
      // Any Meta event proves the window opened: the watchdog must stand down.
      metaSignalRef.current = true;

      if (EMBEDDED_SIGNUP_FINISH_EVENTS.has(embeddedEvent.event)) {
        // Store synchronously so handleFBResponse can include Meta's customer-owned IDs.
        sessionDataRef.current = {
          business_id: embeddedEvent.session.business_id ?? sessionDataRef.current.business_id,
          waba_id: embeddedEvent.session.waba_id ?? sessionDataRef.current.waba_id,
          phone_number_id: embeddedEvent.session.phone_number_id ?? sessionDataRef.current.phone_number_id,
        };
        return;
      }

      if (embeddedEvent.event === "CANCEL") {
        const details = getEmbeddedSignupErrorDetails(embeddedEvent.data);
        terminalEventRef.current = details ? "error" : "cancel";
        reportFailure(
          { key: details ? "metaError" : "cancelled", detail: details ?? undefined, retryable: true },
          details
            ? tRef.current("metaSignupErrorWithDetails", { details })
            : tRef.current("metaSignupCancelled"),
        );
        return;
      }

      if (embeddedEvent.event === "ERROR") {
        terminalEventRef.current = "error";
        const details = getEmbeddedSignupErrorDetails(embeddedEvent.data);
        console.error("[EmbeddedSignup] Signup error event:", embeddedEvent.data);
        reportFailure(
          { key: "metaError", detail: details ?? undefined, retryable: true },
          details
            ? tRef.current("metaSignupErrorWithDetails", { details })
            : tRef.current("metaSignupError"),
        );
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [reportFailure]);

  // ---- Load Facebook SDK ----
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as any).FB) {
      setSdkLoaded(true);
      return;
    }

    let active = true;

    // Define the callback BEFORE loading the script
    (window as any).fbAsyncInit = function () {
      try {
        (window as any).FB.init({
          appId: META_APP_ID,
          autoLogAppEvents: true,
          xfbml: true,
          version: "v25.0",
        });
        if (active) setSdkLoaded(true);
      } catch (error) {
        console.error("[EmbeddedSignup] Facebook SDK initialization failed:", error);
        if (active) onErrorRef.current(tRef.current("facebookSdkLoadError"));
      }
    };

    // Inject SDK script
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      console.error("[EmbeddedSignup] Facebook SDK script failed to load");
      if (active) onErrorRef.current(tRef.current("facebookSdkLoadError"));
    };
    document.body.appendChild(script);

    return () => {
      active = false;
      script.onerror = null;
    };
  }, []);

  // ---- Handle FB.login() response ----
  const handleFBResponse = useCallback(
    (response: FacebookLoginResponse) => {
      const processResponse = async () => {
        // The SDK answered: the window opened, whatever the outcome.
        metaSignalRef.current = true;
        clearWindowWatchdog();

        if (!response.authResponse?.code) {
          const terminalEventAlreadyReported = terminalEventRef.current !== null;
          const details = getEmbeddedSignupErrorDetails(response);
          if (!terminalEventAlreadyReported) {
            reportFailure(
              { key: details ? "metaError" : "authorization", detail: details ?? undefined, retryable: true },
              details
                ? t("metaAuthorizationErrorWithDetails", { details })
                : t("metaAuthorizationError"),
            );
          } else if (mountedRef.current) {
            setLaunching(false);
          }
          terminalEventRef.current = null;
          return;
        }

        const code = response.authResponse.code;
        terminalEventRef.current = null;

        // Extract session info: try authResponse first, then ref from window message (synchronous)
        const authSession = extractEmbeddedSignupSessionData(response.authResponse);
        const sessionPhoneNumberId = authSession.phone_number_id || sessionDataRef.current.phone_number_id || null;
        const sessionWabaId = authSession.waba_id || sessionDataRef.current.waba_id || null;
        const sessionBusinessId = authSession.business_id || sessionDataRef.current.business_id || null;

        // Session IDs may be null — backend does API discovery as fallback.

        setFailure(null);
        setLaunching(false);
        setProcessing(true);
        setStep(t("exchangingCode"));
        setPhase("exchanging");

        try {
          // Get fresh token from API (refresh if needed)
          let token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;

          // Also try to refresh token via API before calling WhatsApp service
          try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";
            const meRes = await fetch(`${apiUrl}/auth/me`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
            });
            if (meRes.ok) {
              const meData = await meRes.json();
              if (meData.token) {
                token = meData.token;
                localStorage.setItem("accessToken", token!);
              }
            }
          } catch {
            // token refresh failed, continue with existing token
          }

          setStep(t("registeringAccount"));
          setPhase("registering");

          const payload = {
            tenantId,
            configId: META_CONFIG_ID,
            code,
            mode: mode === "coexistence" ? "coexistence" : "new",
            source: "embedded_signup",
            coexistenceAcknowledged: mode === "coexistence",
            phoneNumberId: sessionPhoneNumberId,
            wabaId: sessionWabaId,
            businessId: sessionBusinessId,
          };
          const res = await fetch(`${WA_SERVICE_URL}/onboarding/start`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(payload),
          });

          const responseText = await res.text();
          let parsed: unknown = null;
          try { parsed = JSON.parse(responseText); } catch { /* non-JSON body */ }

          if (!res.ok) {
            const mapped = mapConnectFailure(res.status, parsed);
            // "There is already an onboarding in progress" is often a stale row
            // for a connection that finished. Ask the service before telling the
            // person to wait.
            if (mapped.key === "onboardingInProgress") {
              const existingId = readOnboardingId(parsed);
              if (existingId) {
                const settled = await pollExistingOnboarding(existingId, token, setCheckingExisting);
                if (settled) {
                  setStep(t("connectionSuccess"));
                  setPhase("done");
                  onSuccess(settled);
                  return;
                }
              }
            }
            // La prosa cruda del servidor queda en la consola; la persona lee
            // el mensaje mapeado, que sí está traducido y trae el próximo paso.
            console.error("[EmbeddedSignup] onboarding/start failed:", res.status, readServerDiagnostics(parsed) ?? responseText);
            reportFailure(mapped, readServerUserMessage(parsed)
              || t("onboardingRequestError", { status: res.status }));
            return;
          }

          if (!isRecord(parsed)) {
            reportFailure({ key: "generic", retryable: true }, t("invalidOnboardingResponse"));
            return;
          }
          setStep(t("connectionSuccess"));
          setPhase("done");
          onSuccess(readOnboardingResult(parsed));
        } catch (err: unknown) {
          // "Failed to fetch" es el texto del navegador, en inglés y sin
          // significado para quien está intentando conectar su WhatsApp. Va a
          // la consola; en pantalla queda el mensaje traducido con reintento.
          console.error("[EmbeddedSignup] Error:", err);
          reportFailure({ key: "network", retryable: true }, t("connectionRequestFailed"));
        } finally {
          // En éxito el componente ya se desmontó (onSuccess) → no tocar estado.
          if (mountedRef.current) {
            setProcessing(false);
            setStep("");
            setPhase("");
          }
        }
      };

      processResponse();
    },
    [clearWindowWatchdog, mode, onSuccess, reportFailure, t, tc, tenantId],
  );

  // ---- Handle redirect callback (code in URL query params) ----
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      window.history.replaceState({}, "", window.location.pathname);
      handleFBResponse({ authResponse: { code }, status: "connected" });
    }
  }, [handleFBResponse]);

  // ---- Launch Embedded Signup (Popup mode via SDK) ----
  const launchSignup = () => {
    const FB = (window as any).FB;
    if (!FB) {
      reportFailure({ key: "sdkNotLoaded", retryable: true }, t("facebookSdkNotLoaded"));
      return;
    }
    if (!META_APP_ID || !META_CONFIG_ID) {
      reportFailure({ key: "invalidConfig", retryable: false }, t("metaConfigurationMissing"));
      return;
    }

    sessionDataRef.current = {};
    terminalEventRef.current = null;
    metaSignalRef.current = false;
    focusLostRef.current = false;
    setFailure(null);
    setLaunching(true);
    launchingRef.current = true;

    // Un popup bloqueado nunca roba el foco y nunca postea un mensaje. Sin esto
    // el botón se quedaba en "Esperando autorización…" para siempre y la única
    // salida era recargar la página.
    //
    // La condición es SIEMPRE la misma: si la ventana llegó a abrirse
    // (perdimos el foco) o Meta ya nos habló, no hay nada que abortar. El
    // backstop de 75 s no la miraba, así que a cualquiera que tardara más de
    // eso dentro de Meta —elegir portafolio, aceptar términos, esperar el
    // código por SMS— se le reseteaba el botón por detrás y le aparecía una
    // tarjeta de "permití las ventanas emergentes" mientras seguía adentro.
    const windowNeverOpened = () => !focusLostRef.current && !metaSignalRef.current;
    const giveUp = () => {
      if (!launchingRef.current || !windowNeverOpened()) return;
      reportFailure({ key: "popupBlocked", retryable: true }, t("facebookSdkLaunchError"));
    };
    // Los dos relojes comparten la MISMA condición a propósito: el corto la
    // evalúa apenas se pierde la oportunidad de robar el foco, el largo es el
    // tope para el mismo caso. Ninguno puede fallar hacia "popup bloqueado"
    // mientras la persona esté trabajando dentro de la ventana de Meta.
    timersRef.current = [
      setTimeout(giveUp, META_WINDOW_FOCUS_PROBE_MS),
      setTimeout(giveUp, META_WINDOW_TIMEOUT_MS),
    ];

    const loginOptions = buildEmbeddedSignupLoginOptions(META_CONFIG_ID, META_SOLUTION_ID, mode);

    try {
      FB.login(handleFBResponse, loginOptions);
    } catch (error) {
      console.error("[EmbeddedSignup] Facebook SDK login failed:", error);
      reportFailure({ key: "popupBlocked", retryable: true }, t("facebookSdkLaunchError"));
    }
  };

  // ---- Render ----
  const busy = launching || processing || checkingExisting;

  return (
    <div className="relative">
      {isNarrow && !busy && (
        <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50 p-3 dark:border-sky-500/25 dark:bg-sky-500/10">
          <Monitor size={14} className="mt-0.5 shrink-0 text-sky-600 dark:text-sky-400" />
          <p className="text-[12px] leading-relaxed text-sky-800 dark:text-sky-300">{t("mobileNote")}</p>
        </div>
      )}

      <button
        id={guidedTourAnchorId("whatsapp-connect")}
        onClick={launchSignup}
        disabled={!sdkLoaded || busy}
        className={`w-full py-3.5 px-6 rounded-xl border-none text-white font-bold text-[15px] flex items-center justify-center gap-3 shadow-[0_4px_14px_rgba(24,119,242,0.3)] transition-all ${
          processing
            ? "bg-gradient-to-br from-[#1565c0] to-[#1877F2]"
            : "bg-gradient-to-br from-[#1877F2] to-[#42a5f5]"
        } ${!sdkLoaded ? "opacity-50 cursor-not-allowed" : sdkLoaded && !busy ? "cursor-pointer hover:shadow-[0_6px_20px_rgba(24,119,242,0.4)]" : "cursor-not-allowed"}`}
      >
        {/* Facebook "f" logo */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>

        {!sdkLoaded
          ? tc("loading")
          : checkingExisting
            ? te("checkingExisting")
            : launching
              ? t("waitingAuth")
              : processing
                ? step || tc("loading")
                : t("connectButton")}
      </button>

      {/* Progreso visual del Embedded Signup — visible mientras se autoriza/conecta */}
      {(launching || processing) && (() => {
        const stage = phase === "done" ? 3 : phase === "registering" ? 2 : phase === "exchanging" ? 1 : 0;
        const steps = [t("esuProgress.auth"), t("esuProgress.connecting"), t("esuProgress.activating")];
        return (
          <div className="mt-4 flex items-center justify-between gap-1.5">
            {steps.map((label, i) => {
              const done = stage > i;
              const active = stage === i;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                  <div className="flex items-center w-full">
                    <div className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : done || active ? "bg-emerald-500" : "bg-neutral-300 dark:bg-white/15"}`} />
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold ${
                      done ? "bg-emerald-500 text-white"
                        : active ? "bg-[#1877F2] text-white"
                        : "bg-neutral-200 dark:bg-white/10 text-neutral-400"
                    }`}>
                      {done ? "✓" : active ? <span className="w-2.5 h-2.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : i + 1}
                    </div>
                    <div className={`h-0.5 flex-1 ${i === steps.length - 1 ? "opacity-0" : done ? "bg-emerald-500" : "bg-neutral-300 dark:bg-white/15"}`} />
                  </div>
                  <span className={`text-[10px] text-center leading-tight ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })()}

      {failure && !busy && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">{te(`${failure.key}.title`)}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">{te(`${failure.key}.action`)}</p>
              {failure.detail && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-amber-700/80 dark:text-amber-400/70">{failure.detail}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {failure.retryable && (
                  <button
                    type="button"
                    onClick={launchSignup}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-amber-700"
                  >
                    <RotateCw size={13} /> {te("retry")}
                  </button>
                )}
                {failure.href && failure.hrefLabelKey && (
                  <Link
                    href={failure.href}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/60 px-3 py-2 text-[12px] font-semibold text-amber-800 transition-colors hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/10"
                  >
                    {te(failure.hrefLabelKey)} <ArrowRight size={13} />
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-[var(--text-secondary)] text-center leading-relaxed">
        {t("securityNote")}
      </p>
    </div>
  );
}

function readOnboardingResult(parsed: Record<string, unknown>): OnboardingResult {
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((warning): warning is string => typeof warning === "string" && warning.trim().length > 0)
    : [];
  return {
    id: typeof parsed.id === "string" ? parsed.id : "",
    status: typeof parsed.status === "string" ? parsed.status : "",
    wabaId: typeof parsed.wabaId === "string" ? parsed.wabaId : undefined,
    phoneNumberId: typeof parsed.phoneNumberId === "string" ? parsed.phoneNumberId : undefined,
    displayPhoneNumber: typeof parsed.displayPhoneNumber === "string" ? parsed.displayPhoneNumber : undefined,
    verifiedName: typeof parsed.verifiedName === "string" ? parsed.verifiedName : undefined,
    warnings,
  };
}

/**
 * A 409 means another attempt for this tenant is still on record. Ask that
 * record whether it finished before telling the person to come back later.
 */
async function pollExistingOnboarding(
  onboardingId: string,
  token: string | null,
  setChecking: (value: boolean) => void,
): Promise<OnboardingResult | null> {
  setChecking(true);
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await fetch(`${WA_SERVICE_URL}/onboarding/${encodeURIComponent(onboardingId)}/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      const body: unknown = await res.json().catch(() => null);
      if (!isRecord(body)) return null;
      const status = typeof body.status === "string" ? body.status.toUpperCase() : "";
      if (status.startsWith("COMPLETED")) return readOnboardingResult({ ...body, id: onboardingId });
      if (status === "FAILED" || status === "CANCELLED") return null;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return null;
  } catch {
    return null;
  } finally {
    setChecking(false);
  }
}
