"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { UpgradeBanner } from "@/components/ui/upgrade-banner";
import {
  Mail,
  Plus,
  ArrowLeft,
  Trash2,
  Save,
  Send,
  X,
  Copy,
  CheckCircle2,
  XCircle,
  Eye,
  Code2,
  ToggleLeft,
  ToggleRight,
  Calendar,
  Bell,
  Home,
  MapPin,
  UserPlus,
  Users,
  Layers,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmailTemplate {
  id: string;
  name: string;
  slug: string;
  subject: string;
  bodyHtml: string;
  bodyJson: any;
  variables: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AVAILABLE_VARIABLES = [
  "customer_name",
  "customer_email",
  "company_name",
  "company_logo",
  "service_name",
  "appointment_date",
  "appointment_time",
  "location",
  "agent_name",
  "order_id",
  "order_items_html",
  "order_total",
  "payment_method",
];

const SAMPLE_DATA: Record<string, string> = {
  customer_name: "Jane Smith",
  customer_email: "jane@example.com",
  company_name: "Parallly",
  company_logo: "https://placehold.co/120x40/6c5ce7/ffffff?text=Logo",
  service_name: "Plan Pro",
  appointment_date: "April 15, 2026",
  appointment_time: "10:30 AM",
  location: "123 Main St",
  agent_name: "John Doe",
  order_id: "ORD-20260412-0042",
  order_items_html:
    '<table style="width:100%;border-collapse:collapse"><tr><td style="padding:4px 8px;border-bottom:1px solid #eee">Plan Pro x1</td><td style="text-align:right;padding:4px 8px;border-bottom:1px solid #eee">$49.00</td></tr></table>',
  order_total: "$49.00 USD",
  payment_method: "Visa ****4242",
};

const inputCls =
  "w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border focus:ring-2 focus:ring-primary/40 transition-shadow";
const labelCls = "block text-xs font-semibold text-muted-foreground mb-1";

const emptyTemplate = (): Omit<EmailTemplate, "id" | "createdAt" | "updatedAt"> => ({
  name: "",
  slug: "",
  subject: "",
  bodyHtml: "",
  bodyJson: null,
  variables: [],
  isActive: true,
});

// ---------------------------------------------------------------------------
// Preset templates
// ---------------------------------------------------------------------------

type LucideIconName = "Calendar" | "Bell" | "Home" | "MapPin" | "UserPlus" | "Users";

interface TemplatePreset {
  id: string;
  name: string;
  description: string;
  icon: LucideIconName;
  slug: string;
  subject: string;
  variables: string[];
  bodyHtml: string;
}

const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: "preset_appointment_confirm",
    name: "Confirmación de cita",
    description: "Email automático cuando se agenda una cita",
    icon: "Calendar",
    slug: "appointment_confirmation_email",
    subject: "Cita confirmada — {{service_name}}",
    variables: ["customer_name", "service_name", "appointment_date", "appointment_time", "location"],
    bodyHtml: `<h2>Tu cita está confirmada</h2><p>Hola {{customer_name}},</p><p>Tu cita de <strong>{{service_name}}</strong> ha sido agendada para el <strong>{{appointment_date}}</strong> a las <strong>{{appointment_time}}</strong>.</p>{{#if location}}<p>Ubicación: {{location}}</p>{{/if}}<p>Si necesitas cancelar o reprogramar, contáctanos con 24h de anticipación.</p>`,
  },
  {
    id: "preset_appointment_reminder",
    name: "Recordatorio de cita",
    description: "Enviado automáticamente 24h antes de la cita",
    icon: "Bell",
    slug: "appointment_reminder_email",
    subject: "Recordatorio: tu cita mañana — {{service_name}}",
    variables: ["customer_name", "service_name", "appointment_date", "appointment_time", "location"],
    bodyHtml: `<h2>Recordatorio de tu cita</h2><p>Hola {{customer_name}},</p><p>Te recordamos que tienes una cita mañana:</p><p><strong>{{service_name}}</strong><br/>{{appointment_date}} a las {{appointment_time}}</p>{{#if location}}<p>Ubicación: {{location}}</p>{{/if}}<p>¡Te esperamos!</p>`,
  },
  {
    id: "preset_booking_confirm",
    name: "Confirmación de reserva",
    description: "Para reservas de propiedades/alojamiento",
    icon: "Home",
    slug: "property_booking_confirmation",
    subject: "Reserva confirmada — {{property_name}}",
    variables: ["guest_name", "property_name", "check_in", "check_out", "nights", "total_price", "currency", "check_in_instructions"],
    bodyHtml: `<h2>¡Tu reserva está confirmada!</h2><p>Hola {{guest_name}},</p><p>Tu reserva en <strong>{{property_name}}</strong> ha sido confirmada.</p><table style="width:100%;margin:16px 0"><tr><td><strong>Check-in:</strong></td><td>{{check_in}}</td></tr><tr><td><strong>Check-out:</strong></td><td>{{check_out}}</td></tr><tr><td><strong>Noches:</strong></td><td>{{nights}}</td></tr><tr><td><strong>Total:</strong></td><td>{{total_price}} {{currency}}</td></tr></table>{{#if check_in_instructions}}<h3>Instrucciones de llegada</h3><p>{{check_in_instructions}}</p>{{/if}}`,
  },
  {
    id: "preset_checkin_reminder",
    name: "Recordatorio de check-in",
    description: "Instrucciones de llegada 24h antes",
    icon: "MapPin",
    slug: "property_check_in_reminder",
    subject: "Mañana es tu check-in — {{property_name}}",
    variables: ["guest_name", "property_name", "check_in_date", "check_in_time", "address", "check_in_instructions"],
    bodyHtml: `<h2>¡Tu llegada es mañana!</h2><p>Hola {{guest_name}},</p><p>Tu check-in en <strong>{{property_name}}</strong> es mañana.</p><p><strong>Fecha:</strong> {{check_in_date}}<br/><strong>Hora:</strong> {{check_in_time}}</p>{{#if address}}<p><strong>Dirección:</strong> {{address}}</p>{{/if}}{{#if check_in_instructions}}<h3>Instrucciones de llegada</h3><p>{{check_in_instructions}}</p>{{/if}}`,
  },
  {
    id: "preset_welcome",
    name: "Bienvenida",
    description: "Email de bienvenida para nuevos clientes",
    icon: "UserPlus",
    slug: "custom_welcome",
    subject: "Bienvenido a {{company_name}}",
    variables: ["customer_name", "company_name"],
    bodyHtml: `<h2>¡Bienvenido!</h2><p>Hola {{customer_name}},</p><p>Gracias por confiar en <strong>{{company_name}}</strong>. Estamos aquí para ayudarte.</p><p>Si tienes alguna pregunta, no dudes en contactarnos.</p>`,
  },
  {
    id: "preset_team_notification",
    name: "Notificación al equipo",
    description: "Alerta interna cuando se escala una conversación",
    icon: "Users",
    slug: "handoff_notification",
    subject: "🔴 Escalación: {{contact_name}} necesita atención",
    variables: ["agent_name", "contact_name", "contact_phone", "reason", "last_message", "inbox_url"],
    bodyHtml: `<h2>Conversación escalada</h2><p>Hola {{agent_name}},</p><p>Un cliente necesita atención humana.</p><p><strong>Cliente:</strong> {{contact_name}}<br/><strong>Teléfono:</strong> {{contact_phone}}<br/><strong>Razón:</strong> {{reason}}</p>{{#if last_message}}<blockquote style="border-left:3px solid #ddd;padding:8px 12px;color:#666">{{last_message}}</blockquote>{{/if}}<p><a href="{{inbox_url}}" style="display:inline-block;padding:10px 20px;background:#6c5ce7;color:white;border-radius:8px;text-decoration:none">Abrir Inbox</a></p>`,
  },
];

const PRESET_ICON_MAP: Record<LucideIconName, React.ElementType> = {
  Calendar,
  Bell,
  Home,
  MapPin,
  UserPlus,
  Users,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EmailTemplatesPage() {
  const t = useTranslations('emailTemplates');
    const tc = useTranslations("common");
  const { activeTenantId } = useTenant();
  const { canCreate, getLimit } = usePlanLimits();

  // State
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState(emptyTemplate());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [previewTab, setPreviewTab] = useState<"preview" | "code">("preview");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showPresetPicker, setShowPresetPicker] = useState(false);
  const [creatingFromPreset, setCreatingFromPreset] = useState(false);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Helpers
  const showToast = useCallback((msg: string, error = false) => {
    setToast({ msg, error });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Load templates
  useEffect(() => {
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenantId]);

  async function loadTemplates() {
    if (!activeTenantId) return;
    setLoading(true);
    try {
      const res = await api.getEmailTemplates(activeTenantId);
      if (res.success && Array.isArray(res.data)) {
        setTemplates(res.data);
      }
    } catch (err) {
      console.error("Error loading templates:", err);
    } finally {
      setLoading(false);
    }
  }

  // Select a template for editing
  async function selectTemplate(id: string) {
    if (!activeTenantId) return;
    setSelectedId(id);
    setIsCreating(false);
    try {
      const res = await api.getEmailTemplate(activeTenantId, id);
      if (res.success && res.data) {
        const t = res.data;
        setForm({
          name: t.name,
          slug: t.slug,
          subject: t.subject,
          bodyHtml: t.bodyHtml || "",
          bodyJson: t.bodyJson,
          variables: t.variables || [],
          isActive: t.isActive,
        });
      }
    } catch {
      showToast("Error loading template", true);
    }
  }

  function startCreate() {
    setSelectedId(null);
    setIsCreating(true);
    setForm(emptyTemplate());
    setPreviewTab("preview");
  }

  function closeEditor() {
    setSelectedId(null);
    setIsCreating(false);
  }

  async function createFromPreset(preset: TemplatePreset) {
    if (!activeTenantId) return;
    setCreatingFromPreset(true);
    try {
      const payload = {
        name: preset.name,
        slug: preset.slug,
        subject: preset.subject,
        bodyHtml: preset.bodyHtml,
        bodyJson: null,
        variables: preset.variables,
        isActive: true,
      };
      const res = await api.createEmailTemplate(activeTenantId, payload);
      if (res?.success && res.data?.id) {
        showToast("Template created");
        setShowPresetPicker(false);
        await loadTemplates();
        await selectTemplate(res.data.id);
      } else {
        showToast(res?.error || tc("errorSaving"), true);
      }
    } catch {
      showToast(tc("connectionError"), true);
    } finally {
      setCreatingFromPreset(false);
    }
  }

  // Auto-generate slug from name
  function handleNameChange(name: string) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60);
    setForm((prev) => ({ ...prev, name, slug }));
  }

  // Insert variable at cursor
  function insertVariable(variable: string, target: "subject" | "body") {
    const tag = `{{${variable}}}`;
    if (target === "subject" && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const newValue = el.value.slice(0, start) + tag + el.value.slice(end);
      setForm((prev) => ({ ...prev, subject: newValue }));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + tag.length, start + tag.length);
      });
    } else if (target === "body" && bodyRef.current) {
      const el = bodyRef.current;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const newValue = el.value.slice(0, start) + tag + el.value.slice(end);
      setForm((prev) => ({ ...prev, bodyHtml: newValue }));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + tag.length, start + tag.length);
      });
    }
  }

  // Render preview with sample data
  function renderPreviewHtml(): string {
    let html = form.bodyHtml || "";
    for (const [key, value] of Object.entries(SAMPLE_DATA)) {
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }
    let subject = form.subject || "";
    for (const [key, value] of Object.entries(SAMPLE_DATA)) {
      subject = subject.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:24px;color:#333;background:#fff;}</style></head><body><div style="max-width:600px;margin:0 auto;"><div style="padding:12px 0;border-bottom:2px solid #6c5ce7;margin-bottom:16px;font-size:18px;font-weight:600;color:#6c5ce7;">${subject}</div>${html}</div></body></html>`;
  }

  // Save
  async function handleSave() {
    if (!activeTenantId) return;
    if (!form.name.trim()) {
      showToast("Name is required", true);
      return;
    }
    if (!form.subject.trim()) {
      showToast("Subject is required", true);
      return;
    }

    setSaving(true);
    try {
      // Extract used variables from subject + body
      const usedVars: string[] = [];
      const combined = form.subject + " " + form.bodyHtml;
      for (const v of AVAILABLE_VARIABLES) {
        if (combined.includes(`{{${v}}}`)) usedVars.push(v);
      }
      const payload = { ...form, variables: usedVars };

      let res;
      if (isCreating) {
        res = await api.createEmailTemplate(activeTenantId, payload);
      } else if (selectedId) {
        res = await api.saveEmailTemplate(activeTenantId, selectedId, payload);
      }
      if (res?.success) {
        showToast(isCreating ? "Template created" : "Template saved");
        await loadTemplates();
        if (isCreating && res.data?.id) {
          setSelectedId(res.data.id);
          setIsCreating(false);
        }
      } else {
        showToast(res?.error || tc("errorSaving"), true);
      }
    } catch {
      showToast(tc("connectionError"), true);
    } finally {
      setSaving(false);
    }
  }

  // Delete
  async function handleDelete(id: string) {
    if (!activeTenantId || !confirm(tc("deleteConfirm"))) return;
    setDeleting(id);
    try {
      await api.deleteEmailTemplate(activeTenantId, id);
      showToast("Template deleted");
      if (selectedId === id) closeEditor();
      await loadTemplates();
    } catch {
      showToast(tc("errorSaving"), true);
    } finally {
      setDeleting(null);
    }
  }

  // Send test
  async function handleSendTest() {
    if (!activeTenantId || !selectedId || !testEmail.trim()) return;
    setSendingTest(true);
    try {
      const res = await api.testEmailTemplate(activeTenantId, selectedId, testEmail.trim());
      if (res?.success) {
        showToast(`Test email sent to ${testEmail}`);
        setTestModalOpen(false);
        setTestEmail("");
      } else {
        showToast(res?.error || tc("errorSaving"), true);
      }
    } catch {
      showToast(tc("connectionError"), true);
    } finally {
      setSendingTest(false);
    }
  }

  // Detect if editor is open
  const editorOpen = selectedId !== null || isCreating;

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto h-full">
      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "fixed top-6 right-6 z-[9999] text-white px-6 py-3 rounded-[10px] text-sm font-semibold shadow-lg flex items-center gap-2 animate-in slide-in-from-top-2",
            toast.error ? "bg-destructive" : "bg-[var(--success)]"
          )}
        >
          {toast.error ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <a
            href="/admin/settings"
            className="w-9 h-9 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <ArrowLeft size={18} />
          </a>
          <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center">
            <Mail size={22} className="text-primary" />
          </div>
          <div>
            <h1 className="text-[22px] font-semibold text-foreground m-0">{t('title')}</h1>
            <p className="text-[13px] text-muted-foreground m-0">
              Design and manage transactional emails
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPresetPicker(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-[10px] bg-card border border-border text-foreground cursor-pointer text-sm font-semibold hover:bg-muted transition-colors"
          >
            <Layers size={16} className="text-primary" />
            {t('createFromTemplate')}
          </button>
          <button
            onClick={startCreate}
            disabled={!canCreate("emailTemplates", templates.length)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] bg-primary text-white border-none cursor-pointer text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={16} /> Create template
          </button>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex gap-5 h-[calc(100vh-180px)]">
        {/* Template list — left column */}
        <div
          className={cn(
            "flex flex-col gap-2.5 overflow-y-auto pr-1 transition-all duration-300",
            editorOpen ? "w-[300px] min-w-[300px]" : "w-full"
          )}
        >
          <UpgradeBanner current={templates.length} limit={getLimit("emailTemplates")} resourceLabel="plantillas de email" />
          {loading ? (
            <div className="p-10 text-center text-muted-foreground">Loading...</div>
          ) : templates.length === 0 ? (
            <div className="p-12 text-center bg-card rounded-[14px] border border-border">
              <Mail size={36} className="text-muted-foreground opacity-40 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm mb-4">No templates created</p>
              <button
                onClick={startCreate}
                disabled={!canCreate("emailTemplates", templates.length)}
                className="px-5 py-2.5 rounded-[10px] bg-primary text-white border-none cursor-pointer text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create first template
              </button>
            </div>
          ) : (
            templates.map((t) => (
              <div
                key={t.id}
                onClick={() => selectTemplate(t.id)}
                className={cn(
                  "bg-card rounded-[14px] border px-4 py-3.5 cursor-pointer transition-all hover:border-primary/50 group",
                  selectedId === t.id ? "border-primary shadow-md shadow-primary/10" : "border-border"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-foreground truncate">{t.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[11px] font-mono">
                        {t.slug}
                      </span>
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[11px] font-semibold",
                          t.isActive
                            ? "bg-[var(--success)]/15 text-[var(--success)]"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {t.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                    {!editorOpen && (
                      <p className="text-xs text-muted-foreground mt-1.5 truncate">{t.subject}</p>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(t.id);
                    }}
                    disabled={deleting === t.id}
                    className="w-7 h-7 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive cursor-pointer flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Editor + Preview — right column */}
        {editorOpen && (
          <div className="flex-1 flex flex-col gap-5 overflow-y-auto min-w-0">
            {/* Editor */}
            <div className="bg-card rounded-[14px] border border-border p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold text-foreground m-0">
                  {isCreating ? tc("create") : tc("edit")}
                </h2>
                <button
                  onClick={closeEditor}
                  className="w-8 h-8 rounded-lg bg-muted border border-border text-muted-foreground hover:text-foreground cursor-pointer flex items-center justify-center transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Name & Slug */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className={labelCls}>Name</label>
                  <input
                    value={form.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="e.g.: Customer welcome"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Slug (unique identifier)</label>
                  <input
                    value={form.slug}
                    onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))}
                    placeholder="welcome-customer"
                    className={cn(inputCls, "font-mono text-[13px]")}
                  />
                </div>
              </div>

              {/* Subject */}
              <div className="mb-4">
                <label className={labelCls}>
                  Subject{" "}
                  <span className="font-normal text-muted-foreground/70">
                    — Use {"{{variable}}"} for dynamic data
                  </span>
                </label>
                <input
                  ref={subjectRef}
                  value={form.subject}
                  onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
                  placeholder='E.g.: Hello {{customer_name}}, your order {{order_id}} is ready'
                  className={inputCls}
                />
              </div>

              {/* Variables */}
              <div className="mb-4">
                <label className={labelCls}>Available variables</label>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Click to insert in subject or body (depending on cursor position)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {AVAILABLE_VARIABLES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        // Insert into whichever field was last focused
                        const activeEl = document.activeElement;
                        if (activeEl === subjectRef.current) {
                          insertVariable(v, "subject");
                        } else {
                          insertVariable(v, "body");
                        }
                      }}
                      className="px-2.5 py-1 rounded-md bg-primary/10 text-primary text-[11px] font-mono cursor-pointer hover:bg-primary/20 transition-colors border border-primary/20 flex items-center gap-1"
                    >
                      <Copy size={10} />
                      {`{{${v}}}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* HTML body */}
              <div className="mb-4">
                <label className={labelCls}>HTML Body</label>
                <textarea
                  ref={bodyRef}
                  value={form.bodyHtml}
                  onChange={(e) => setForm((prev) => ({ ...prev, bodyHtml: e.target.value }))}
                  placeholder="<h1>Hello {{customer_name}}</h1><p>Thank you for your purchase...</p>"
                  rows={14}
                  className={cn(inputCls, "font-mono text-[13px] leading-relaxed resize-y min-h-[200px]")}
                />
              </div>

              {/* Active toggle */}
              <div className="flex items-center gap-3 mb-5">
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, isActive: !prev.isActive }))}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-semibold cursor-pointer transition-colors",
                    form.isActive
                      ? "bg-[var(--success)]/15 border-[var(--success)]/30 text-[var(--success)]"
                      : "bg-muted border-border text-muted-foreground"
                  )}
                >
                  {form.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  {form.isActive ? "Active" : "Inactive"}
                </button>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] bg-primary text-white border-none cursor-pointer text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Save size={16} />
                  {saving ? tc("saving") : tc("saveChanges")}
                </button>
                {selectedId && !isCreating && (
                  <button
                    onClick={() => setTestModalOpen(true)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] bg-card border border-border text-foreground cursor-pointer text-sm font-semibold hover:bg-muted transition-colors"
                  >
                    <Send size={16} />
                    Send test
                  </button>
                )}
              </div>
            </div>

            {/* Preview */}
            <div className="bg-card rounded-[14px] border border-border overflow-hidden">
              <div className="flex items-center border-b border-border px-5 py-3">
                <h3 className="text-sm font-semibold text-foreground m-0 flex-1">Preview</h3>
                <div className="flex rounded-lg bg-muted p-0.5">
                  <button
                    onClick={() => setPreviewTab("preview")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors border-none",
                      previewTab === "preview"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Eye size={13} /> Rendered
                  </button>
                  <button
                    onClick={() => setPreviewTab("code")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors border-none",
                      previewTab === "code"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Code2 size={13} /> HTML
                  </button>
                </div>
              </div>

              {previewTab === "preview" ? (
                <div className="bg-white">
                  <iframe
                    srcDoc={renderPreviewHtml()}
                    title="Email preview"
                    className="w-full border-none min-h-[400px]"
                    sandbox="allow-same-origin"
                  />
                </div>
              ) : (
                <pre className="p-5 text-[12px] font-mono text-muted-foreground bg-background overflow-x-auto whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto m-0">
                  {form.bodyHtml || tc("noData")}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Preset Picker Modal */}
      {showPresetPicker && (
        <div
          className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowPresetPicker(false)}
        >
          <div
            className="bg-card rounded-xl border border-border p-6 w-full max-w-[640px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
                  <Layers size={18} className="text-primary" />
                </div>
                <h3 className="text-base font-semibold text-foreground m-0">
                  {t('presetTitle')}
                </h3>
              </div>
              <button
                onClick={() => setShowPresetPicker(false)}
                className="w-8 h-8 rounded-lg bg-muted border border-border text-muted-foreground hover:text-foreground cursor-pointer flex items-center justify-center transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-5 ml-11">
              {t('presetSubtitle')}
            </p>

            {/* 2×3 grid of preset cards */}
            <div className="grid grid-cols-2 gap-3">
              {TEMPLATE_PRESETS.map((preset) => {
                const Icon = PRESET_ICON_MAP[preset.icon];
                return (
                  <button
                    key={preset.id}
                    onClick={() => createFromPreset(preset)}
                    disabled={creatingFromPreset}
                    className="p-4 rounded-xl border border-border bg-[var(--bg-secondary)] text-left hover:border-primary/60 hover:bg-primary/5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                        <Icon size={15} className="text-primary" />
                      </div>
                      <h4 className="text-sm font-semibold text-foreground m-0 leading-tight">
                        {preset.name}
                      </h4>
                    </div>
                    <p className="text-xs text-muted-foreground m-0 leading-relaxed">
                      {preset.description}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2.5">
                      {preset.variables.slice(0, 3).map((v) => (
                        <span
                          key={v}
                          className="px-1.5 py-0.5 rounded bg-primary/8 text-primary text-[10px] font-mono border border-primary/15"
                        >
                          {`{{${v}}}`}
                        </span>
                      ))}
                      {preset.variables.length > 3 && (
                        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px]">
                          +{preset.variables.length - 3}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Footer hint */}
            <p className="text-xs text-muted-foreground text-center mt-4">
              La plantilla se creará lista para personalizar
            </p>
          </div>
        </div>
      )}

      {/* Test Email Modal */}
      {testModalOpen && (
        <div
          className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setTestModalOpen(false)}
        >
          <div
            className="bg-card rounded-xl border border-border p-6 w-[420px] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-foreground m-0 flex items-center gap-2">
                <Send size={18} className="text-primary" />
                Send test email
              </h3>
              <button
                onClick={() => setTestModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-muted border border-border text-muted-foreground hover:text-foreground cursor-pointer flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              A test email with sample data will be sent.
            </p>
            <label className={labelCls}>Destination email</label>
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="you@email.com"
              className={cn(inputCls, "mb-5")}
              onKeyDown={(e) => e.key === "Enter" && handleSendTest()}
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setTestModalOpen(false)}
                className="px-4 py-2.5 rounded-[10px] bg-muted border border-border text-foreground text-sm font-semibold cursor-pointer hover:bg-muted/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSendTest}
                disabled={sendingTest || !testEmail.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] bg-primary text-white border-none cursor-pointer text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Send size={14} />
                {sendingTest ? "Sending..." :  tc("save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
