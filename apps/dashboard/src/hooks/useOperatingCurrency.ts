"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";

/**
 * La moneda en la que este negocio cobra.
 *
 * Quince pantallas escribían `item?.currency || "COP"` como valor inicial de un
 * formulario de precio. Un negocio mexicano cargando su primer plato, su primer
 * plan o su primera propiedad le ponía **pesos colombianos** sin verlo — y el
 * precio queda guardado con esa moneda, así que el agente después se lo dice al
 * cliente en COP. El literal no era un default de presentación: era una
 * decisión comercial tomada por el código.
 *
 * Sale del perfil regional, que ya sabe distinguir lo que el dueño declaró de
 * lo que se dedujo del país. Mientras carga devuelve `null` en vez de una
 * moneda provisional: pintar COP "un ratito" es exactamente cómo se guardaba
 * antes, porque el dueño puede apretar Guardar en ese ratito.
 */
export function useOperatingCurrency(): string | null {
    const { activeTenantId } = useTenant();
    const { user } = useAuth();
    const [currency, setCurrency] = useState<string | null>(null);

    const tenantId = activeTenantId || user?.tenantId;

    useEffect(() => {
        let cancelled = false;
        if (!tenantId) { setCurrency(null); return; }
        (async () => {
            try {
                const res: any = await api.getRegionalProfile(tenantId);
                if (!cancelled && res?.success) {
                    const resolved = res.data?.operatingCurrency;
                    // `fallback` significa "nadie lo dijo, así que asumimos
                    // Colombia". El servidor ya dejó de escribir esa moneda en
                    // la base por eso mismo; la pantalla tiene que hacer lo
                    // mismo o el dueño ve COP justo en las filas que el backend
                    // guardó sin moneda, y cree que ya está elegida.
                    const guessed = resolved?.source === 'fallback'
                        || (resolved?.source === 'derived' && res.data?.operatingCountry?.source === 'fallback');
                    setCurrency(guessed ? null : (resolved?.value || null));
                }
            } catch {
                // Sin respuesta no se inventa una moneda: la pantalla deja el
                // campo sin elegir y el dueño la pone.
                if (!cancelled) setCurrency(null);
            }
        })();
        return () => { cancelled = true; };
    }, [tenantId]);

    return currency;
}
