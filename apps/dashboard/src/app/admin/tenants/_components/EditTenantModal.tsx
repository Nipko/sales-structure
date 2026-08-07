"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import type { Tenant, TenantPlanSlug, TenantVerticalDefinitions } from "./types";
import { getVerticalLabel, type VerticalCatalogLocale } from "@/lib/vertical-catalog";

interface EditTenantInput {
  name: string;
  industry: string;
  subType: string | null;
  language: string;
  plan: TenantPlanSlug;
}

interface Props {
  tenant: Tenant | null;
  onClose: () => void;
  onSave: (tenantId: string, data: EditTenantInput) => Promise<void>;
  verticalDefinitions: TenantVerticalDefinitions;
  plans: TenantPlanSlug[];
  catalogLoading: boolean;
}

const EMPTY_FORM = { name: "", industry: "", subType: "", language: "", plan: "" };

export default function EditTenantModal({
  tenant,
  onClose,
  onSave,
  verticalDefinitions,
  plans,
  catalogLoading,
}: Props) {
  const t = useTranslations("tenants");
  const tc = useTranslations("common");
  const locale = useLocale().split("-")[0] as VerticalCatalogLocale;
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    const plan = plans.includes(tenant.plan as TenantPlanSlug) ? tenant.plan : "";
    setForm({
      name: tenant.name,
      industry: tenant.industry,
      subType: tenant.subType || "",
      language: tenant.language,
      plan,
    });
    setSubmitting(false);
  }, [tenant, verticalDefinitions, plans]);

  const subTypes = verticalDefinitions[form.industry] || [];
  const currentSubType = subTypes.find((item) => item.key === form.subType);
  const catalogReady = plans.length > 0;
  const isValid = Boolean(
    form.name.trim()
    && form.industry
    && form.plan
  );

  if (!tenant) return null;

  const handleSubmit = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      await onSave(tenant.id, {
        name: form.name.trim(),
        // A vertical migration must rebuild every derived artifact atomically.
        // Until that workflow exists, the edit route only receives the current
        // immutable selection and the API independently enforces the same gate.
        industry: tenant.industry,
        subType: tenant.subType ?? null,
        language: form.language,
        plan: form.plan as TenantPlanSlug,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const closeIfIdle = () => {
    if (!submitting) onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={closeIfIdle}>
      <div className="w-[500px] max-w-[90vw] max-h-[90vh] overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t("modals.editTitle")}</h2>
          <button disabled={submitting} onClick={closeIfIdle} className="bg-transparent border-none text-neutral-500 cursor-pointer hover:text-neutral-700 dark:hover:text-neutral-300 disabled:opacity-50">
            <X size={20} />
          </button>
        </div>

        {!catalogReady && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            {catalogLoading ? tc("loading") : t("catalogLoadError")}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("modals.name")}</label>
            <input value={form.name} disabled={submitting} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm disabled:opacity-60" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("industry")}</label>
            <select
              value={form.industry}
              disabled
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm disabled:opacity-60"
            >
              <option value={form.industry}>{t(`industries.${form.industry}`)}</option>
            </select>
          </div>
          {form.subType && (
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("engagement.subType")}</label>
              <select value={form.subType} disabled className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm disabled:opacity-60">
                <option value={form.subType}>
                  {currentSubType ? getVerticalLabel(currentSubType, locale) : form.subType}
                </option>
              </select>
            </div>
          )}
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            {t("modals.verticalChangeWarning")}
          </p>
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("modals.language")}</label>
            <select value={form.language} disabled={submitting} onChange={(e) => setForm({ ...form, language: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm disabled:opacity-60">
              <option value="es-CO">{t("languages.es-CO")}</option>
              <option value="es-MX">{t("languages.es-MX")}</option>
              <option value="es-ES">{t("languages.es-ES")}</option>
              <option value="en-US">{t("languages.en-US")}</option>
              <option value="pt-BR">{t("languages.pt-BR")}</option>
              <option value="fr-FR">{t("languages.fr-FR")}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("plan")}</label>
            <select value={form.plan} disabled={submitting || !catalogReady} onChange={(e) => setForm({ ...form, plan: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm disabled:opacity-60">
              <option value="">{tc("select")}</option>
              {plans.map((plan) => <option key={plan} value={plan}>{t(`plans.${plan}`)}</option>)}
            </select>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button disabled={submitting} onClick={closeIfIdle} className="px-4 py-2 rounded-lg text-sm font-medium border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50">
              {tc("cancel")}
            </button>
            <button disabled={!catalogReady || !isValid || submitting} onClick={handleSubmit} className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 cursor-pointer hover:opacity-90 disabled:opacity-50 border-none">
              {submitting ? tc("saving") : tc("save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
