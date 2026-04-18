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
          onError("No se recibió código de autorización de Meta. El usuario canceló el flujo o hubo un error.");
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
        setStep("Intercambiando código con Meta...");

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

          setStep("Registrando cuenta de WhatsApp Business...");

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
          setStep("¡Conexión exitosa!");
          console.log("[EmbeddedSignup] Onboarding complete:", result);
          onSuccess(result);
        } catch (err: any) {
          console.error("[EmbeddedSignup] Error:", err);
          onError(err.message || "Error al procesar el onboarding");
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
      onError("Facebook SDK no cargado");
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

  // ---- Launch Embedded Signup (Direct redirect — no SDK popup) ----
  const launchRedirect = () => {
    const redirectUri = encodeURIComponent(window.location.origin + "/admin/channels/whatsapp");
    const extras = encodeURIComponent(JSON.stringify({
      setup: {
        ...(META_SOLUTION_ID ? { solutionID: META_SOLUTION_ID } : {}),
        ...(META_BUSINESS_ID ? { business_id: META_BUSINESS_ID } : {}),
      },
      featureType: "whatsapp_business_app_onboarding",
      sessionInfoVersion: "3",
      version: "v4",
    }));

    const url = `https://www.facebook.com/v25.0/dialog/oauth`
      + `?client_id=${META_APP_ID}`
      + `&config_id=${META_CONFIG_ID}`
      + `&redirect_uri=${redirectUri}`
      + `&response_type=code`
      + `&override_default_response_type=true`
      + `&display=popup`
      + `&extras=${extras}`;

    console.log("[EmbeddedSignup] Redirect URL:", url);
    window.open(url, "_blank", "width=800,height=700");
  };

  // ---- Render ----
  return (
    <div style={{ position: "relative" }}>
      {/* Main CTA Button */}
      <button
        onClick={launchSignup}
        disabled={!sdkLoaded || launching || processing}
        style={{
          width: "100%",
          padding: "14px 24px",
          borderRadius: 12,
          border: "none",
          background: processing
            ? "linear-gradient(135deg, #1a8d48, #128C7E)"
            : "linear-gradient(135deg, #25D366, #128C7E)",
          color: "white",
          fontWeight: 700,
          fontSize: 15,
          cursor: sdkLoaded && !launching && !processing ? "pointer" : "not-allowed",
          opacity: !sdkLoaded ? 0.5 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          boxShadow: "0 4px 14px rgba(37, 211, 102, 0.3)",
          transition: "all 0.2s ease",
        }}
      >
        {/* WhatsApp Icon */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>

        {!sdkLoaded
          ? "Cargando SDK de Meta..."
          : launching
            ? "Esperando autorización..."
            : processing
              ? step || "Procesando..."
              : "Conectar con WhatsApp Embedded Signup"}
      </button>

      {/* Alternative: Direct redirect (bypasses SDK popup issues) */}
      <button
        onClick={launchRedirect}
        disabled={processing}
        style={{
          width: "100%",
          marginTop: 10,
          padding: "10px 20px",
          borderRadius: 10,
          border: "1px solid var(--border, #2a2a45)",
          background: "transparent",
          color: "var(--text-primary, #e8e8f0)",
          fontWeight: 600,
          fontSize: 13,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          opacity: processing ? 0.5 : 1,
        }}
      >
        Método alternativo (si el botón anterior no funciona)
      </button>

      {/* Subtle info text */}
      <p
        style={{
          marginTop: 10,
          fontSize: 12,
          color: "var(--text-secondary)",
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        Se abrirá una ventana de Meta para que autorices tu cuenta de WhatsApp Business.
        <br />
        Tus credenciales son cifradas con AES-256 y nunca se almacenan en texto plano.
      </p>
    </div>
  );
}
