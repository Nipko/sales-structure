"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Key,
  Plus,
  Copy,
  Check,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Loader2,
  Clock,
  Shield,
  Eye,
  X,
  Calendar,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

/* ------------------------------------------------------------------ */
/*  Scope definitions (grouped)                                        */
/* ------------------------------------------------------------------ */

const SCOPE_GROUPS = [
  { label: "contacts", scopes: ["read:contacts", "write:contacts"] },
  { label: "deals", scopes: ["read:deals", "write:deals"] },
  { label: "conversations", scopes: ["read:conversations"] },
  { label: "messages", scopes: ["write:messages"] },
  { label: "appointments", scopes: ["read:appointments", "write:appointments"] },
  { label: "webhooks", scopes: ["read:webhooks", "write:webhooks"] },
  { label: "analytics", scopes: ["read:analytics"] },
] as const;

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function ApiKeysPage() {
  const t = useTranslations("apiKeys");
  const tc = useTranslations("common");
  const { user } = useAuth();
  const { activeTenantId } = useTenant();
  const { features, loading: planLoading } = usePlanLimits();

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState<{ key: string; name: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState<string | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  /* ---- Load keys ---- */
  const loadKeys = useCallback(async () => {
    if (!activeTenantId) return;
    setLoading(true);
    try {
      const res = await api.listPublicApiKeys(activeTenantId);
      if (res.success && res.data) {
        setKeys(res.data);
      }
    } catch {
      // keep empty
    }
    setLoading(false);
  }, [activeTenantId]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  /* ---- Actions ---- */
  const handleCreate = async (name: string, scopes: string[], expiresAt: string | null) => {
    if (!activeTenantId) return;
    try {
      const res = await api.createPublicApiKey(activeTenantId, { name, scopes, ...(expiresAt ? { expiresAt } : {}) });
      if (res.success && res.data) {
        setShowCreateModal(false);
        setShowKeyModal({ key: res.data.key, name: res.data.name });
        showToast(t("toast.created"));
        loadKeys();
      } else {
        showToast(t("toast.error"), "error");
      }
    } catch {
      showToast(t("toast.error"), "error");
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!activeTenantId) return;
    try {
      const res = await api.revokePublicApiKey(activeTenantId, keyId);
      if (res.success) {
        setKeys((prev) => prev.filter((k) => k.id !== keyId));
        showToast(t("toast.revoked"));
      } else {
        showToast(t("toast.error"), "error");
      }
    } catch {
      showToast(t("toast.error"), "error");
    }
    setConfirmRevoke(null);
  };

  const handleRotate = async (keyId: string) => {
    if (!activeTenantId) return;
    try {
      const res = await api.rotatePublicApiKey(activeTenantId, keyId);
      if (res.success && res.data) {
        setShowKeyModal({ key: res.data.key, name: res.data.name || "" });
        showToast(t("toast.rotated"));
        loadKeys();
      } else {
        showToast(t("toast.error"), "error");
      }
    } catch {
      showToast(t("toast.error"), "error");
    }
    setConfirmRotate(null);
  };

  /* ---- Format helpers ---- */
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const scopeLabel = (scope: string) => {
    try {
      return t(`scopes.${scope.replace(":", "_")}`);
    } catch {
      return scope;
    }
  };

  /* ---- Plan gating ---- */
  const featureEnabled = !planLoading && features.publicApi;

  if (planLoading) {
    return (
      <div className="max-w-4xl space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} icon={Key} iconColor="bg-amber-500/10" />
        <div className="flex items-center gap-3 py-8">
          <Loader2 size={16} className="animate-spin text-neutral-400" />
          <span className="text-sm text-neutral-500">{tc("loading")}</span>
        </div>
      </div>
    );
  }

  if (!featureEnabled) {
    return (
      <div className="max-w-4xl space-y-6">
        <PageHeader title={t("title")} subtitle={t("subtitle")} icon={Key} iconColor="bg-amber-500/10" />
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle size={18} className="text-amber-500 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-300 flex-1">
            {t("upgradeRequired")}
          </p>
          <a
            href="/admin/settings/billing"
            className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold transition-colors shrink-0"
          >
            {t("upgradePlan")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        icon={Key}
        iconColor="bg-amber-500/10"
        action={
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white bg-neutral-900 dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-all press-effect"
          >
            <Plus size={16} />
            {t("createKey")}
          </button>
        }
      />

      {/* Key list */}
      {loading ? (
        <div className="flex items-center gap-3 py-8">
          <Loader2 size={16} className="animate-spin text-neutral-400" />
          <span className="text-sm text-neutral-500">{tc("loading")}</span>
        </div>
      ) : keys.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="w-12 h-12 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
            <Key size={24} className="text-neutral-300 dark:text-neutral-600" />
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("noKeys")}</p>
          <p className="text-xs text-neutral-400">{t("noKeysHint")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((k) => (
            <div
              key={k.id}
              className="bg-card border border-border rounded-[14px] p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  {/* Name + prefix */}
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                      {k.name}
                    </h3>
                    <code className="shrink-0 text-xs font-mono px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400">
                      {k.keyPrefix}...
                    </code>
                  </div>

                  {/* Scopes */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {k.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20"
                      >
                        {scopeLabel(scope)}
                      </span>
                    ))}
                  </div>

                  {/* Metadata row */}
                  <div className="flex items-center gap-4 text-[11px] text-neutral-400">
                    <span className="flex items-center gap-1">
                      <Calendar size={11} />
                      {t("createdAt")}: {formatDate(k.createdAt)}
                    </span>
                    {k.expiresAt && (
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        {t("expiresAt")}: {formatDate(k.expiresAt)}
                      </span>
                    )}
                    {k.lastUsedAt && (
                      <span className="flex items-center gap-1">
                        <Eye size={11} />
                        {t("lastUsedAt")}: {formatDate(k.lastUsedAt)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setConfirmRotate(k.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                  >
                    <RefreshCw size={13} />
                    {t("rotate")}
                  </button>
                  <button
                    onClick={() => setConfirmRevoke(k.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 rounded-lg border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 size={13} />
                    {t("revoke")}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Key Modal */}
      {showCreateModal && (
        <CreateKeyModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
        />
      )}

      {/* Show Key Modal (copy-once) */}
      {showKeyModal && (
        <ShowKeyModal
          apiKey={showKeyModal.key}
          name={showKeyModal.name}
          onClose={() => setShowKeyModal(null)}
        />
      )}

      {/* Confirm Revoke Modal */}
      {confirmRevoke && (
        <ConfirmModal
          title={t("confirmRevoke")}
          description={t("confirmRevokeDesc")}
          confirmLabel={t("revoke")}
          variant="danger"
          onConfirm={() => handleRevoke(confirmRevoke)}
          onCancel={() => setConfirmRevoke(null)}
        />
      )}

      {/* Confirm Rotate Modal */}
      {confirmRotate && (
        <ConfirmModal
          title={t("confirmRotate")}
          description={t("confirmRotateDesc")}
          confirmLabel={t("rotate")}
          variant="warning"
          onConfirm={() => handleRotate(confirmRotate)}
          onCancel={() => setConfirmRotate(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold text-white shadow-lg animate-in slide-in-from-bottom-2 fade-in duration-300",
            toast.type === "error" ? "bg-red-500" : "bg-emerald-500"
          )}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Create Key Modal                                                   */
/* ================================================================== */

function CreateKeyModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, scopes: string[], expiresAt: string | null) => Promise<void>;
}) {
  const t = useTranslations("apiKeys");
  const tc = useTranslations("common");

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleScope = (scope: string) => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const canSubmit = name.trim().length > 0 && scopes.size > 0 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    await onCreate(name.trim(), Array.from(scopes), expiresAt || null);
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-6 max-w-lg w-full mx-4 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {t("createKey")}
          </h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-5">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
              {t("modal.name")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("modal.namePlaceholder")}
              className="w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors"
            />
          </div>

          {/* Scopes */}
          <div>
            <label className="mb-2 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
              {t("modal.scopes")}
            </label>
            <div className="space-y-3">
              {SCOPE_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 mb-1.5">
                    {t(`scopeGroups.${group.label}`)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {group.scopes.map((scope) => {
                      const active = scopes.has(scope);
                      return (
                        <button
                          key={scope}
                          type="button"
                          onClick={() => toggleScope(scope)}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer",
                            active
                              ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/30"
                              : "bg-neutral-50 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600"
                          )}
                        >
                          {active && <Check size={12} />}
                          {t(`scopes.${scope.replace(":", "_")}`)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Expiry */}
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-neutral-700 dark:text-neutral-300">
              {t("modal.expiry")}
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().split("T")[0]}
              className="w-full h-10 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors"
            />
            <p className="mt-1 text-xs text-neutral-400">{t("modal.expiryHint")}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg text-sm font-medium text-neutral-600 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
          >
            {tc("cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={cn(
              "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white transition-all press-effect",
              canSubmit
                ? "bg-neutral-900 dark:bg-white dark:text-neutral-900 hover:opacity-90"
                : "bg-neutral-300 dark:bg-neutral-700 cursor-not-allowed"
            )}
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {t("modal.create")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Show Key Modal (copy-once pattern)                                 */
/* ================================================================== */

function ShowKeyModal({
  apiKey,
  name,
  onClose,
}: {
  apiKey: string;
  name: string;
  onClose: () => void;
}) {
  const t = useTranslations("apiKeys");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = apiKey;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-6 max-w-lg w-full mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-5">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
            <Key size={24} className="text-emerald-500" />
          </div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
            {t("keyCreated")}
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {name}
          </p>
        </div>

        {/* Warning */}
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-4 py-3 mb-4">
          <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-300">{t("copyWarning")}</p>
        </div>

        {/* Key display */}
        <div className="relative rounded-lg bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 p-4">
          <code className="text-sm font-mono text-neutral-700 dark:text-neutral-300 break-all select-all block pr-10">
            {apiKey}
          </code>
          <button
            onClick={handleCopy}
            className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-600 transition-colors"
          >
            {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
            {copied ? t("copied") : t("copy")}
          </button>
        </div>

        {/* Close */}
        <div className="flex justify-end mt-5">
          <button
            onClick={onClose}
            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white bg-neutral-900 dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-all press-effect"
          >
            <Check size={16} />
            {t("done")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Confirm Modal                                                      */
/* ================================================================== */

function ConfirmModal({
  title,
  description,
  confirmLabel,
  variant,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  variant: "danger" | "warning";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const tc = useTranslations("common");
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    await onConfirm();
    setLoading(false);
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 p-6 max-w-sm w-full mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center">
          <div
            className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3",
              variant === "danger" ? "bg-red-500/10" : "bg-amber-500/10"
            )}
          >
            <AlertTriangle
              size={24}
              className={variant === "danger" ? "text-red-500" : "text-amber-500"}
            />
          </div>
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
            {title}
          </h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-5">
            {description}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-sm font-semibold text-neutral-600 dark:text-neutral-300 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
            >
              {tc("cancel")}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white cursor-pointer transition-colors",
                variant === "danger"
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-amber-500 hover:bg-amber-600",
                loading && "opacity-50 cursor-not-allowed"
              )}
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
