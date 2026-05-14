"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect, useCallback, useRef } from "react";

// ============================================
// Types
// ============================================
interface EmbeddedSignupProps {
  tenantId: string;
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

// ============================================
// WhatsApp Service API base
// ============================================
const WA_SERVICE_URL = process.env.NEXT_PUBLIC_WA_SERVICE_URL || "https://wa.parallly-chat.cloud/api/v1";
const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || "";
const META_CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID || "";
// Solution ID from Meta Business Manager → Partner Center → Solutions
// Required for Tech Provider Embedded Signup
const META_SOLUTION_ID = process.env.NEXT_PUBLIC_META_SOLUTION_ID || "";
// Your Tech Provider Business ID from Meta Business Manager
const META_BUSINESS_ID = process.env.NEXT_PUBLIC_META_BUSINESS_ID || "";

// ============================================
// Component
// ============================================
export default function WhatsAppEmbeddedSignup({ tenantId, onSuccess, onError }: EmbeddedSignupProps) {
    const tc = useTranslations("common");
    const t = useTranslations("channels.whatsapp");
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState<string>("");
  // Use a ref to capture session data from window message (available immediately, no React state delay)
  const sessionDataRef = useRef<{ waba_id?: string; phone_number_id?: string }>({});

  // ---- Listen for Embedded Signup session completion messages ----
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        console.log("[EmbeddedSignup] Window message received:", data);
        if (data.type === "WA_EMBEDDED_SIGNUP") {
          if (data.event === "FINISH" || data.event === "FINISH_ONLY_WABA") {
            console.log("[EmbeddedSignup] Signup FINISH event:", data.data);
            // Store in ref (synchronous, available immediately for handleFBResponse)
            sessionDataRef.current = {
              waba_id: data.data?.waba_id,
              phone_number_id: data.data?.phone_number_id,
            };
          } else if (data.event === "CANCEL") {
            console.log("[EmbeddedSignup] User cancelled signup");
          } else if (data.event === "ERROR") {
            console.error("[EmbeddedSignup] Signup error event:", data.data);
          }
        }
      } catch {
        // Not JSON or not relevant
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

    // Define the callback BEFORE loading the script
    (window as any).fbAsyncInit = function () {
      (window as any).FB.init({
        appId: META_APP_ID,
        autoLogAppEvents: true,
        xfbml: true,
        version: "v25.0",
      });
      setSdkLoaded(true);
    };

    // Inject SDK script
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    document.body.appendChild(script);

    return () => {
      // Cleanup (optional — SDK persists)
    };
  }, []);

  // ---- Handle FB.login() response ----
  const handleFBResponse = useCallback(
    (response: any) => {
      const processResponse = async () => {
        console.log("[EmbeddedSignup] FB.login() raw response:", JSON.stringify(response, null, 2));
        console.log("[EmbeddedSignup] authResponse:", response.authResponse);
        console.log("[EmbeddedSignup] status:", response.status);

        if (!response.authResponse?.code) {
          console.error("[EmbeddedSignup] No auth code received. Full response:", response);
          onError("Authorization code not received from Meta. The user cancelled or an error occurred.");
          setLaunching(false);
          return;
        }

        const code = response.authResponse.code;
        console.log("[EmbeddedSignup] Auth code received:", code.substring(0, 20) + "...");

        // Extract session info: try authResponse first, then ref from window message (synchronous)
        const sessionPhoneNumberId = response.authResponse.phone_number_id || sessionDataRef.current.phone_number_id || null;
        const sessionWabaId = response.authResponse.waba_id || sessionDataRef.current.waba_id || null;

        if (!sessionPhoneNumberId || !sessionWabaId) {
          console.warn(
            "[EmbeddedSignup] Session info missing from authResponse. " +
            "phone_number_id:", sessionPhoneNumberId,
            "waba_id:", sessionWabaId,
            "— backend will attempt API discovery as fallback.",
          );
        } else {
          console.log(
            "[EmbeddedSignup] Session info captured. phone_number_id:",
            sessionPhoneNumberId, "waba_id:", sessionWabaId,
          );
        }

        setLaunching(false);
        setProcessing(true);
        setStep(t("exchangingCode"));

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
                console.log("[EmbeddedSignup] Token refreshed successfully");
              }
            }
          } catch {
            console.warn("[EmbeddedSignup] Token refresh failed, using existing token");
          }

          setStep(t("registeringAccount"));

          const payload = {
            tenantId,
            configId: META_CONFIG_ID,
            code,
            mode: "new",
            source: "embedded_signup",
            coexistenceAcknowledged: false,
            phoneNumberId: sessionPhoneNumberId,
            wabaId: sessionWabaId,
          };
          console.log("[EmbeddedSignup] Sending to backend:", `${WA_SERVICE_URL}/onboarding/start`);
          console.log("[EmbeddedSignup] Payload:", JSON.stringify(payload, null, 2));

          const res = await fetch(`${WA_SERVICE_URL}/onboarding/start`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(payload),
          });

          const responseText = await res.text();
          console.log("[EmbeddedSignup] Backend response status:", res.status);
          console.log("[EmbeddedSignup] Backend response body:", responseText);

          if (!res.ok) {
            let errorData: any = {};
            try { errorData = JSON.parse(responseText); } catch {}
            throw new Error(errorData.userMessage || errorData.message || `Error ${res.status}`);
          }

          const result = JSON.parse(responseText);
          setStep(t("connectionSuccess"));
          console.log("[EmbeddedSignup] Onboarding complete:", result);
          onSuccess(result);
        } catch (err: any) {
          console.error("[EmbeddedSignup] Error:", err);
          onError(err.message || tc("errorSaving"));
        } finally {
          setProcessing(false);
          setStep("");
        }
      };
      
      processResponse();
    },
    [tenantId, onSuccess, onError],
  );

  // ---- Handle redirect callback (code in URL query params) ----
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      console.log("[EmbeddedSignup] Redirect callback detected with code:", code.substring(0, 20) + "...");
      window.history.replaceState({}, "", window.location.pathname);
      handleFBResponse({ authResponse: { code }, status: "connected" });
    }
  }, [handleFBResponse]);

  // ---- Launch Embedded Signup (Popup mode via SDK) ----
  const launchSignup = () => {
    const FB = (window as any).FB;
    if (!FB) {
      onError("Facebook SDK not loaded");
      return;
    }

    setLaunching(true);

    const loginOptions = {
      config_id: META_CONFIG_ID,
      response_type: "code",
      override_default_response_type: true,
      extras: {
        setup: {
          ...(META_SOLUTION_ID ? { solutionID: META_SOLUTION_ID } : {}),
          ...(META_BUSINESS_ID ? { business_id: META_BUSINESS_ID } : {}),
        },
        featureType: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3",
        version: "v4",
      },
    };

    console.log("[EmbeddedSignup] Launching FB.login() with options:", JSON.stringify(loginOptions, null, 2));
    console.log("[EmbeddedSignup] META_APP_ID:", META_APP_ID);
    console.log("[EmbeddedSignup] META_CONFIG_ID:", META_CONFIG_ID);

    FB.login(handleFBResponse, loginOptions);
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

      <p className="mt-3 text-xs text-[var(--text-secondary)] text-center leading-relaxed">
        {t("securityNote")}
      </p>
    </div>
  );
}
