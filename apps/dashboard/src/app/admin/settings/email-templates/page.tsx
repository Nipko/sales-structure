"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
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
  customer_name: "Maria Garcia",
  customer_email: "maria@ejemplo.com",
  company_name: "Parallly",
  company_logo: "https://placehold.co/120x40/6c5ce7/ffffff?text=Logo",
  service_name: "Plan Pro",
  appointment_date: "15 de abril, 2026",
  appointment_time: "10:30 AM",
  location: "Av. Reforma 123, CDMX",
  agent_name: "Carlos Lopez",
  order_id: "ORD-20260412-0042",
  order_items_html:
    '<table style="width:100%;border-collapse:collapse"><tr><td style="padding:4px 8px;border-bottom:1px solid #eee">Plan Pro x1</td><td style="text-align:right;padding:4px 8px;border-bottom:1px solid #eee">$49.00</td></tr></table>',
  order_total: "$49.00 USD",
  payment_method: "Tarjeta Visa ****4242",
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
// Component
// ---------------------------------------------------------------------------

export default function EmailTemplatesPage() {
  const t = useTranslations('emailTemplates');
    const tc = useTranslations("common");
  const { activeTenantId } = useTenant();

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
      showToast(t("errorLoading"), true);
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
      showToast("El nombre es obligatorio", true);
      return;
    }
    if (!form.subject.trim()) {
      showToast("El asunto es obligatorio", true);
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
        showToast(isCreating ? "Plantilla creada" : "Plantilla guardada");
        await loadTemplates();
        if (isCreating && res.data?.id) {
          setSelectedId(res.data.id);
          setIsCreating(false);
        }
      } else {
        showToast(res?.error || t("errorSaving") || "Error", true);
      }
    } catch {
      showToast(t("connectionError") || "Error", true);
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
      showToast("Plantilla eliminada");
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
        showToast(`Correo de prueba enviado a ${testEmail}`);
        setTestModalOpen(false);
        setTestEmail("");
      } else {
        showToast(res?.error || tc("errorSaving"), true);
      }
    } catch {
      showToast(t("connectionError") || "Error", true);
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
              Disena y gestiona los correos transaccionales de tu plataforma
            </p>
          </div>
        </div>
        <button
          onClick={startCreate}
          className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] bg-primary text-white border-none cursor-pointer text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          <Plus size={16} /> Crear plantilla
        </button>
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
          {loading ? (
            <div className="p-10 text-center text-muted-foreground">Cargando...</div>
          ) : templates.length === 0 ? (
            <div className="p-12 text-center bg-card rounded-[14px] border border-border">
              <Mail size={36} className="text-muted-foreground opacity-40 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm mb-4">No hay plantillas creadas</p>
              <button
                onClick={startCreate}
                className="px-5 py-2.5 rounded-[10px] bg-primary text-white border-none cursor-pointer text-sm font-semibold"
              >
                Crear primera plantilla
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
                        {t.isActive ? "Activa" : "Inactiva"}
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
                  <label className={labelCls}>Nombre</label>
                  <input
                    value={form.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="Ej: Bienvenida al cliente"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Slug (identificador unico)</label>
                  <input
                    value={form.slug}
                    onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))}
                    placeholder="bienvenida-cliente"
                    className={cn(inputCls, "font-mono text-[13px]")}
                  />
                </div>
              </div>

              {/* Subject */}
              <div className="mb-4">
                <label className={labelCls}>
                  Asunto{" "}
                  <span className="font-normal text-muted-foreground/70">
                    — Usa {"{{variable}}"} para datos dinamicos
                  </span>
                </label>
                <input
                  ref={subjectRef}
                  value={form.subject}
                  onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
                  placeholder='Ej: Hola {{customer_name}}, tu pedido {{order_id}} esta listo'
                  className={inputCls}
                />
              </div>

              {/* Variables */}
              <div className="mb-4">
                <label className={labelCls}>Variables disponibles</label>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Haz clic para insertar en el asunto o en el cuerpo (segun donde este el cursor)
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
                <label className={labelCls}>Cuerpo HTML</label>
                <textarea
                  ref={bodyRef}
                  value={form.bodyHtml}
                  onChange={(e) => setForm((prev) => ({ ...prev, bodyHtml: e.target.value }))}
                  placeholder="<h1>Hola {{customer_name}}</h1><p>Gracias por tu compra...</p>"
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
                  {form.isActive ? "Activa" : "Inactiva"}
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
                  {saving ? t("saving") : tc("saveChanges")}
                </button>
                {selectedId && !isCreating && (
                  <button
                    onClick={() => setTestModalOpen(true)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] bg-card border border-border text-foreground cursor-pointer text-sm font-semibold hover:bg-muted transition-colors"
                  >
                    <Send size={16} />
                    Enviar prueba
                  </button>
                )}
              </div>
            </div>

            {/* Preview */}
            <div className="bg-card rounded-[14px] border border-border overflow-hidden">
              <div className="flex items-center border-b border-border px-5 py-3">
                <h3 className="text-sm font-semibold text-foreground m-0 flex-1">Vista previa</h3>
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
                    <Eye size={13} /> Renderizado
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
                    title="Vista previa del correo"
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
                Enviar correo de prueba
              </h3>
              <button
                onClick={() => setTestModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-muted border border-border text-muted-foreground hover:text-foreground cursor-pointer flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Se enviara un correo con datos de ejemplo a la direccion indicada.
            </p>
            <label className={labelCls}>Correo electronico de destino</label>
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="tu@correo.com"
              className={cn(inputCls, "mb-5")}
              onKeyDown={(e) => e.key === "Enter" && handleSendTest()}
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setTestModalOpen(false)}
                className="px-4 py-2.5 rounded-[10px] bg-muted border border-border text-foreground text-sm font-semibold cursor-pointer hover:bg-muted/80 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSendTest}
                disabled={sendingTest || !testEmail.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] bg-primary text-white border-none cursor-pointer text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Send size={14} />
                {sendingTest ? "Enviando..." :  tc("save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
