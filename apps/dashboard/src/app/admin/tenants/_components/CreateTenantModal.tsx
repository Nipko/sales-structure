"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; slug: string; industry: string; language: string; plan: string }) => void;
}

export default function CreateTenantModal({ open, onClose, onCreate }: Props) {
  const t = useTranslations("tenants");
  const tc = useTranslations("common");
  const [form, setForm] = useState({ name: "", slug: "", industry: "turismo", language: "es-CO", plan: "starter" });

  if (!open) return null;

  const autoSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const handleSubmit = () => {
    if (!form.name || !form.slug) return;
    onCreate(form);
    setForm({ name: "", slug: "", industry: "turismo", language: "es-CO", plan: "starter" });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={onClose}>
      <div className="w-[500px] max-w-[90vw] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t("modals.createTitle")}</h2>
          <button onClick={onClose} className="bg-transparent border-none text-neutral-500 cursor-pointer hover:text-neutral-700 dark:hover:text-neutral-300">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("modals.companyName")}</label>
            <input
              placeholder="e.g.: My Company"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value, slug: autoSlug(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Slug</label>
            <input
              placeholder="my-company"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("industry")}</label>
              <select value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm">
                <option value="turismo">Tourism</option>
                <option value="restaurante">Restaurant</option>
                <option value="ecommerce">E-Commerce</option>
                <option value="servicios">Services</option>
                <option value="salud">Health</option>
                <option value="educacion">Education</option>
                <option value="otro">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("modals.language")}</label>
              <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm">
                <option value="es-CO">Spanish (CO)</option>
                <option value="es-MX">Spanish (MX)</option>
                <option value="es-ES">Spanish (ES)</option>
                <option value="en-US">English (US)</option>
                <option value="pt-BR">Portuguese (BR)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{t("plan")}</label>
            <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm">
              <option value="starter">Starter</option>
              <option value="professional">Professional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-700">
              {tc("cancel")}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!form.name || !form.slug}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 cursor-pointer hover:opacity-90 disabled:opacity-50 border-none"
            >
              {tc("create")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
