"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, X } from "lucide-react";
import { api, type ResourceRental } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * El conductor, el depósito, el contrato, la jaula y el grupo de patio.
 *
 * Todo esto vivía —cuando vivía— suelto en `metadata`, sin forma declarada y
 * sin pantalla: el negocio lo anotaba en un cuaderno o no lo anotaba. Nada de
 * lo de acá necesita un proveedor externo.
 *
 * Lo que NO está, a propósito: cobrar el depósito (eso es el riel de pagos, con
 * sus propias puertas), firmar el contrato con validez legal (necesita un
 * proveedor certificado) y la medicación de la mascota (es dato clínico y vive
 * en su registro, con su nivel de acceso).
 */

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";
const labelCls = "block text-[11px] font-semibold text-muted-foreground mb-1";

export function RentalDetailsDialog({
    tenantId,
    rental,
    onClose,
    onSaved,
}: {
    tenantId: string;
    rental: ResourceRental;
    onClose: () => void;
    onSaved: () => void;
}) {
    const t = useTranslations("resourceRentals.details");
    const tc = useTranslations("common");
    const isBoarding = rental.rental_type === "pet_boarding";
    const current = rental.metadata?.details || {};

    const [form, setForm] = useState<Record<string, any>>({
        driverName: current.driver?.name || "",
        licenseNumber: current.driver?.licenseNumber || "",
        licenseExpiresAt: current.driver?.licenseExpiresAt || "",
        depositAmount: current.deposit ? String(current.deposit.amountCents / 100) : "",
        depositCurrency: current.deposit?.currency || "",
        depositStatus: current.deposit?.status || "pending",
        withheldReason: current.deposit?.withheldReason || "",
        contractUrl: current.contract?.documentUrl || "",
        contractSigned: current.contract?.signed === true,
        odometerOut: current.odometerOut != null ? String(current.odometerOut) : "",
        odometerIn: current.odometerIn != null ? String(current.odometerIn) : "",
        unitLabel: current.unitLabel || "",
        compatibility: current.compatibility || "",
        groupLabel: current.groupLabel || "",
        mealsPerDay: current.mealsPerDay != null ? String(current.mealsPerDay) : "",
        belongings: (current.belongings || []).join(", "),
    });
    const [busy, setBusy] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);

    const set = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));

    function buildPayload(): Record<string, unknown> {
        if (isBoarding) {
            const payload: Record<string, unknown> = {};
            if (form.unitLabel) payload.unitLabel = form.unitLabel;
            if (form.compatibility) payload.compatibility = form.compatibility;
            if (form.groupLabel) payload.groupLabel = form.groupLabel;
            if (form.mealsPerDay !== "") payload.mealsPerDay = Number(form.mealsPerDay);
            if (form.belongings.trim()) {
                payload.belongings = form.belongings.split(",").map((s: string) => s.trim()).filter(Boolean);
            }
            return payload;
        }
        const payload: Record<string, unknown> = {};
        if (form.driverName) {
            payload.driver = {
                name: form.driverName,
                ...(form.licenseNumber ? { licenseNumber: form.licenseNumber } : {}),
                ...(form.licenseExpiresAt ? { licenseExpiresAt: form.licenseExpiresAt } : {}),
            };
        }
        if (form.depositAmount !== "") {
            payload.deposit = {
                // Se envía en centavos: guardar un decimal es cómo un depósito
                // de 50.000 se vuelve 50.000,01 después de dos redondeos.
                amountCents: Math.round(Number(form.depositAmount) * 100),
                currency: form.depositCurrency,
                status: form.depositStatus,
                ...(form.withheldReason ? { withheldReason: form.withheldReason } : {}),
            };
        }
        if (form.contractUrl || form.contractSigned) {
            payload.contract = {
                signed: form.contractSigned,
                ...(form.contractUrl ? { documentUrl: form.contractUrl } : {}),
                ...(form.contractSigned ? { signedAt: new Date().toISOString() } : {}),
            };
        }
        if (form.odometerOut !== "") payload.odometerOut = Number(form.odometerOut);
        if (form.odometerIn !== "") payload.odometerIn = Number(form.odometerIn);
        return payload;
    }

    async function save() {
        setBusy(true);
        setErrors([]);
        try {
            const res: any = await api.updateResourceRentalDetails(tenantId, rental.id, buildPayload());
            if (res?.success) { onSaved(); onClose(); return; }
            // El backend devuelve los motivos, uno por campo. Mostrarlos todos
            // es la diferencia entre corregir y adivinar.
            const detail = res?.details || res?.error?.details;
            setErrors(Array.isArray(detail) ? detail : [res?.error || t("saveFailed")]);
        } catch (e: any) {
            setErrors([e?.message || t("saveFailed")]);
        }
        setBusy(false);
    }

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60" onClick={onClose}>
            <div
                onClick={(e) => e.stopPropagation()}
                className="max-h-[90vh] w-[34rem] overflow-y-auto rounded-[20px] border border-border bg-card p-6"
            >
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-foreground">
                        {isBoarding ? t("boardingTitle") : t("rentalTitle")}
                    </h2>
                    <button onClick={onClose} className="text-muted-foreground"><X size={18} /></button>
                </div>

                {errors.length > 0 && (
                    <ul className="mb-4 space-y-1 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-[12px] text-red-600 dark:text-red-400">
                        {errors.map((error) => <li key={error}>{error}</li>)}
                    </ul>
                )}

                <div className="grid grid-cols-2 gap-3">
                    {isBoarding ? (
                        <>
                            <div>
                                <label className={labelCls}>{t("unitLabel")}</label>
                                <input className={inputCls} value={form.unitLabel}
                                    onChange={(e) => set("unitLabel", e.target.value)} />
                            </div>
                            <div>
                                <label className={labelCls}>{t("compatibility")}</label>
                                <select className={inputCls} value={form.compatibility}
                                    onChange={(e) => set("compatibility", e.target.value)}>
                                    <option value="">{t("notSet")}</option>
                                    <option value="social">{t("compatibility_social")}</option>
                                    <option value="group_only">{t("compatibility_group_only")}</option>
                                    <option value="solo">{t("compatibility_solo")}</option>
                                </select>
                            </div>
                            {/* Sólo cuando aplica: pedir el grupo a un perro que
                                va solo es ruido, y el backend lo exige
                                justamente cuando es `group_only`. */}
                            {form.compatibility === "group_only" && (
                                <div className="col-span-2">
                                    <label className={labelCls}>{t("groupLabel")}</label>
                                    <input className={inputCls} value={form.groupLabel}
                                        onChange={(e) => set("groupLabel", e.target.value)} />
                                </div>
                            )}
                            <div>
                                <label className={labelCls}>{t("mealsPerDay")}</label>
                                <input type="number" min={0} max={10} className={inputCls} value={form.mealsPerDay}
                                    onChange={(e) => set("mealsPerDay", e.target.value)} />
                            </div>
                            <div className="col-span-2">
                                <label className={labelCls}>{t("belongings")}</label>
                                <input className={inputCls} value={form.belongings}
                                    placeholder={t("belongingsHint")}
                                    onChange={(e) => set("belongings", e.target.value)} />
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="col-span-2">
                                <label className={labelCls}>{t("driverName")}</label>
                                <input className={inputCls} value={form.driverName}
                                    onChange={(e) => set("driverName", e.target.value)} />
                            </div>
                            <div>
                                <label className={labelCls}>{t("licenseNumber")}</label>
                                <input className={inputCls} value={form.licenseNumber}
                                    onChange={(e) => set("licenseNumber", e.target.value)} />
                            </div>
                            <div>
                                <label className={labelCls}>{t("licenseExpiresAt")}</label>
                                <input type="date" className={inputCls} value={form.licenseExpiresAt}
                                    onChange={(e) => set("licenseExpiresAt", e.target.value)} />
                            </div>
                            <div>
                                <label className={labelCls}>{t("depositAmount")}</label>
                                <input type="number" min={0} className={inputCls} value={form.depositAmount}
                                    onChange={(e) => set("depositAmount", e.target.value)} />
                            </div>
                            <div>
                                <label className={labelCls}>{t("depositCurrency")}</label>
                                <input className={inputCls} value={form.depositCurrency} maxLength={3}
                                    placeholder={t("currencyHint")}
                                    onChange={(e) => set("depositCurrency", e.target.value.toUpperCase())} />
                            </div>
                            <div>
                                <label className={labelCls}>{t("depositStatus")}</label>
                                <select className={inputCls} value={form.depositStatus}
                                    onChange={(e) => set("depositStatus", e.target.value)}>
                                    <option value="pending">{t("deposit_pending")}</option>
                                    <option value="held">{t("deposit_held")}</option>
                                    <option value="returned">{t("deposit_returned")}</option>
                                    <option value="withheld">{t("deposit_withheld")}</option>
                                </select>
                            </div>
                            {/* Retener plata sin motivo escrito es el reclamo del
                                mes que viene sin nada con qué contestarlo. */}
                            {form.depositStatus === "withheld" && (
                                <div className="col-span-2">
                                    <label className={labelCls}>{t("withheldReason")}</label>
                                    <input className={inputCls} value={form.withheldReason}
                                        onChange={(e) => set("withheldReason", e.target.value)} />
                                </div>
                            )}
                            <div>
                                <label className={labelCls}>{t("odometerOut")}</label>
                                <input type="number" min={0} className={inputCls} value={form.odometerOut}
                                    onChange={(e) => set("odometerOut", e.target.value)} />
                            </div>
                            <div>
                                <label className={labelCls}>{t("odometerIn")}</label>
                                <input type="number" min={0} className={inputCls} value={form.odometerIn}
                                    onChange={(e) => set("odometerIn", e.target.value)} />
                            </div>
                            <div className="col-span-2">
                                <label className={labelCls}>{t("contractUrl")}</label>
                                <input className={inputCls} value={form.contractUrl}
                                    placeholder="https://…"
                                    onChange={(e) => set("contractUrl", e.target.value)} />
                            </div>
                            <label className="col-span-2 flex items-center gap-2 text-[13px] text-foreground">
                                <input type="checkbox" checked={form.contractSigned}
                                    onChange={(e) => set("contractSigned", e.target.checked)} />
                                {t("contractSigned")}
                            </label>
                        </>
                    )}
                </div>

                <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground">
                        {tc("cancel")}
                    </button>
                    <button onClick={save} disabled={busy}
                        className={cn(
                            "inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white",
                            busy && "opacity-60",
                        )}>
                        {busy && <Loader2 size={15} className="animate-spin" />}
                        {tc("save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
