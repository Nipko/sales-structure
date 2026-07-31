"use client";

import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { Tag, X, Save, MapPin, Video, Globe, Clock, Timer, Infinity } from "lucide-react";
import { Service, DURATION_PRESETS, SERVICE_COLORS, type DurationType } from "./shared";

interface ServiceForm {
  name: string;
  duration: number;
  durationMax: number | null;
  durationType: DurationType;
  buffer: number;
  price: number;
  color: string;
  category: string;
  maxConcurrent: number;
  /** Días hasta la re-reserva sugerida. null = usa el default del evaluador. */
  rebookAfterDays: number | null;
  requiredFields: string[];
  locationType: string;
  locationAddress: string;
  meetingLink: string;
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
  const numLocale = locale === "pt" ? "pt-BR" : locale === "fr" ? "fr-FR" : locale === "en" ? "en-US" : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl w-full max-w-md mx-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ backgroundColor: `${form.color}15` }}>
              <Tag size={18} style={{ color: form.color }} />
            </div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
              {editingService ? t('editServiceTitle') : t('newServiceTitle')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer border-none bg-transparent text-neutral-400 hover:text-neutral-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-2 text-neutral-700 dark:text-neutral-300">
              {t('serviceName')}
            </label>
            <input
              type="text"
              placeholder={t('serviceNamePlaceholder')}
              value={form.name}
              onChange={(e) => onChange({ ...form, name: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white text-sm placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {/* Duration type selector */}
          <div>
            <label className="block text-sm font-medium mb-2 text-neutral-700 dark:text-neutral-300">
              {t('durationType')}
            </label>
            <div className="flex gap-2">
              {([
                { value: 'fixed' as DurationType, icon: Clock, label: t('durationFixed') },
                { value: 'flexible' as DurationType, icon: Timer, label: t('durationFlexible') },
                { value: 'open' as DurationType, icon: Infinity, label: t('durationOpen') },
              ] as const).map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  onClick={() => {
                    const updates: Partial<ServiceForm> = { durationType: value };
                    if (value === 'open') { updates.duration = 0; updates.durationMax = null; }
                    if (value === 'fixed') { updates.durationMax = null; if (!form.duration) updates.duration = 30; }
                    if (value === 'flexible') { if (!form.duration) updates.duration = 30; if (!form.durationMax) updates.durationMax = 60; }
                    onChange({ ...form, ...updates });
                  }}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer border transition-colors",
                    form.durationType === value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                  )}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
            {form.durationType === 'open' && (
              <p className="text-xs text-neutral-400 mt-2">{t('durationOpenHint')}</p>
            )}
          </div>

          {/* Duration presets — hidden for open */}
          {form.durationType !== 'open' && (
            <div>
              <label className="block text-sm font-medium mb-2 text-neutral-700 dark:text-neutral-300">
                {form.durationType === 'flexible' ? t('durationMin') : t('durationRequired')}
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
                        : "bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700"
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
                className="w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder={t('customDuration')}
              />
            </div>
          )}

          {/* Duration max — only for flexible */}
          {form.durationType === 'flexible' && (
            <div>
              <label className="block text-sm font-medium mb-2 text-neutral-700 dark:text-neutral-300">
                {t('durationMax')}
              </label>
              <input
                type="number"
                min={form.duration || 5}
                value={form.durationMax || ""}
                onChange={(e) => onChange({ ...form, durationMax: e.target.value === "" ? null : Number(e.target.value) })}
                className="w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder={t('durationMaxPlaceholder')}
              />
            </div>
          )}

          {/* Buffer + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1 text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
                {t('bufferTime')}
                <span className="relative group">
                  <span className="w-4 h-4 rounded-full bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 text-[10px] flex items-center justify-center cursor-help font-semibold">?</span>
                  <span className="absolute bottom-6 left-1/2 -translate-x-1/2 w-48 p-2 rounded-lg bg-neutral-900 text-white text-[11px] leading-relaxed hidden group-hover:block z-50 shadow-lg">
                    {t('bufferTooltip')}
                  </span>
                </span>
              </label>
              <select
                value={form.buffer}
                onChange={(e) => onChange({ ...form, buffer: Number(e.target.value) })}
                className="w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
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
              <label className="block text-sm font-medium mb-1 text-neutral-700 dark:text-neutral-300">
                {t('price')}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.price > 0 ? form.price.toLocaleString(numLocale) : ''}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    onChange({ ...form, price: raw ? Number(raw) : 0 });
                  }}
                  placeholder="0"
                  className="w-full px-3 pl-7 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">{t('currency')}</span>
              </div>
            </div>
          </div>

          {/* Color picker */}
          <div>
            <label className="block text-sm font-medium mb-2 text-neutral-700 dark:text-neutral-300">
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
                        ? "border-neutral-900 dark:border-white scale-110 shadow-md"
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

          {/* Modality */}
          <div>
            <label className="block text-sm font-medium mb-2 text-neutral-700 dark:text-neutral-300">
              {t('locationType')}
            </label>
            <div className="flex gap-2">
              {[
                { value: 'in_person', icon: MapPin, label: t('inPerson') },
                { value: 'online', icon: Video, label: t('online') },
                { value: 'hybrid', icon: Globe, label: t('hybrid') },
              ].map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  onClick={() => onChange({ ...form, locationType: value })}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer border transition-colors",
                    form.locationType === value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                  )}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Location / Meeting Link */}
          {(form.locationType === 'in_person' || form.locationType === 'hybrid') && (
            <div>
              <label className="block text-sm font-medium mb-1 text-neutral-700 dark:text-neutral-300">
                {t('locationAddress')}
              </label>
              <input
                type="text"
                value={form.locationAddress || ''}
                onChange={(e) => onChange({ ...form, locationAddress: e.target.value })}
                placeholder={t('locationAddressPlaceholder')}
                className="w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          )}
          {(form.locationType === 'online' || form.locationType === 'hybrid') && (
            <div>
              <label className="block text-sm font-medium mb-1 text-neutral-700 dark:text-neutral-300">
                {t('meetingLink')}
              </label>
              <input
                type="url"
                value={form.meetingLink || ''}
                onChange={(e) => onChange({ ...form, meetingLink: e.target.value })}
                placeholder={t('meetingLinkPlaceholder')}
                className="w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <p className="text-xs text-neutral-400 mt-1">{t('meetingLinkHint')}</p>
            </div>
          )}

          {/* Category + Max Concurrent */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1 text-neutral-700 dark:text-neutral-300">
                {t('category')}
              </label>
              <input
                type="text"
                value={form.category || ''}
                onChange={(e) => onChange({ ...form, category: e.target.value })}
                placeholder={t('categoryPlaceholder')}
                className="w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-neutral-700 dark:text-neutral-300">
                {t('maxConcurrent')}
              </label>
              <input
                type="number" min={1} max={50}
                value={form.maxConcurrent || 1}
                onChange={(e) => onChange({ ...form, maxConcurrent: Math.max(1, Number(e.target.value)) })}
                className="w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-neutral-700 dark:text-neutral-300">
                {t('rebookAfterDays')}
              </label>
              <input
                type="number" min={0} max={730}
                value={form.rebookAfterDays ?? ''}
                placeholder={t('rebookAfterDaysPlaceholder')}
                // Vacío se manda como null, no como 0: 0 haría que el recordatorio
                // de re-reserva salga el mismo día de la cita.
                onChange={(e) => onChange({ ...form, rebookAfterDays: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
                className="w-full px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">{t('rebookAfterDaysHint')}</p>
            </div>
          </div>

          {/* Required Fields */}
          <div>
            <label className="block text-sm font-medium mb-2 text-neutral-700 dark:text-neutral-300">
              {t('requiredFieldsLabel')}
            </label>
            <div className="flex gap-3">
              {['email', 'notes'].map(field => (
                <label key={field} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(form.requiredFields || []).includes(field)}
                    onChange={(e) => {
                      const current = form.requiredFields || [];
                      onChange({
                        ...form,
                        requiredFields: e.target.checked
                          ? [...current, field]
                          : current.filter(f => f !== field),
                      });
                    }}
                    className="w-4 h-4 rounded border-neutral-300 text-primary focus:ring-primary/20 cursor-pointer"
                  />
                  <span className="text-sm text-neutral-700 dark:text-neutral-300 capitalize">{field}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-neutral-200 dark:border-neutral-800">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-transparent text-neutral-700 dark:text-neutral-300 text-sm font-medium cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
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
