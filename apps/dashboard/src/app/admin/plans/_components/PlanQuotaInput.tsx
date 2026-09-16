"use client";
import { useState } from 'react';

/**
 * Un entero de cuota del plan, con su propio texto.
 *
 * El camino viejo era `parseInt(e.target.value) || 0`: seleccionar todo y
 * borrar para retipear deja `NaN`, `|| 0` lo vuelve 0 al instante, y guardar en
 * ese estado escribe un 0 real. En la mayoría de los campos eso es una cuota
 * en cero; en `llmHardBudgetUsdCents` es «apagá la IA de este plan ahora».
 *
 * No se reutiliza `PlanMoneyInput` a propósito: `parsePlanMoney` rechaza los
 * negativos, y `-1` es el centinela documentado de «sin límite» en todo el
 * registro de features. Un campo que no puede escribir -1 vuelve irrepresentable
 * el plan `custom`.
 */
export function PlanQuotaInput({ value, label, errorLabel, onValue, onValidity, className }: {
    value?: number; label: string; errorLabel: string; className?: string;
    onValue: (value: number) => void; onValidity: (valid: boolean) => void;
}) {
    const [raw, setRaw] = useState(() => Number.isSafeInteger(value) ? String(value) : '');
    const [invalid, setInvalid] = useState(false);
    return <><input type="text" inputMode="numeric" aria-label={label} aria-invalid={invalid}
        className={className} value={raw} onChange={event => {
            const text = event.target.value;
            setRaw(text);
            const parsed = parsePlanQuota(text);
            setInvalid(parsed === null); onValidity(parsed !== null);
            if (parsed !== null) onValue(parsed);
        }} />{invalid && <span role="alert" className="block text-xs text-red-600">{errorLabel}</span>}</>;
}

/** Entero >= -1, o `null` si el texto no lo es. Vacío NO es cero. */
export function parsePlanQuota(text: string): number | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (!/^-?\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < -1) return null;
    return parsed;
}
