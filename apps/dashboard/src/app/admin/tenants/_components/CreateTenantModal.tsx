"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import type { TenantPlanSlug, TenantVerticalDefinitions } from "./types";
import {
  ADMIN_CREATE_AVAILABILITY,
  getVerticalLabel,
  offerableSubTypes,
  type VerticalCatalogLocale,
} from "@/lib/vertical-catalog";

interface CreateTenantInput {
  name: string;
  slug: string;
  industry: string;
  subType: string | null;
  language: string;
  plan: TenantPlanSlug;
  isInternal: boolean;
  ownerEmail: string;
  ownerFirstName: string;
  ownerLastName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateTenantInput) => Promise<void>;
  verticalDefinitions: TenantVerticalDefinitions;
  plans: TenantPlanSlug[];
  catalogLoading: boolean;
}

const EMPTY_FORM = {
  name: "",
  slug: "",
  industry: "",
  subType: "",
  language: "es-CO",
  plan: "starter" as TenantPlanSlug,
  isInternal: false,
  ownerEmail: "",
  ownerFirstName: "",
  ownerLastName: "",
};

export default function CreateTenantModal({
  open,
  onClose,
  onCreate,
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
    if (open) {
      setForm({ ...EMPTY_FORM, plan: plans.includes("starter") ? "starter" : plans[0] || "starter" });
      setSubmitting(false);
    }
  }, [open, plans]);

  const industries = useMemo(() => Object.keys(verticalDefinitions), [verticalDefinitions]);
  // Un super_admin además puede poner al tenant en un piloto; lo cerrado a
  // altas nuevas sigue cerrado también para él.
  const subTypes = offerableSubTypes(
    verticalDefinitions[form.industry] || [],
    ADMIN_CREATE_AVAILABILITY,
  );
  const catalogReady = industries.length > 0 && plans.length > 0;
  const isValid = Boolean(
    form.name.trim()
    && form.slug.trim()
    && form.ownerEmail.trim()
    && form.ownerFirstName.trim()
    && form.industry
    && form.plan
    && (subTypes.length === 0 || form.subType),
  );

  if (!open) return null;

  const autoSlug = (name: string) =>
    name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const handleSubmit = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      await onCreate({
        ...form,
        name: form.name.trim(),
        slug: form.slug.trim().toLowerCase(),
        ownerEmail: form.ownerEmail.trim().toLowerCase(),
        ownerFirstName: form.ownerFirstName.trim(),
        ownerLastName: form.ownerLastName.trim(),
        subType: subTypes.length > 0 ? form.subType : null,
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
      <div className="w-[520px] max-w-[90vw] max-h-[90vh] overflow-y-auto rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t("modals.createTitle")}</h2>
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
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("modals.companyName")}</label>
            <input
              placeholder={t("companyPlaceholder")}
              value={form.name}
              disabled={submitting}
              onChange={(e) => setForm({ ...form, name: e.target.value, slug: autoSlug(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm disabled:opacity-60"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("slugLabel")}</label>
            <input
              placeholder={t("slugPlaceholder")}
              value={form.slug}
              disabled={submitting}
              onChange={(e) => setForm({ ...form, slug: autoSlug(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm disabled:opacity-60"
            />
          </div>
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3 space-y-3">
            <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{t("modals.ownerTitle")}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("modals.ownerFirstName")}</label>
                <input value={form.ownerFirstName} disabled={submitting} onChange={(e) => setForm({ ...form, ownerFirstName: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm disabled:opacity-60" />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("modals.ownerLastName")}</label>
                <input value={form.ownerLastName} disabled={submitting} onChange={(e) => setForm({ ...form, ownerLastName: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm disabled:opacity-60" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("modals.ownerEmail")}</label>
              <input type="email" placeholder={t("modals.ownerEmailPlaceholder")} value={form.ownerEmail} disabled={submitting} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm disabled:opacity-60" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("industry")}</label>
              <select
                value={form.industry}
                disabled={submitting || !catalogReady}
                onChange={(e) => setForm({ ...form, industry: e.target.value, subType: "" })}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm disabled:opacity-60"
              >
                <option value="">{tc("select")}</option>
                {industries.map((industry) => (
                  <option key={industry} value={industry}>{t(`industries.${industry}`)}</option>
                ))}
              </select>
            </div>
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
          </div>
          {form.industry && subTypes.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("engagement.subType")}</label>
              <select value={form.subType} disabled={submitting} onChange={(e) => setForm({ ...form, subType: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm disabled:opacity-60">
                <option value="">{tc("select")}</option>
                {subTypes.map((subType) => (
                  <option key={subType.key} value={subType.key}>
                    {getVerticalLabel(subType, locale)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("plan")}</label>
            <select value={form.plan} disabled={submitting || !catalogReady} onChange={(e) => setForm({ ...form, plan: e.target.value as TenantPlanSlug })} className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm disabled:opacity-60">
              {plans.map((plan) => <option key={plan} value={plan}>{t(`plans.${plan}`)}</option>)}
            </select>
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-neutral-200 dark:border-neutral-700 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isInternal}
              disabled={submitting}
              onChange={(e) => setForm({ ...form, isInternal: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-neutral-300"
            />
            <span>
              <span className="block text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {t("modals.internalTenant")}
              </span>
              <span className="block mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {form.isInternal
                  ? t("modals.internalTenantHint")
                  : t("modals.commercialTenantHint")}
              </span>
            </span>
          </label>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("modals.provisioningHint")}</p>
          <div className="flex gap-3 justify-end pt-2">
            <button disabled={submitting} onClick={closeIfIdle} className="px-4 py-2 rounded-lg text-sm font-medium border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50">
              {tc("cancel")}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!catalogReady || !isValid || submitting}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 cursor-pointer hover:opacity-90 disabled:opacity-50 border-none"
            >
              {submitting ? tc("saving") : tc("create")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
