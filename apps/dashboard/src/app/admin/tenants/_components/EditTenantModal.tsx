"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import type { Tenant } from "./types";

interface Props {
  tenant: Tenant | null;
  onClose: () => void;
  onSave: (tenantId: string, data: { name: string; industry: string; language: string; plan: string }) => void;
}

export default function EditTenantModal({ tenant, onClose, onSave }: Props) {
  const t = useTranslations("tenants");
  const tc = useTranslations("common");
  const [form, setForm] = useState({ name: "", industry: "", language: "", plan: "" });

  useEffect(() => {
    if (tenant) {
      setForm({
        name: tenant.name,
        industry: tenant.industry,
        language: tenant.language,
        plan: tenant.plan,
      });
    }
  }, [tenant]);

  if (!tenant) return null;

  const handleSubmit = () => {
    onSave(tenant.id, form);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={onClose}>
      <div className="w-[480px] max-w-[90vw] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t("modals.editTitle")}</h2>
          <button onClick={onClose} className="bg-transparent border-none text-neutral-500 cursor-pointer hover:text-neutral-700 dark:hover:text-neutral-300">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("modals.name")}</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("industry")}</label>
            <select value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm">
              <option value="turismo">{t("industries.turismo")}</option>
              <option value="restaurante">{t("industries.restaurante")}</option>
              <option value="ecommerce">{t("industries.ecommerce")}</option>
              <option value="servicios">{t("industries.servicios")}</option>
              <option value="salud">{t("industries.salud")}</option>
              <option value="educacion">{t("industries.educacion")}</option>
              <option value="otro">{t("industries.otro")}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("modals.language")}</label>
            <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm">
              <option value="es-CO">{t("languages.es-CO")}</option>
              <option value="es-MX">{t("languages.es-MX")}</option>
              <option value="es-ES">{t("languages.es-ES")}</option>
              <option value="en-US">{t("languages.en-US")}</option>
              <option value="pt-BR">{t("languages.pt-BR")}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("plan")}</label>
            <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm">
              <option value="starter">{t("plans.starter")}</option>
              <option value="professional">{t("plans.professional")}</option>
              <option value="enterprise">{t("plans.enterprise")}</option>
              <option value="custom">{t("plans.custom")}</option>
            </select>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-700">
              {tc("cancel")}
            </button>
            <button
              onClick={handleSubmit}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 cursor-pointer hover:opacity-90 border-none"
            >
              {tc("save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
