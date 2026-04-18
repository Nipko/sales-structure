"use client";

import { useTranslations } from "next-intl";
import { CalendarDays, X, MapPin, FileText, UserCheck, Save } from "lucide-react";
import { Appointment, Service, fmt2 } from "./shared";

interface ModalForm {
  serviceName: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
  assignedTo: string;
  contactId: string;
}

interface AppointmentModalProps {
  form: ModalForm;
  onChange: (form: ModalForm) => void;
  services: Service[];
  editingAppointment: Appointment | null;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}

export default function AppointmentModal({
  form, onChange, services, editingAppointment, saving, onSave, onClose,
}: AppointmentModalProps) {
  const t = useTranslations("appointments");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl w-full max-w-lg mx-4 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900 z-10 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <CalendarDays size={18} className="text-primary" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {editingAppointment ? t('editAppointmentTitle') : t('newAppointmentTitle')}
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
          {/* Service selector */}
          {services.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                {t('service')}
              </label>
              <select
                value={services.find((s) => s.name === form.serviceName)?.id || ""}
                onChange={(e) => {
                  const selected = services.find((s) => s.id === e.target.value);
                  if (selected) {
                    const newForm = { ...form, serviceName: selected.name };
                    if (newForm.startTime) {
                      const [h, m] = newForm.startTime.split(":").map(Number);
                      const totalMin = h * 60 + m + selected.duration;
                      const endH = Math.min(Math.floor(totalMin / 60), 23);
                      const endM = totalMin % 60;
                      newForm.endTime = `${fmt2(endH)}:${fmt2(endM)}`;
                    }
                    onChange(newForm);
                  }
                }}
                className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                <option value="">{t('selectServicePlaceholder')}</option>
                {services
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.duration} min)
                    </option>
                  ))}
              </select>
            </div>
          )}

          {/* Service name (manual) */}
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
              {t('serviceName')}
            </label>
            <input
              type="text"
              placeholder={t('serviceNamePlaceholder')}
              value={form.serviceName}
              onChange={(e) => onChange({ ...form, serviceName: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
              {t('dateRequired')}
            </label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => onChange({ ...form, date: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {/* Time row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                {t('startTimeRequired')}
              </label>
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => onChange({ ...form, startTime: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                {t('endTimeRequired')}
              </label>
              <input
                type="time"
                value={form.endTime}
                onChange={(e) => onChange({ ...form, endTime: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
              <MapPin size={14} className="inline mr-1.5 -mt-0.5" />
              {t('location')}
            </label>
            <input
              type="text"
              placeholder={t('locationPlaceholder')}
              value={form.location}
              onChange={(e) => onChange({ ...form, location: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
              <FileText size={14} className="inline mr-1.5 -mt-0.5" />
              {t('notes')}
            </label>
            <textarea
              rows={3}
              placeholder={t('additionalNotes')}
              value={form.notes}
              onChange={(e) => onChange({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm resize-none placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Assigned agent */}
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
              <UserCheck size={14} className="inline mr-1.5 -mt-0.5" />
              {t('assignedAgent')}
            </label>
            <input
              type="text"
              placeholder={t('agentIdPlaceholder')}
              value={form.assignedTo}
              onChange={(e) => onChange({ ...form, assignedTo: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Contact */}
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
              {t('contact')}
            </label>
            <input
              type="text"
              placeholder={t('contactIdPlaceholder')}
              value={form.contactId}
              onChange={(e) => onChange({ ...form, contactId: e.target.value })}
              className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-800 sticky bottom-0 bg-white dark:bg-gray-900 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-transparent text-gray-700 dark:text-gray-300 text-sm font-medium cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {t('cancel')}
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.serviceName || !form.date}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border-none bg-primary text-primary-foreground font-semibold text-sm cursor-pointer disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            <Save size={16} />
            {saving ? t("saving") : editingAppointment ? t("update") : t("createAppointment")}
          </button>
        </div>
      </div>
    </div>
  );
}
