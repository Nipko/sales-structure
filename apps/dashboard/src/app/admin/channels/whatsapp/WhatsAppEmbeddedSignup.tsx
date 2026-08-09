"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback, useRef } from "react";
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
  onError: (error: string) => void;
}

interface OnboardingResult {
  id: string;
  status: string;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
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

// ============================================
// WhatsApp Service API base
// ============================================
const WA_SERVICE_URL = process.env.NEXT_PUBLIC_WA_SERVICE_URL || "https://wa.parallly-chat.cloud/api/v1";
const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || "";
const META_CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID || "";
// Solution ID from Meta Business Manager → Partner Center → Solutions
// Required for Tech Provider Embedded Signup
const META_SOLUTION_ID = process.env.NEXT_PUBLIC_META_SOLUTION_ID || "";

// ============================================
// Component
// ============================================
export default function WhatsAppEmbeddedSignup({ tenantId, mode = "standard", onSuccess, onError }: EmbeddedSignupProps) {
  const tc = useTranslations("common");
  const t = useTranslations("channels.whatsapp");
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState<string>("");
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

  useEffect(() => {
    onErrorRef.current = onError;
    tRef.current = t;
  }, [onError, t]);

  // ---- Listen for Embedded Signup session completion messages ----
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
      const embeddedEvent = parseEmbeddedSignupEvent(event.data);
      if (!embeddedEvent) return;

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
        setLaunching(false);
        setProcessing(false);
        setStep("");
        setPhase("");
        onErrorRef.current(
          details
            ? tRef.current("metaSignupErrorWithDetails", { details })
            : tRef.current("metaSignupCancelled"),
        );
        return;
      }

      if (embeddedEvent.event === "ERROR") {
        terminalEventRef.current = "error";
        setLaunching(false);
        setProcessing(false);
        setStep("");
        setPhase("");
        const details = getEmbeddedSignupErrorDetails(embeddedEvent.data);
        console.error("[EmbeddedSignup] Signup error event:", embeddedEvent.data);
        onErrorRef.current(
          details
            ? tRef.current("metaSignupErrorWithDetails", { details })
            : tRef.current("metaSignupError"),
        );
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

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
        if (!response.authResponse?.code) {
          const terminalEventAlreadyReported = terminalEventRef.current !== null;
          const details = getEmbeddedSignupErrorDetails(response);
          if (!terminalEventAlreadyReported) {
            onError(
              details
                ? t("metaAuthorizationErrorWithDetails", { details })
                : t("metaAuthorizationError"),
            );
          }
          terminalEventRef.current = null;
          setLaunching(false);
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

          if (!res.ok) {
            let errorData: any = {};
            try { errorData = JSON.parse(responseText); } catch {}
            throw new Error(
              errorData.userMessage
              || errorData.message
              || t("onboardingRequestError", { status: res.status }),
            );
          }

          let result: OnboardingResult;
          try {
            result = JSON.parse(responseText) as OnboardingResult;
          } catch {
            throw new Error(t("invalidOnboardingResponse"));
          }
          setStep(t("connectionSuccess"));
          setPhase("done");
          onSuccess(result);
        } catch (err: unknown) {
          console.error("[EmbeddedSignup] Error:", err);
          onError(err instanceof Error ? err.message : tc("errorSaving"));
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
    [mode, onError, onSuccess, t, tc, tenantId],
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
      onError(t("facebookSdkNotLoaded"));
      return;
    }
    if (!META_APP_ID || !META_CONFIG_ID) {
      onError(t("metaConfigurationMissing"));
      return;
    }

    sessionDataRef.current = {};
    terminalEventRef.current = null;
    setLaunching(true);

    const loginOptions = buildEmbeddedSignupLoginOptions(META_CONFIG_ID, META_SOLUTION_ID, mode);

    try {
      FB.login(handleFBResponse, loginOptions);
    } catch (error) {
      console.error("[EmbeddedSignup] Facebook SDK login failed:", error);
      setLaunching(false);
      onError(t("facebookSdkLaunchError"));
    }
  };

  // ---- Render ----
  return (
    <div className="relative">
      <button
        onClick={launchSignup}
        disabled={!sdkLoaded || launching || processing}
        className={`w-full py-3.5 px-6 rounded-xl border-none text-white font-bold text-[15px] flex items-center justify-center gap-3 shadow-[0_4px_14px_rgba(24,119,242,0.3)] transition-all ${
          processing
            ? "bg-gradient-to-br from-[#1565c0] to-[#1877F2]"
            : "bg-gradient-to-br from-[#1877F2] to-[#42a5f5]"
        } ${!sdkLoaded ? "opacity-50 cursor-not-allowed" : sdkLoaded && !launching && !processing ? "cursor-pointer hover:shadow-[0_6px_20px_rgba(24,119,242,0.4)]" : "cursor-not-allowed"}`}
      >
        {/* Facebook "f" logo */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>

        {!sdkLoaded
          ? tc("loading")
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

      <p className="mt-3 text-xs text-[var(--text-secondary)] text-center leading-relaxed">
        {t("securityNote")}
      </p>
    </div>
  );
}
