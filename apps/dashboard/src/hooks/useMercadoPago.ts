"use client";

import { useEffect, useState } from "react";

const SCRIPT_URL = "https://sdk.mercadopago.com/js/v2";
const SCRIPT_ID = "mercadopago-sdk-v2";

declare global {
    interface Window {
        MercadoPago?: any;
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

        const init = () => {
            if (!window.MercadoPago) {
                setState({ mp: null, ready: false, error: "mp_sdk_not_loaded" });
                return;
            }
            try {
                const mp = new window.MercadoPago(publicKey, { locale: "es-CO" });
                setState({ mp, ready: true, error: null });
            } catch (e: any) {
                setState({ mp: null, ready: false, error: e?.message || "mp_init_failed" });
            }
        };

        if (window.MercadoPago) {
            init();
            return;
        }

        const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
        if (existing) {
            existing.addEventListener("load", init, { once: true });
            return;
        }

        const script = document.createElement("script");
        script.id = SCRIPT_ID;
        script.src = SCRIPT_URL;
        script.async = true;
        script.onload = init;
        script.onerror = () => setState({ mp: null, ready: false, error: "mp_sdk_load_failed" });
        document.head.appendChild(script);
    }, []);

    return state;
}
