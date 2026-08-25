"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, ImagePlus, Loader2, ShieldCheck, X } from "lucide-react";
import {
    api,
    type RentalEligibilityDimension,
    type RentalEligibilityStatus,
    type ResourceRental,
} from "@/lib/api";
import { useOperatingCurrency } from "@/hooks/useOperatingCurrency";
import { cn } from "@/lib/utils";

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";
const labelCls = "mb-1 block text-[11px] font-semibold text-muted-foreground";
const ELIGIBILITY: readonly RentalEligibilityDimension[] = ["identity", "driverLicense", "insurance", "payment"];

function ids(value: string): string[] {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function apiErrors(response: any, fallback: string): string[] {
    const detail = response?.details || response?.error?.details;
    if (Array.isArray(detail)) return detail.map(String);
    const message = response?.message || response?.error?.message || response?.error;
    return [typeof message === "string" ? message : fallback];
}

function EvidenceUpload({
    tenantId,
    rentalId,
    value,
    onChange,
    label,
    uploadLabel,
    uploadingLabel,
    countLabel,
    removeLabel,
    failedLabel,
}: {
    tenantId: string;
    rentalId: string;
    value: string[];
    onChange: (next: string[]) => void;
    label: string;
    uploadLabel: string;
    uploadingLabel: string;
    countLabel: (count: number) => string;
    removeLabel: string;
    failedLabel: string;
}) {
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState("");

    async function upload(files: FileList | null) {
        if (!files?.length) return;
        setUploading(true);
        setUploadError("");
        const uploaded: string[] = [];
        try {
            for (const file of Array.from(files)) {
                if (!file.type.startsWith("image/")) {
                    setUploadError(failedLabel);
                    continue;
                }
                const response: any = await api.uploadMedia(tenantId, file, "resource_rental", rentalId);
                const id = response?.data?.id;
                if (!response?.success || typeof id !== "string") {
                    setUploadError(response?.error || failedLabel);
                    continue;
                }
                uploaded.push(id);
            }
            if (uploaded.length) onChange(Array.from(new Set([...value, ...uploaded])));
        } catch {
            setUploadError(failedLabel);
        } finally {
            setUploading(false);
        }
    }

    return (
        <div className="sm:col-span-2">
            <span className={labelCls}>{label}</span>
            <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                    {uploading ? uploadingLabel : uploadLabel}
                    <input
                        className="sr-only"
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={uploading}
                        onChange={(event) => { void upload(event.target.files); event.target.value = ""; }}
                    />
                </label>
                <span className="text-xs text-muted-foreground">{countLabel(value.length)}</span>
            </div>
            {uploadError && <p className="mt-1 text-xs text-red-600">{uploadError}</p>}
            {value.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                    {value.map((id, index) => (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 font-mono text-[11px]">
                            {id.slice(0, 8)}
                            <button type="button" aria-label={`${removeLabel} ${index + 1}`} onClick={() => onChange(value.filter((item) => item !== id))}>
                                <X className="h-3 w-3" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

export function RentalDetailsDialog({
    tenantId,
    rental,
    canReview,
    onClose,
    onSaved,
}: {
    tenantId: string;
    rental: ResourceRental;
    canReview: boolean;
    onClose: () => void;
    onSaved: () => void;
}) {
    const t = useTranslations("resourceRentals.details");
    const tc = useTranslations("common");
    const operatingCurrency = useOperatingCurrency();
    const [record, setRecord] = useState<ResourceRental>(rental);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [errors, setErrors] = useState<string[]>([]);
    const [form, setForm] = useState<Record<string, any>>({});
    const [reviews, setReviews] = useState<Record<string, { status: RentalEligibilityStatus; evidenceRef: string; reason: string }>>({});
    const [rejectReason, setRejectReason] = useState("");
    const [inspection, setInspection] = useState({ odometer: "", fuel: "", notes: "", media: "", method: "manual", evidence: "" });
    const [damage, setDamage] = useState({ description: "", amount: "", currency: "", media: "" });

    const isBoarding = record.rental_type === "pet_boarding";
    const current = record.metadata?.details || {};
    const eligibilityReady = ELIGIBILITY.every((dimension) =>
        ["verified", "not_required"].includes(reviews[dimension]?.status));

    const hydrate = useCallback((next: ResourceRental) => {
        const details = next.metadata?.details || {};
        setRecord(next);
        setForm({
            driverName: details.driver?.name || "",
            driverPhone: details.driver?.phone || "",
            declaredAge: details.driver?.declaredAge != null ? String(details.driver.declaredAge) : "",
            licenseNumber: details.driver?.licenseNumber || "",
            licenseExpiresAt: details.driver?.licenseExpiresAt || "",
            licenseCountry: details.driver?.licenseCountry || "",
            licenseClass: details.driver?.licenseClass || "",
            pickupLocation: details.pickup?.location || "",
            returnLocation: details.dropoff?.location || "",
            extras: (details.extras || []).join(", "),
            depositAmount: details.deposit ? String(details.deposit.amountCents / 100) : "",
            depositCurrency: details.deposit?.currency || operatingCurrency || "",
            depositStatus: details.deposit?.status || "pending",
            depositEvidence: details.deposit?.evidenceRef || "",
            withheldReason: details.deposit?.withheldReason || "",
            contractUrl: details.contract?.documentUrl || "",
            contractSigned: details.contract?.signed === true,
            signatureMethod: details.contract?.signatureMethod || "manual",
            signatureEvidence: details.contract?.evidenceRef || "",
            unitLabel: details.unitLabel || "",
            compatibility: details.compatibility || "",
            groupLabel: details.groupLabel || "",
            mealsPerDay: details.mealsPerDay != null ? String(details.mealsPerDay) : "",
            belongings: (details.belongings || []).join(", "),
        });
        const eligibility = details.eligibility;
        setReviews(Object.fromEntries(ELIGIBILITY.map((dimension) => [dimension, {
            status: eligibility?.[dimension]?.status || "pending",
            evidenceRef: eligibility?.[dimension]?.evidenceRef || "",
            reason: eligibility?.[dimension]?.reason || "",
        }])));
        setDamage((value) => ({ ...value, currency: value.currency || operatingCurrency || "" }));
    }, [operatingCurrency]);

    const reload = useCallback(async () => {
        setLoading(true);
        const response = await api.getResourceRental(tenantId, rental.id);
        if (response.success && response.data) hydrate(response.data);
        else setErrors(apiErrors(response, t("loadFailed")));
        setLoading(false);
    }, [hydrate, rental.id, t, tenantId]);

    useEffect(() => { void reload(); }, [reload]);

    const set = (key: string, value: any) => setForm((valueMap) => ({ ...valueMap, [key]: value }));

    async function perform(key: string, operation: () => Promise<any>, close = false): Promise<boolean> {
        setBusy(key);
        setErrors([]);
        try {
            const response = await operation();
            if (!response?.success) {
                setErrors(apiErrors(response, t("saveFailed")));
                return false;
            }
            onSaved();
            if (close) onClose();
            else await reload();
            return true;
        } catch (error: any) {
            setErrors([error?.message || t("saveFailed")]);
            return false;
        } finally {
            setBusy(null);
        }
    }

    function detailsPayload(): Record<string, unknown> {
        if (isBoarding) {
            return {
                expectedVersion: record.version,
                ...(form.unitLabel ? { unitLabel: form.unitLabel } : {}),
                ...(form.compatibility ? { compatibility: form.compatibility } : {}),
                ...(form.groupLabel ? { groupLabel: form.groupLabel } : {}),
                ...(form.mealsPerDay !== "" ? { mealsPerDay: Number(form.mealsPerDay) } : {}),
                ...(form.belongings.trim() ? { belongings: ids(form.belongings) } : {}),
            };
        }
        const payload: Record<string, unknown> = {
            expectedVersion: record.version,
            driver: {
                name: form.driverName,
                ...(form.driverPhone ? { phone: form.driverPhone } : {}),
                ...(form.declaredAge !== "" ? { declaredAge: Number(form.declaredAge) } : {}),
                ...(form.licenseNumber ? { licenseNumber: form.licenseNumber } : {}),
                ...(form.licenseExpiresAt ? { licenseExpiresAt: form.licenseExpiresAt } : {}),
                ...(form.licenseCountry ? { licenseCountry: form.licenseCountry } : {}),
                ...(form.licenseClass ? { licenseClass: form.licenseClass } : {}),
            },
            ...(form.pickupLocation ? { pickup: { location: form.pickupLocation } } : {}),
            ...(form.returnLocation ? { dropoff: { location: form.returnLocation } } : {}),
            ...(form.extras.trim() ? { extras: ids(form.extras) } : {}),
        };
        if (canReview && form.depositAmount !== "") {
            payload.deposit = {
                amountCents: Math.round(Number(form.depositAmount) * 100),
                currency: form.depositCurrency,
                status: form.depositStatus,
                ...(form.depositEvidence ? { evidenceRef: form.depositEvidence } : {}),
                ...(form.withheldReason ? { withheldReason: form.withheldReason } : {}),
            };
        }
        if (canReview && (form.contractUrl || form.contractSigned)) {
            payload.contract = {
                signed: form.contractSigned,
                ...(form.contractUrl ? { documentUrl: form.contractUrl } : {}),
                ...(form.contractSigned ? {
                    signedAt: current.contract?.signedAt || new Date().toISOString(),
                    signatureMethod: form.signatureMethod,
                    evidenceRef: form.signatureEvidence,
                } : {}),
            };
        }
        return payload;
    }

    async function review(dimension: RentalEligibilityDimension) {
        const value = reviews[dimension];
        await perform(`review-${dimension}`, () => api.reviewResourceRentalEligibility(tenantId, record.id, {
            dimension,
            status: value.status,
            evidenceRef: value.evidenceRef || undefined,
            reason: value.reason || undefined,
            expectedVersion: record.version,
        }));
    }

    async function recordInspection() {
        const inspectionType = record.status === "reserved" ? "pickup" : "return";
        const success = await perform("inspection", () => api.recordResourceRentalInspection(tenantId, record.id, {
            inspectionType,
            odometer: Number(inspection.odometer),
            fuelPercent: inspection.fuel === "" ? undefined : Number(inspection.fuel),
            conditionNotes: inspection.notes,
            mediaIds: ids(inspection.media),
            handoffMethod: inspection.method as "otp" | "signature" | "manual",
            handoffEvidenceRef: inspection.evidence,
            expectedVersion: record.version,
        }));
        if (success) setInspection({ odometer: "", fuel: "", notes: "", media: "", method: "manual", evidence: "" });
    }

    async function reportDamage() {
        const success = await perform("damage", () => api.reportResourceRentalDamage(tenantId, record.id, {
            description: damage.description,
            amountCents: damage.amount === "" ? undefined : Math.round(Number(damage.amount) * 100),
            currency: damage.amount === "" ? undefined : damage.currency,
            mediaIds: ids(damage.media),
        }));
        if (success) setDamage({ description: "", amount: "", currency: operatingCurrency || "", media: "" });
    }

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div onClick={(event) => event.stopPropagation()} className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-[20px] border border-border bg-card p-6">
                <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-lg font-semibold text-foreground">{isBoarding ? t("boardingTitle") : t("rentalTitle")}</h2>
                        <p className="text-xs text-muted-foreground">{t("lifecycle", { status: t(`status.${record.status}`), version: record.version || 1 })}</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label={tc("close")} className="text-muted-foreground"><X size={18} /></button>
                </div>

                {errors.length > 0 && <ul className="mb-4 space-y-1 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
                {loading ? <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}</div> : (
                    <div className="space-y-6">
                        <section className="rounded-xl border border-border p-4">
                            <h3 className="mb-3 font-semibold">{t(isBoarding ? "careData" : "driverAndDocuments")}</h3>
                            <div className="grid gap-3 sm:grid-cols-2">
                                {isBoarding ? <BoardingFields t={t} form={form} set={set} /> : <VehicleFields t={t} form={form} set={set} canReview={canReview} />}
                            </div>
                            <div className="mt-4 flex justify-end">
                                <button type="button" onClick={() => void perform("details", () => api.updateResourceRentalDetails(tenantId, record.id, detailsPayload()))} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                                    {busy === "details" && <Loader2 size={15} className="animate-spin" />} {tc("save")}
                                </button>
                            </div>
                        </section>

                        {!isBoarding && canReview && record.status === "pending_review" && (
                            <section className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4">
                                <h3 className="mb-1 flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> {t("eligibilityTitle")}</h3>
                                <p className="mb-3 text-xs text-muted-foreground">{t("eligibilityHelp")}</p>
                                <div className="space-y-3">
                                    {ELIGIBILITY.map((dimension) => {
                                        const value = reviews[dimension] || { status: "pending", evidenceRef: "", reason: "" };
                                        return <div key={dimension} className="grid gap-2 rounded-lg border border-border bg-card p-3 md:grid-cols-[10rem_9rem_1fr_1fr_auto]">
                                            <div className="self-center text-sm font-medium">{t(`eligibility.${dimension}`)}</div>
                                            <select className={inputCls} value={value.status} onChange={(event) => setReviews((map) => ({ ...map, [dimension]: { ...value, status: event.target.value as RentalEligibilityStatus } }))}>
                                                {(["pending", "verified", "rejected", "not_required"] as const).map((status) => <option key={status} value={status}>{t(`eligibilityStatus.${status}`)}</option>)}
                                            </select>
                                            <input className={inputCls} value={value.evidenceRef} placeholder={t("evidenceRef")} onChange={(event) => setReviews((map) => ({ ...map, [dimension]: { ...value, evidenceRef: event.target.value } }))} />
                                            <input className={inputCls} value={value.reason} placeholder={t("reviewReason")} onChange={(event) => setReviews((map) => ({ ...map, [dimension]: { ...value, reason: event.target.value } }))} />
                                            <button type="button" onClick={() => void review(dimension)} disabled={busy !== null} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50">{busy === `review-${dimension}` ? "…" : tc("save")}</button>
                                        </div>;
                                    })}
                                </div>
                                <div className="mt-4 flex flex-wrap justify-end gap-2">
                                    <input className={cn(inputCls, "max-w-sm")} value={rejectReason} placeholder={t("rejectReason")} onChange={(event) => setRejectReason(event.target.value)} />
                                    <button type="button" onClick={() => void perform("reject", () => api.rejectResourceRental(tenantId, record.id, { expectedVersion: record.version, reason: rejectReason }))} disabled={busy !== null || !rejectReason.trim()} className="rounded-lg border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-50">{t("reject")}</button>
                                    <button type="button" onClick={() => void perform("approve", () => api.approveResourceRental(tenantId, record.id, record.version))} disabled={busy !== null || !eligibilityReady} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> {t("approve")}</button>
                                </div>
                            </section>
                        )}

                        {!isBoarding && ["reserved", "picked_up"].includes(record.status) && (
                            <section className="rounded-xl border border-border p-4">
                                <h3 className="mb-1 font-semibold">{t(record.status === "reserved" ? "pickupInspection" : "returnInspection")}</h3>
                                <p className="mb-3 text-xs text-muted-foreground">{t("inspectionHelp")}</p>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label={t("odometer")}><input required type="number" min={0} className={inputCls} value={inspection.odometer} onChange={(event) => setInspection((value) => ({ ...value, odometer: event.target.value }))} /></Field>
                                    <Field label={t("fuelPercent")}><input type="number" min={0} max={100} className={inputCls} value={inspection.fuel} onChange={(event) => setInspection((value) => ({ ...value, fuel: event.target.value }))} /></Field>
                                    <Field label={t("handoffMethod")}><select className={inputCls} value={inspection.method} onChange={(event) => setInspection((value) => ({ ...value, method: event.target.value }))}>{["manual", "otp", "signature"].map((method) => <option key={method} value={method}>{t(`handoff.${method}`)}</option>)}</select></Field>
                                    <Field label={t("handoffEvidence")}><input className={inputCls} value={inspection.evidence} onChange={(event) => setInspection((value) => ({ ...value, evidence: event.target.value }))} /></Field>
                                    <Field label={t("conditionNotes")} wide><textarea rows={2} className={inputCls} value={inspection.notes} onChange={(event) => setInspection((value) => ({ ...value, notes: event.target.value }))} /></Field>
                                    <EvidenceUpload tenantId={tenantId} rentalId={record.id} value={ids(inspection.media)} onChange={(media) => setInspection((value) => ({ ...value, media: media.join(",") }))} label={t("inspectionPhotos")} uploadLabel={t("uploadEvidence")} uploadingLabel={t("uploadingEvidence")} countLabel={(count) => t("evidenceCount", { count })} removeLabel={t("removeEvidence")} failedLabel={t("uploadFailed")} />
                                </div>
                                <div className="mt-4 flex justify-end"><button type="button" onClick={() => void recordInspection()} disabled={busy !== null || !inspection.odometer || !inspection.notes.trim() || !inspection.evidence.trim() || ids(inspection.media).length === 0} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t("recordInspection")}</button></div>
                            </section>
                        )}

                        {!isBoarding && ["picked_up", "returned"].includes(record.status) && (
                            <section className="rounded-xl border border-border p-4">
                                <h3 className="mb-3 font-semibold">{t("damageTitle")}</h3>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label={t("damageDescription")} wide><textarea rows={2} className={inputCls} value={damage.description} onChange={(event) => setDamage((value) => ({ ...value, description: event.target.value }))} /></Field>
                                    <Field label={t("damageAmount")}><input type="number" min={0} className={inputCls} value={damage.amount} onChange={(event) => setDamage((value) => ({ ...value, amount: event.target.value }))} /></Field>
                                    <Field label={t("depositCurrency")}><input maxLength={3} className={inputCls} value={damage.currency} onChange={(event) => setDamage((value) => ({ ...value, currency: event.target.value.toUpperCase() }))} /></Field>
                                    <EvidenceUpload tenantId={tenantId} rentalId={record.id} value={ids(damage.media)} onChange={(media) => setDamage((value) => ({ ...value, media: media.join(",") }))} label={t("damagePhotos")} uploadLabel={t("uploadEvidence")} uploadingLabel={t("uploadingEvidence")} countLabel={(count) => t("evidenceCount", { count })} removeLabel={t("removeEvidence")} failedLabel={t("uploadFailed")} />
                                </div>
                                <div className="mt-4 flex justify-end"><button type="button" onClick={() => void reportDamage()} disabled={busy !== null || !damage.description.trim() || (!!damage.amount && !damage.currency)} className="rounded-lg border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-50">{t("reportDamage")}</button></div>
                            </section>
                        )}

                        {!isBoarding && ((record.inspections?.length || 0) > 0 || (record.damages?.length || 0) > 0 || (record.events?.length || 0) > 0) && (
                            <section className="grid gap-4 lg:grid-cols-2">
                                <History title={t("inspectionsTitle")} empty={t("noInspections")} items={(record.inspections || []).map((item) => ({ id: item.id, title: t(`inspectionType.${item.inspection_type}`), detail: `${item.odometer} km · ${item.condition_notes}` }))} />
                                <History title={t("damagesTitle")} empty={t("noDamages")} items={(record.damages || []).map((item) => ({ id: item.id, title: t(`damageStatus.${item.status}`), detail: item.description }))} />
                                <div className="lg:col-span-2"><History title={t("historyTitle")} empty={t("noHistory")} items={(record.events || []).map((item) => ({ id: item.id, title: item.event_type, detail: new Date(item.created_at).toLocaleString() }))} /></div>
                            </section>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
    return <label className={wide ? "block sm:col-span-2" : "block"}><span className={labelCls}>{label}</span>{children}</label>;
}

function BoardingFields({ t, form, set }: any) {
    return <>
        <Field label={t("unitLabel")}><input className={inputCls} value={form.unitLabel || ""} onChange={(event) => set("unitLabel", event.target.value)} /></Field>
        <Field label={t("compatibility")}><select className={inputCls} value={form.compatibility || ""} onChange={(event) => set("compatibility", event.target.value)}><option value="">{t("notSet")}</option>{["social", "group_only", "solo"].map((value) => <option key={value} value={value}>{t(`compatibility_${value}`)}</option>)}</select></Field>
        {form.compatibility === "group_only" && <Field label={t("groupLabel")} wide><input className={inputCls} value={form.groupLabel || ""} onChange={(event) => set("groupLabel", event.target.value)} /></Field>}
        <Field label={t("mealsPerDay")}><input type="number" min={0} max={10} className={inputCls} value={form.mealsPerDay || ""} onChange={(event) => set("mealsPerDay", event.target.value)} /></Field>
        <Field label={t("belongings")} wide><input className={inputCls} value={form.belongings || ""} placeholder={t("belongingsHint")} onChange={(event) => set("belongings", event.target.value)} /></Field>
    </>;
}

function VehicleFields({ t, form, set, canReview }: any) {
    return <>
        <Field label={t("driverName")} wide><input className={inputCls} value={form.driverName || ""} onChange={(event) => set("driverName", event.target.value)} /></Field>
        <Field label={t("driverPhone")}><input className={inputCls} value={form.driverPhone || ""} onChange={(event) => set("driverPhone", event.target.value)} /></Field>
        <Field label={t("declaredAge")}><input type="number" min={16} max={120} className={inputCls} value={form.declaredAge || ""} onChange={(event) => set("declaredAge", event.target.value)} /></Field>
        <Field label={t("licenseNumber")}><input className={inputCls} value={form.licenseNumber || ""} onChange={(event) => set("licenseNumber", event.target.value)} /></Field>
        <Field label={t("licenseExpiresAt")}><input type="date" className={inputCls} value={form.licenseExpiresAt || ""} onChange={(event) => set("licenseExpiresAt", event.target.value)} /></Field>
        <Field label={t("licenseCountry")}><input maxLength={2} className={inputCls} value={form.licenseCountry || ""} onChange={(event) => set("licenseCountry", event.target.value.toUpperCase())} /></Field>
        <Field label={t("licenseClass")}><input className={inputCls} value={form.licenseClass || ""} onChange={(event) => set("licenseClass", event.target.value)} /></Field>
        <Field label={t("pickupLocation")}><input className={inputCls} value={form.pickupLocation || ""} onChange={(event) => set("pickupLocation", event.target.value)} /></Field>
        <Field label={t("returnLocation")}><input className={inputCls} value={form.returnLocation || ""} onChange={(event) => set("returnLocation", event.target.value)} /></Field>
        <Field label={t("extras")} wide><input className={inputCls} value={form.extras || ""} onChange={(event) => set("extras", event.target.value)} /></Field>
        <Field label={t("depositAmount")}><input type="number" min={0} className={inputCls} value={form.depositAmount || ""} onChange={(event) => set("depositAmount", event.target.value)} /></Field>
        <Field label={t("depositCurrency")}><input maxLength={3} className={inputCls} value={form.depositCurrency || ""} onChange={(event) => set("depositCurrency", event.target.value.toUpperCase())} /></Field>
        <Field label={t("depositStatus")}><select disabled={!canReview} className={inputCls} value={form.depositStatus || "pending"} onChange={(event) => set("depositStatus", event.target.value)}>{["pending", "held", "returned", "withheld"].map((status) => <option key={status} value={status}>{t(`deposit_${status}`)}</option>)}</select></Field>
        <Field label={t("depositEvidence")}><input disabled={!canReview} className={inputCls} value={form.depositEvidence || ""} onChange={(event) => set("depositEvidence", event.target.value)} /></Field>
        {form.depositStatus === "withheld" && <Field label={t("withheldReason")} wide><input className={inputCls} value={form.withheldReason || ""} onChange={(event) => set("withheldReason", event.target.value)} /></Field>}
        <Field label={t("contractUrl")} wide><input className={inputCls} value={form.contractUrl || ""} placeholder="https://…" onChange={(event) => set("contractUrl", event.target.value)} /></Field>
        <Field label={t("signatureMethod")}><select disabled={!canReview} className={inputCls} value={form.signatureMethod || "manual"} onChange={(event) => set("signatureMethod", event.target.value)}>{["manual", "otp", "signature"].map((method) => <option key={method} value={method}>{t(`handoff.${method}`)}</option>)}</select></Field>
        <Field label={t("signatureEvidence")}><input disabled={!canReview} className={inputCls} value={form.signatureEvidence || ""} onChange={(event) => set("signatureEvidence", event.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" disabled={!canReview} checked={form.contractSigned === true} onChange={(event) => set("contractSigned", event.target.checked)} />{t("contractSigned")}</label>
    </>;
}

function History({ title, empty, items }: { title: string; empty: string; items: Array<{ id: string; title: string; detail: string }> }) {
    return <div className="rounded-xl border border-border p-4"><h3 className="mb-3 font-semibold">{title}</h3>{items.length === 0 ? <p className="text-xs text-muted-foreground">{empty}</p> : <ol className="space-y-2">{items.map((item) => <li key={item.id} className="rounded-lg bg-muted/40 p-2 text-xs"><div className="font-semibold">{item.title}</div><div className="mt-1 text-muted-foreground">{item.detail}</div></li>)}</ol>}</div>;
}
