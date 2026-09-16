"use client";
import { useState } from 'react';
import { parsePlanMoney } from '@/lib/plan-money-input';

export function PlanMoneyInput({ cents, locale, label, errorLabel, onValue, onValidity, className }: {
    cents?: number; locale: string; label: string; errorLabel: string; className?: string;
    onValue: (cents: number) => void; onValidity: (valid: boolean) => void;
}) {
    const [raw, setRaw] = useState(() => Number.isSafeInteger(cents)
        ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(cents! / 100) : '');
    const [invalid, setInvalid] = useState(false);
    return <><input type="text" inputMode="decimal" aria-label={label} aria-invalid={invalid}
        className={className} value={raw} onChange={event => {
            const text = event.target.value;
            setRaw(text);
            const parsed = parsePlanMoney(text, locale);
            setInvalid(parsed === null); onValidity(parsed !== null);
            if (parsed !== null) onValue(parsed);
        }} />{invalid && <span role="alert" className="block text-xs text-red-600">{errorLabel}</span>}</>;
}
