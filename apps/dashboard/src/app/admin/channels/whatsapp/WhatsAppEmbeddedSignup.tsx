"use client";

import { useState, useEffect, useCallback } from "react";

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

// ============================================
// Component
// ============================================
export default function WhatsAppEmbeddedSignup({ tenantId, onSuccess, onError }: EmbeddedSignupProps) {
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState<string>("");

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
        version: "v21.0",
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
        if (!response.authResponse?.code) {
          onError("No se recibió código de autorización de Meta. El usuario canceló el flujo o hubo un error.");
          setLaunching(false);
          return;
        }

        const code = response.authResponse.code;

        // Extract session info from Embedded Signup v4 (sessionInfoVersion: "3")
        // These may not be present with older SDK versions or certain Meta configurations
        const sessionPhoneNumberId = response.authResponse.phone_number_id || null;
        const sessionWabaId = response.authResponse.waba_id || null;

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
          const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;

          setStep("Registrando cuenta de WhatsApp Business...");

          const res = await fetch(`${WA_SERVICE_URL}/onboarding/start`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              tenantId,
              configId: META_CONFIG_ID,
              code,
              mode: "new",
              source: "embedded_signup",
              coexistenceAcknowledged: false,
              // Session info from Embedded Signup v4
              phoneNumberId: sessionPhoneNumberId,
              wabaId: sessionWabaId,
            }),
          });

          if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.userMessage || errorData.message || `Error ${res.status}`);
          }

          const result = await res.json();
          setStep("¡Conexión exitosa!");
          onSuccess(result);
        } catch (err: any) {
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

  // ---- Launch Embedded Signup ----
  const launchSignup = () => {
    const FB = (window as any).FB;
    if (!FB) {
      onError("Facebook SDK no cargado");
      return;
    }

    setLaunching(true);

    FB.login(
      handleFBResponse,
      {
        config_id: META_CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "",
          sessionInfoVersion: "3",
        },
      },
    );
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
