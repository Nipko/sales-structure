"use client";

import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { Tag, X, Save } from "lucide-react";
import { Service, DURATION_PRESETS, SERVICE_COLORS } from "./shared";

interface ServiceForm {
  name: string;
  duration: number;
  buffer: number;
  price: number;
  color: string;
}

interface ServiceModalProps {
  form: ServiceForm;
  onChange: (form: ServiceForm) => void;
  editingService: Service | null;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}

export default function ServiceModal({
  form, onChange, editingService, saving, onSave, onClose,
}: ServiceModalProps) {
  const t = useTranslations("appointments");
  const locale = useLocale();
  const numLocale = locale === "pt" ? "pt-BR" : locale === "fr" ? "fr-FR" : locale === "en" ? "en-US" : "es-CO";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl w-full max-w-md mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ backgroundColor: `${form.color}15` }}>
              <Tag size={18} style={{ color: form.color }} />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {editingService ? t('editServiceTitle') : t('newServiceTitle')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer border-none bg-transparent text-gray-400 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
              {t('serviceName')}
            </label>
            <input
              type="text"
              placeholder={t('serviceNamePlaceholder')}
              value={form.name}
              onChange={(e) => onChange({ ...form, name: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {/* Duration presets */}
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
              {t('durationRequired')}
            </label>
            <div className="flex gap-2 mb-2">
              {DURATION_PRESETS.map((d) => (
                <button
                  key={d}
                  onClick={() => onChange({ ...form, duration: d })}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition-colors",
                    form.duration === d
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
                  )}
                >
                  {d} min
                </button>
              ))}
            </div>
            <input
              type="number"
              min={5}
              value={form.duration || ""}
              onChange={(e) => onChange({ ...form, duration: e.target.value === "" ? 0 : Number(e.target.value) })}
              className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder={t('customDuration')}
            />
          </div>

          {/* Buffer + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                {t('bufferTime')}
                <span className="relative group">
                  <span className="w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-[10px] flex items-center justify-center cursor-help font-bold">?</span>
                  <span className="absolute bottom-6 left-1/2 -translate-x-1/2 w-48 p-2 rounded-lg bg-gray-900 text-white text-[11px] leading-relaxed hidden group-hover:block z-50 shadow-lg">
                    {t('bufferTooltip')}
                  </span>
                </span>
              </label>
              <select
                value={form.buffer}
                onChange={(e) => onChange({ ...form, buffer: Number(e.target.value) })}
                className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value={0}>{t('noBuffer')}</option>
                <option value={5}>{t('nMinutes', { n: 5 })}</option>
                <option value={10}>{t('nMinutes', { n: 10 })}</option>
                <option value={15}>{t('nMinutes', { n: 15 })}</option>
                <option value={20}>{t('nMinutes', { n: 20 })}</option>
                <option value={30}>{t('nMinutes', { n: 30 })}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                {t('price')}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.price > 0 ? form.price.toLocaleString(numLocale) : ''}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    onChange({ ...form, price: raw ? Number(raw) : 0 });
                  }}
                  placeholder="0"
                  className="w-full px-3 pl-7 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{t('currency')}</span>
              </div>
            </div>
          </div>

          {/* Color picker */}
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
              {t('color')}
            </label>
            <div className="flex items-center gap-3">
              <div className="flex gap-2 flex-wrap">
                {SERVICE_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => onChange({ ...form, color: c })}
                    className={cn(
                      "w-7 h-7 rounded-full cursor-pointer border-2 transition-all hover:scale-110",
                      form.color === c
                        ? "border-gray-900 dark:border-white scale-110 shadow-md"
                        : "border-transparent"
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <input
                type="color"
                value={form.color}
                onChange={(e) => onChange({ ...form, color: e.target.value })}
                className="w-8 h-8 rounded-lg cursor-pointer border-none bg-transparent"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-800">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent text-gray-700 dark:text-gray-300 text-sm font-medium cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {t('cancel')}
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.name}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            <Save size={16} />
            {saving ? t("saving") : editingService ? t("updateService") : t("createService")}
          </button>
        </div>
      </div>
    </div>
  );
}
