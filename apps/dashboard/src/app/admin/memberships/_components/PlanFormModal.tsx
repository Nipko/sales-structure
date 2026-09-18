"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2, Save, X } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { useOperatingCurrency } from "@/hooks/useOperatingCurrency";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    effectivePlanPriceStatus,
    initialPlanPriceForm,
    planPriceErrorKey,
    planPriceFormProblem,
    planPricePayload,
    type MembershipPlan,
    type PlanPriceForm,
} from "../plan-price";

interface PlanFormModalProps {
    plan: MembershipPlan | null;
    /** Opened from "Escribir precio": the cursor starts on the amount. */
    focusPrice?: boolean;
    onClose: () => void;
    onSaved: () => void;
}

/**
 * Create or edit a membership plan, price status included (D10).
 *
 * The price has the same explicit choices as a service — "Precio
 * confirmado", "Es gratis" and "Se cotiza según el caso" — and the same rule
 * about the rest: a recipe's example stays an example until the owner presses
 * a choice or types another amount. Saving the plan's credits must not confirm
 * a price nobody looked at, and a 0 is free only when the owner says so.
 */
export function PlanFormModal({ plan, focusPrice = false, onClose, onSaved }: PlanFormModalProps) {
    const operatingCurrency = useOperatingCurrency();
    const t = useTranslations("memberships");
    const ta = useTranslations("appointments");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const [form, setForm] = useState({
        name: plan?.name || "",
        description: plan?.description || "",
        durationDays: plan?.duration_days?.toString() || "30",
        // La moneda del negocio, no un literal. `|| "COP"` le ponia pesos
        // colombianos al primer precio que cargaba un tenant mexicano, y esa
        // moneda queda GUARDADA con el registro: el agente despues se la dice
        // al cliente. No era un default de presentacion, era una decision
        // comercial tomada por el codigo.
        currency: plan?.currency || operatingCurrency || "",
        classCreditsPerPeriod: plan?.class_credits_per_period?.toString() || "",
        personalTrainingCredits: plan?.personal_training_credits?.toString() || "0",
        guestPasses: plan?.guest_passes?.toString() || "0",
        freezeAllowanceDays: plan?.freeze_allowance_days?.toString() || "0",
    });
    // The row as it arrived: what "untouched" means for an example price. A
    // placeholder 0 opens as an empty field, never as a "0" to confirm.
    const initialPrice = useMemo(() => initialPlanPriceForm(plan), [plan]);
    const [priceForm, setPriceForm] = useState<PlanPriceForm>(initialPrice);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const priceStatus = effectivePlanPriceStatus(priceForm, initialPrice);
    const priceProblem = planPriceFormProblem(priceForm, initialPrice);
    const quoted = priceStatus === "quote";
    const free = priceStatus === "free";
    // "Se cotiza" and "Es gratis" have no number to type.
    const locked = quoted || free;
    const priceHint = quoted
        ? t("planPrice.quoteHint")
        : free
            ? t("planPrice.freeHint")
            : priceProblem === "amountRequired"
                ? t("planPrice.confirmNeedsAmount")
                : priceProblem === "amountInvalid"
                    ? t("planPrice.errors.priceInvalid")
                    : priceStatus === "example"
                        ? (initialPrice.price ? ta("priceStatus.exampleHint") : t("planPrice.missingHint"))
                        : null;
    const hintIsProblem = priceProblem !== null && !locked;
    const canSave = !busy && !!form.name.trim() && !!form.durationDays && priceProblem === null;

    // "Escribir precio" opens the editor to write one thing: the amount.
    const priceInputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (focusPrice) priceInputRef.current?.focus();
    }, [focusPrice]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [busy, onClose]);

    async function handleSubmit() {
        if (!activeTenantId || !canSave) return;
        setBusy(true);
        setError(null);
        const payload = {
            name: form.name.trim(),
            description: form.description || undefined,
            durationDays: parseInt(form.durationDays, 10),
            ...planPricePayload(priceForm, initialPrice),
            // Cuando el negocio no declaro donde opera, el hook contesta
            // honestamente "no se" y aca NO se manda nada: el API resuelve o
            // deja NULL. Mandar "" era peor que no mandar, porque del otro
            // lado la cadena vacia volvia a ser COP.
            currency: form.currency || undefined,
            classCreditsPerPeriod: form.classCreditsPerPeriod ? parseInt(form.classCreditsPerPeriod, 10) : null,
            personalTrainingCredits: parseInt(form.personalTrainingCredits, 10),
            guestPasses: parseInt(form.guestPasses, 10),
            freezeAllowanceDays: parseInt(form.freezeAllowanceDays, 10),
        };
        try {
            const res = plan
                ? await api.updateMembershipPlan(activeTenantId, plan.id, payload)
                : await api.createMembershipPlan(activeTenantId, payload);
            // Before, a refusal closed the modal as if it had saved: the owner
            // corrected the price, saw the list, and the agent kept quiet.
            if (!res?.success) {
                const key = planPriceErrorKey(res?.errorCode);
                setError(key ? t(`planPrice.errors.${key}`) : res?.error || tc("errorSaving"));
                return;
            }
            onSaved();
        } catch {
            setError(tc("connectionError"));
        } finally {
            setBusy(false);
        }
    }

    const inputCls = "w-full bg-card border border-border rounded-lg px-2 py-1.5 text-sm";

    return (
        // A click on the backdrop itself closes; Escape is handled above.
        <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="plan-form-title"
                className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
            >
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <h3 id="plan-form-title" className="text-base font-semibold">{plan ? t("editPlan") : t("newPlan")}</h3>
                    <button type="button" onClick={onClose} aria-label={tc("close")} className="p-1 hover:bg-muted rounded">
                        <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                </div>
                <div className="p-5 space-y-3">
                    {error && (
                        <p role="alert" className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-px" aria-hidden="true" />
                            <span>{error}</span>
                        </p>
                    )}
                    <div>
                        <label htmlFor="plan-name" className="block text-sm font-medium mb-1">{t("planName")}</label>
                        <input id="plan-name" type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                        <label htmlFor="plan-description" className="block text-sm font-medium mb-1">{t("planDescription")}</label>
                        <textarea id="plan-description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label htmlFor="plan-duration" className="block text-xs font-medium mb-1">{t("durationDays")}</label>
                            <input id="plan-duration" type="number" min={1} value={form.durationDays} onChange={e => setForm({ ...form, durationDays: e.target.value })} className={inputCls} />
                        </div>
                        <div className="col-span-2">
                            <label htmlFor="plan-price" className="block text-xs font-medium mb-1">{t("price")}</label>
                            {/* "Se cotiza" never shows a number, not even the one the row keeps, and "Es gratis" has none to type. */}
                            <div className="flex gap-1">
                                <input
                                    id="plan-price"
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    inputMode="decimal"
                                    disabled={locked}
                                    value={locked ? "" : priceForm.price}
                                    placeholder={locked ? "—" : undefined}
                                    ref={priceInputRef}
                                    aria-invalid={hintIsProblem || undefined}
                                    aria-describedby={priceHint ? "plan-price-hint" : undefined}
                                    onChange={e => setPriceForm({ ...priceForm, price: e.target.value })}
                                    className="flex-1 min-w-0 bg-card border border-border rounded-lg px-2 py-1.5 text-sm disabled:opacity-50"
                                />
                                <input
                                    type="text"
                                    aria-label={t("planPrice.currency")}
                                    value={form.currency}
                                    onChange={e => setForm({ ...form, currency: e.target.value })}
                                    className="w-20 bg-card border border-border rounded-lg px-2 py-1.5 text-sm font-mono"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Estado del precio (D10): el mismo par que un servicio. Un
                        precio de ejemplo del rubro no se dice hasta que el dueño
                        lo confirme; "se cotiza" es que nunca se dice un número. */}
                    <div>
                        <span id="plan-price-status-label" className="block text-xs font-medium mb-1.5">{ta("priceStatus.label")}</span>
                        <div
                            role="group"
                            aria-labelledby="plan-price-status-label"
                            aria-describedby={priceHint ? "plan-price-hint" : undefined}
                            className="flex flex-wrap gap-2"
                        >
                            {(["confirmed", "free", "quote"] as const).map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    aria-pressed={priceStatus === value}
                                    onClick={() => setPriceForm({ ...priceForm, priceStatus: value })}
                                    className={cn(
                                        "px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition-colors",
                                        priceStatus === value
                                            ? "bg-emerald-600 text-white border-emerald-600"
                                            : "bg-muted/30 text-foreground border-border hover:bg-muted",
                                    )}
                                >
                                    {ta(`priceStatus.${value}`)}
                                </button>
                            ))}
                        </div>
                        {priceHint && (
                            <p
                                id="plan-price-hint"
                                className={cn(
                                    "text-xs mt-1.5",
                                    hintIsProblem || priceStatus === "example"
                                        ? "text-amber-700 dark:text-amber-300"
                                        : "text-muted-foreground",
                                )}
                            >
                                {priceHint}
                            </p>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label htmlFor="plan-class-credits" className="block text-xs font-medium mb-1">{t("classCreditsPlaceholder")}</label>
                            <input id="plan-class-credits" type="number" placeholder={t("emptyForUnlimited")} value={form.classCreditsPerPeriod} onChange={e => setForm({ ...form, classCreditsPerPeriod: e.target.value })} className={inputCls} />
                        </div>
                        <div>
                            <label htmlFor="plan-pt-credits" className="block text-xs font-medium mb-1">{t("ptCreditsLabel")}</label>
                            <input id="plan-pt-credits" type="number" value={form.personalTrainingCredits} onChange={e => setForm({ ...form, personalTrainingCredits: e.target.value })} className={inputCls} />
                        </div>
                        <div>
                            <label htmlFor="plan-guest-passes" className="block text-xs font-medium mb-1">{t("guestPassesLabel")}</label>
                            <input id="plan-guest-passes" type="number" value={form.guestPasses} onChange={e => setForm({ ...form, guestPasses: e.target.value })} className={inputCls} />
                        </div>
                        <div>
                            <label htmlFor="plan-freeze-days" className="block text-xs font-medium mb-1">{t("freezeAllowanceLabel")}</label>
                            <input id="plan-freeze-days" type="number" value={form.freezeAllowanceDays} onChange={e => setForm({ ...form, freezeAllowanceDays: e.target.value })} className={inputCls} />
                        </div>
                    </div>
                </div>
                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button type="button" onClick={onClose} className="px-3 py-1.5 bg-muted/30 hover:bg-muted text-foreground border border-border rounded-lg text-sm transition-colors">{tc("cancel")}</button>
                    <button type="button" onClick={() => void handleSubmit()} disabled={!canSave} className="inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                        {tc("save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
