"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sparkles,
  Search,
  X,
  Download,
  Check,
  Loader2,
  ExternalLink,
  TrendingUp,
  Zap,
  Mail,
  Clock,
  UserPlus,
  ShoppingCart,
  Star,
  Moon,
  Heart,
  Send,
  MessageSquare,
  RefreshCw,
  Gift,
  Bell,
  Target,
  Calendar,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  zap: Zap,
  mail: Mail,
  clock: Clock,
  "user-plus": UserPlus,
  "shopping-cart": ShoppingCart,
  star: Star,
  moon: Moon,
  heart: Heart,
  send: Send,
  "message-square": MessageSquare,
  "refresh-cw": RefreshCw,
  gift: Gift,
  bell: Bell,
  target: Target,
  sparkles: Sparkles,
  calendar: Calendar,
};

const CATEGORIES = [
  "lead_nurturing",
  "appointment_reminders",
  "abandoned_cart",
  "welcome_sequence",
  "reactivation",
  "feedback_collection",
  "vip_treatment",
  "after_hours",
] as const;

const INDUSTRIES = [
  "servicios_profesionales",
  "salud",
  "inmobiliaria",
  "restaurante",
  "automotriz",
  "turismo",
  "educacion",
  "seguros",
  "legal",
  "retail",
  "saas",
  "general",
] as const;

interface TemplateVariable {
  key: string;
  label: Record<string, string>;
  defaultValue: string;
  type: string;
}

interface AutomationTemplate {
  id: string;
  name: Record<string, string>;
  description: Record<string, string>;
  category: string;
  industry: string | null;
  icon: string;
  triggerConfig: any;
  actionsConfig: any[];
  variables: TemplateVariable[];
  popularityCount: number;
  createdAt: string;
}

function getLocale(): string {
  if (typeof window !== "undefined") {
    return document.cookie.match(/NEXT_LOCALE=(\w+)/)?.[1] || "es";
  }
  return "es";
}

function getLocalizedText(obj: Record<string, string>): string {
  const locale = getLocale();
  return obj[locale] || obj.es || obj.en || "";
}

export default function AutomationTemplatesPage() {
  const t = useTranslations("automationTemplates");
  const tc = useTranslations("common");
  const { activeTenantId } = useTenant();

  const [templates, setTemplates] = useState<AutomationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");

  const [selectedTemplate, setSelectedTemplate] = useState<AutomationTemplate | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState(false);
  const [installSuccess, setInstallSuccess] = useState(false);

  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadTemplates();
  }, [categoryFilter, industryFilter]);

  async function loadTemplates() {
    setLoading(true);
    try {
      const res = await api.listAutomationTemplates(
        categoryFilter || undefined,
        industryFilter || undefined
      );
      if (res.success && Array.isArray(res.data)) {
        setTemplates(res.data);
      }
    } catch (err) {
      console.error("Error loading templates", err);
    } finally {
      setLoading(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return templates;
    const q = searchQuery.toLowerCase();
    return templates.filter((tpl) => {
      const name = getLocalizedText(tpl.name).toLowerCase();
      const desc = getLocalizedText(tpl.description).toLowerCase();
      return name.includes(q) || desc.includes(q);
    });
  }, [templates, searchQuery]);

  function openInstallModal(tpl: AutomationTemplate) {
    setSelectedTemplate(tpl);
    setInstallSuccess(false);
    const defaults: Record<string, string> = {};
    if (tpl.variables) {
      tpl.variables.forEach((v) => {
        defaults[v.key] = v.defaultValue || "";
      });
    }
    setVariableValues(defaults);
  }

  function closeModal() {
    setSelectedTemplate(null);
    setVariableValues({});
    setInstalling(false);
    setInstallSuccess(false);
  }

  async function handleInstall() {
    if (!selectedTemplate || !activeTenantId) return;
    setInstalling(true);
    try {
      const res = await api.installAutomationTemplate(
        activeTenantId,
        selectedTemplate.id,
        variableValues
      );
      if (res.success) {
        setInstallSuccess(true);
        showToast(t("modal.success"));
      } else {
        showToast(t("modal.error"));
      }
    } catch {
      showToast(t("modal.error"));
    } finally {
      setInstalling(false);
    }
  }

  function getIcon(iconName: string): LucideIcon {
    return ICON_MAP[iconName] || Zap;
  }

  const CATEGORY_COLORS: Record<string, string> = {
    lead_nurturing: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    appointment_reminders: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    abandoned_cart: "bg-red-500/15 text-red-600 dark:text-red-400",
    welcome_sequence: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    reactivation: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    feedback_collection: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
    vip_treatment: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
    after_hours: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  };

  return (
    <div className="text-foreground">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        icon={Sparkles}
        iconColor="bg-indigo-500/10"
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("search")}
            className="pl-9 bg-background border-border"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none text-muted-foreground cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="h-9 px-3 rounded-md border border-border bg-background text-foreground text-sm outline-none min-w-[180px]"
        >
          <option value="">{t("category")}</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {t(`categories.${cat}`)}
            </option>
          ))}
        </select>

        <select
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
          className="h-9 px-3 rounded-md border border-border bg-background text-foreground text-sm outline-none min-w-[180px]"
        >
          <option value="">{t("industry")}</option>
          <option value="universal">{t("industries.universal")}</option>
          {INDUSTRIES.map((ind) => (
            <option key={ind} value={ind}>
              {t(`industries.${ind}`)}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="border-border bg-card animate-pulse">
              <CardContent className="p-5">
                <div className="w-10 h-10 rounded-xl bg-neutral-200 dark:bg-neutral-700 mb-4" />
                <div className="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-3/4 mb-2" />
                <div className="h-3 bg-neutral-200 dark:bg-neutral-700 rounded w-full mb-1" />
                <div className="h-3 bg-neutral-200 dark:bg-neutral-700 rounded w-2/3 mb-4" />
                <div className="flex gap-2">
                  <div className="h-5 bg-neutral-200 dark:bg-neutral-700 rounded-full w-20" />
                  <div className="h-5 bg-neutral-200 dark:bg-neutral-700 rounded-full w-16" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 px-4 rounded-xl border border-dashed border-border bg-card text-muted-foreground">
          <Sparkles size={40} className="mb-3 opacity-40 mx-auto" />
          <div className="text-base font-semibold mb-1">{t("empty.title")}</div>
          <div className="text-sm">{t("empty.subtitle")}</div>
          {(searchQuery || categoryFilter || industryFilter) && (
            <Button
              variant="outline"
              onClick={() => {
                setSearchQuery("");
                setCategoryFilter("");
                setIndustryFilter("");
              }}
              className="mt-4 gap-2 border-border"
            >
              <X size={14} /> {t("empty.clearFilters")}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((tpl) => {
            const Icon = getIcon(tpl.icon);
            return (
              <Card
                key={tpl.id}
                className="border-border bg-card hover:border-indigo-500/30 transition-colors duration-200 group"
              >
                <CardContent className="p-5 flex flex-col h-full">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0">
                      <Icon size={20} className="text-indigo-500" />
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground text-xs">
                      <TrendingUp size={12} />
                      <span>{tpl.popularityCount}</span>
                    </div>
                  </div>

                  <h3 className="text-sm font-semibold text-foreground mb-1.5 line-clamp-1">
                    {getLocalizedText(tpl.name)}
                  </h3>
                  <p className="text-xs text-muted-foreground mb-4 line-clamp-2 flex-1">
                    {getLocalizedText(tpl.description)}
                  </p>

                  <div className="flex flex-wrap gap-1.5 mb-4">
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px] px-2 py-0.5 font-semibold border-0",
                        CATEGORY_COLORS[tpl.category] ||
                          "bg-neutral-500/15 text-neutral-600 dark:text-neutral-400"
                      )}
                    >
                      {t(`categories.${tpl.category}`)}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-2 py-0.5 font-semibold border-0 bg-neutral-500/10 text-neutral-600 dark:text-neutral-400"
                    >
                      {tpl.industry
                        ? t(`industries.${tpl.industry}`)
                        : t("industries.universal")}
                    </Badge>
                  </div>

                  <Button
                    onClick={() => openInstallModal(tpl)}
                    className="w-full gap-2 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:opacity-90 press-effect"
                    size="sm"
                  >
                    <Download size={14} /> {t("install")}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {selectedTemplate && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-indigo-500/10 flex items-center justify-center shrink-0">
                    {(() => {
                      const Icon = getIcon(selectedTemplate.icon);
                      return <Icon size={22} className="text-indigo-500" />;
                    })()}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">
                      {t("modal.title")}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {getLocalizedText(selectedTemplate.name)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={closeModal}
                  className="bg-transparent border-none text-muted-foreground cursor-pointer p-1 hover:text-foreground"
                >
                  <X size={18} />
                </button>
              </div>

              <p className="text-sm text-muted-foreground mb-5">
                {getLocalizedText(selectedTemplate.description)}
              </p>

              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="p-3 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-border">
                  <div className="text-xs text-muted-foreground mb-0.5">
                    {t("modal.trigger")}
                  </div>
                  <div className="text-sm font-semibold text-foreground">
                    {selectedTemplate.triggerConfig?.type || "-"}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-border">
                  <div className="text-xs text-muted-foreground mb-0.5">
                    {t("modal.actions")}
                  </div>
                  <div className="text-sm font-semibold text-foreground">
                    {selectedTemplate.actionsConfig?.length || 0}{" "}
                    {t("modal.actionsCount")}
                  </div>
                </div>
              </div>

              {selectedTemplate.variables &&
                selectedTemplate.variables.length > 0 && (
                  <div className="mb-5">
                    <h3 className="text-sm font-semibold text-foreground mb-3">
                      {t("modal.variables")}
                    </h3>
                    <div className="flex flex-col gap-3">
                      {selectedTemplate.variables.map((v) => (
                        <div key={v.key}>
                          <Label className="text-xs font-semibold text-muted-foreground mb-1">
                            {getLocalizedText(v.label)}
                          </Label>
                          {v.type === "textarea" ? (
                            <textarea
                              value={variableValues[v.key] || ""}
                              onChange={(e) =>
                                setVariableValues((prev) => ({
                                  ...prev,
                                  [v.key]: e.target.value,
                                }))
                              }
                              rows={3}
                              className="w-full p-2.5 px-3 rounded-lg border border-border bg-background text-foreground text-sm outline-none resize-none"
                            />
                          ) : v.type === "number" ? (
                            <Input
                              type="number"
                              value={variableValues[v.key] || ""}
                              onChange={(e) =>
                                setVariableValues((prev) => ({
                                  ...prev,
                                  [v.key]: e.target.value,
                                }))
                              }
                              className="bg-background border-border"
                            />
                          ) : (
                            <Input
                              value={variableValues[v.key] || ""}
                              onChange={(e) =>
                                setVariableValues((prev) => ({
                                  ...prev,
                                  [v.key]: e.target.value,
                                }))
                              }
                              className="bg-background border-border"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {installSuccess ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
                    <Check size={24} className="text-emerald-500" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {t("installed")}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={closeModal}
                      className="gap-2 border-border"
                      size="sm"
                    >
                      {tc("close")}
                    </Button>
                    <Button
                      onClick={() => {
                        closeModal();
                        window.location.href = "/admin/automation";
                      }}
                      className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
                      size="sm"
                    >
                      <ExternalLink size={14} /> {t("viewRules")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={handleInstall}
                  disabled={installing || !activeTenantId}
                  className={cn(
                    "w-full py-3 rounded-lg text-sm font-semibold transition-colors duration-200",
                    installing || !activeTenantId
                      ? "bg-neutral-200 dark:bg-neutral-700 text-muted-foreground cursor-not-allowed"
                      : "bg-indigo-600 hover:bg-indigo-700 text-white"
                  )}
                >
                  {installing ? (
                    <>
                      <Loader2 size={16} className="animate-spin mr-2" />
                      {t("installing")}
                    </>
                  ) : (
                    <>
                      <Download size={16} className="mr-2" />
                      {t("modal.install")}
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold text-white shadow-[0_4px_20px_rgba(0,0,0,0.3)] animate-in slide-in-from-bottom-2 fade-in duration-300",
            toast.includes("Error") || toast.includes("error")
              ? "bg-red-500"
              : "bg-emerald-500"
          )}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
