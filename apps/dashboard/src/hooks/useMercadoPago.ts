"use client";

import { useEffect, useState } from "react";

/**
 * Lazy-loads the MercadoPago v2 browser SDK and returns a ready-to-use
 * `mp` instance initialised with NEXT_PUBLIC_MP_PUBLIC_KEY.
 *
 * The SDK ships as a script tag rather than npm because MP rotates the
 * hosted bundle and the script picks up PCI-compliance updates without a
 * dashboard redeploy. We inject it once per session and cache the instance
 * on window so multiple components calling the hook share the same init.
 *
 * Usage:
 *   const { mp, ready, error } = useMercadoPago();
 *   if (!ready) return <Spinner />;
 *   mp.fields.create({...})
 *
 * Returns `error` when the public key env is missing — caller should render
 * a "billing unavailable" state and log so the founder knows to set it.
 */
const SCRIPT_URL = "https://sdk.mercadopago.com/js/v2";
const SCRIPT_ID = "mercadopago-sdk-v2";

declare global {
    interface Window {
        MercadoPago?: any;
        __parallextMpInstance?: any;
    }
}

export interface UseMercadoPagoResult {
    mp: any | null;
    ready: boolean;
    error: string | null;
}

export function useMercadoPago(): UseMercadoPagoResult {
    const [state, setState] = useState<UseMercadoPagoResult>({
        mp: null,
        ready: false,
        error: null,
    });

    useEffect(() => {
        if (typeof window === "undefined") return;

        const publicKey = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY;
        if (!publicKey) {
            setState({ mp: null, ready: false, error: "mp_public_key_missing" });
            return;
        }

        // If the instance is already initialised, reuse it
        if (window.__parallextMpInstance) {
            setState({ mp: window.__parallextMpInstance, ready: true, error: null });
            return;
        }

        const initFromGlobal = () => {
            if (!window.MercadoPago) {
                setState({ mp: null, ready: false, error: "mp_sdk_not_loaded" });
                return;
            }
            try {
                const mp = new window.MercadoPago(publicKey, { locale: "es-CO" });
                window.__parallextMpInstance = mp;
                setState({ mp, ready: true, error: null });
            } catch (e: any) {
                setState({ mp: null, ready: false, error: e?.message || "mp_init_failed" });
            }
        };

        if (window.MercadoPago) {
            initFromGlobal();
            return;
        }

        const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
        if (existing) {
            existing.addEventListener("load", initFromGlobal, { once: true });
            return;
        }

        const script = document.createElement("script");
        script.id = SCRIPT_ID;
        script.src = SCRIPT_URL;
        script.async = true;
        script.onload = initFromGlobal;
        script.onerror = () => setState({ mp: null, ready: false, error: "mp_sdk_load_failed" });
        document.head.appendChild(script);
    }, []);

    return state;
}
