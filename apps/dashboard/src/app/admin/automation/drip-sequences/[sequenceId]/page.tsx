"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter, useParams } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Zap,
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  Clock,
  MessageSquare,
  Bot,
  FileText,
  Play,
  Tag,
  UserPlus,
  ArrowRightLeft,
  Hand,
  ChevronDown,
  ChevronUp,
  GripVertical,
  X,
  Check,
  Users,
  Send,
} from "lucide-react";

interface DripStep {
  delay_seconds: number;
  message_type: "template" | "ai_generated" | "custom";
  content: string;
  template_name?: string;
  stop_if: string[];
}

interface DripSequence {
  id: string;
  name: string;
  trigger_event: string;
  trigger_conditions: any;
  steps: DripStep[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const TRIGGERS = [
  { value: "manual", icon: Hand, i18n: "triggerManual" },
  { value: "lead_captured", icon: UserPlus, i18n: "triggerLeadCaptured" },
  { value: "tag_added", icon: Tag, i18n: "triggerTagAdded" },
  { value: "stage_changed", icon: ArrowRightLeft, i18n: "triggerStageChanged" },
];

const MESSAGE_TYPE_ICONS: Record<string, typeof MessageSquare> = {
  template: FileText,
  custom: MessageSquare,
  ai_generated: Bot,
};

const STOP_CONDITIONS = ["replied", "converted"];

function emptyStep(): DripStep {
  return {
    delay_seconds: 3600,
    message_type: "custom",
    content: "",
    stop_if: ["replied"],
  };
}

function formatDelay(seconds: number): { value: number; unit: "minutes" | "hours" | "days" } {
  if (seconds >= 86400 && seconds % 86400 === 0) {
    return { value: seconds / 86400, unit: "days" };
  }
  if (seconds >= 3600 && seconds % 3600 === 0) {
    return { value: seconds / 3600, unit: "hours" };
  }
  return { value: Math.round(seconds / 60), unit: "minutes" };
}

function toSeconds(value: number, unit: string): number {
  if (unit === "days") return value * 86400;
  if (unit === "hours") return value * 3600;
  return value * 60;
}

export default function DripSequenceEditorPage() {
  const t = useTranslations("dripSequences");
  const tc = useTranslations("common");
  const { activeTenantId } = useTenant();
  const router = useRouter();
  const params = useParams();
  const sequenceId = params.sequenceId as string;
  const isNew = sequenceId === "new";

  const [name, setName] = useState("");
  const [triggerEvent, setTriggerEvent] = useState("manual");
  const [triggerConditions, setTriggerConditions] = useState<any>({});
  const [steps, setSteps] = useState<DripStep[]>([emptyStep()]);
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<number | null>(0);
  const [triggerConditionTag, setTriggerConditionTag] = useState("");
  const [triggerConditionStage, setTriggerConditionStage] = useState("");

  // Prospect-from-CRM (bulk-enroll a segment into this sequence)
  const [segments, setSegments] = useState<Array<{ id: string; name: string; contact_count?: number }>>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    if (!isNew && activeTenantId) {
      loadSequence();
      api.getSegments(activeTenantId).then((res: any) => {
        const list = res?.data ?? res ?? [];
        if (Array.isArray(list)) setSegments(list);
      }).catch(() => {});
    }
  }, [activeTenantId, sequenceId]);

  async function handleEnrollSegment() {
    if (!activeTenantId || !selectedSegmentId) return;
    setEnrolling(true);
    try {
      const res = await api.enrollDripSegment(activeTenantId, sequenceId, { segmentId: selectedSegmentId });
      if (res.success && res.data) {
        const d = res.data;
        showToast(t("prospecting.enrolledToast", { enrolled: d.enrolled, optout: d.skippedOptOut, dup: d.skippedDuplicate }));
      } else {
        showToast(t("prospecting.enrollError"));
      }
    } catch {
      showToast(t("prospecting.enrollError"));
    } finally {
      setEnrolling(false);
    }
  }

  async function loadSequence() {
    if (!activeTenantId) return;
    setLoading(true);
    try {
      const res = await api.getDripSequence(activeTenantId, sequenceId);
      if (res.success && res.data) {
        const seq = res.data as DripSequence;
        setName(seq.name);
        setTriggerEvent(seq.trigger_event);
        setTriggerConditions(seq.trigger_conditions || {});
        setSteps(seq.steps?.length ? seq.steps : [emptyStep()]);
        setIsActive(seq.is_active);
        if (seq.trigger_conditions?.tag) setTriggerConditionTag(seq.trigger_conditions.tag);
        if (seq.trigger_conditions?.stage) setTriggerConditionStage(seq.trigger_conditions.stage);
      }
    } catch (err) {
      console.error("Error loading sequence", err);
      showToast(t("toast.errorLoad"));
    } finally {
      setLoading(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function handleSave() {
    if (!activeTenantId || !name.trim()) return;
    setSaving(true);

    const conditions: any = {};
    if (triggerEvent === "tag_added" && triggerConditionTag) {
      conditions.tag = triggerConditionTag;
    }
    if (triggerEvent === "stage_changed" && triggerConditionStage) {
      conditions.stage = triggerConditionStage;
    }

    const payload = {
      name: name.trim(),
      trigger_event: triggerEvent,
      trigger_conditions: conditions,
      steps,
      is_active: isActive,
    };

    try {
      if (isNew) {
        const res = await api.createDripSequence(activeTenantId, payload);
        if (res.success) {
          showToast(t("toast.created"));
          router.push("/admin/automation/drip-sequences");
        } else {
          showToast(t("toast.errorSave"));
        }
      } else {
        const res = await api.updateDripSequence(activeTenantId, sequenceId, payload);
        if (res.success) {
          showToast(t("toast.updated"));
        } else {
          showToast(t("toast.errorSave"));
        }
      }
    } catch (err) {
      console.error("Error saving sequence", err);
      showToast(t("toast.errorSave"));
    } finally {
      setSaving(false);
    }
  }

  function updateStep(index: number, updates: Partial<DripStep>) {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, ...updates } : s));
  }

  function removeStep(index: number) {
    if (steps.length <= 1) return;
    setSteps(prev => prev.filter((_, i) => i !== index));
    if (expandedStep === index) {
      setExpandedStep(null);
    } else if (expandedStep !== null && expandedStep > index) {
      setExpandedStep(expandedStep - 1);
    }
  }

  function addStepAfter(index: number) {
    const newStep = emptyStep();
    setSteps(prev => [...prev.slice(0, index + 1), newStep, ...prev.slice(index + 1)]);
    setExpandedStep(index + 1);
  }

  function moveStep(index: number, direction: "up" | "down") {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= steps.length) return;
    const updated = [...steps];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    setSteps(updated);
    setExpandedStep(newIndex);
  }

  function toggleStopCondition(index: number, condition: string) {
    const step = steps[index];
    const current = step.stop_if || [];
    const next = current.includes(condition)
      ? current.filter(c => c !== condition)
      : [...current, condition];
    updateStep(index, { stop_if: next });
  }

  if (loading) {
    return (
      <div className="text-foreground">
        <PageHeader title={t("title")} icon={Zap} iconColor="bg-indigo-500/10" />
        <div className="text-center p-10 text-muted-foreground">{t("loading")}</div>
      </div>
    );
  }

  return (
    <div className="text-foreground">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push("/admin/automation/drip-sequences")}
          className="bg-transparent border-none text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
          {isNew ? t("newSequence") : t("editSequence")}
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
        <div className="space-y-6">
          <Card className="border-border bg-card">
            <CardContent className="p-5 space-y-4">
              <div>
                <Label className="text-xs font-semibold text-muted-foreground mb-1.5">
                  {t("sequenceName")}
                </Label>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t("sequenceNamePlaceholder")}
                  className="bg-background border-border text-[15px]"
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-muted-foreground mb-2">
                  {t("triggerEvent")}
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {TRIGGERS.map(tr => {
                    const Icon = tr.icon;
                    const selected = triggerEvent === tr.value;
                    return (
                      <div
                        key={tr.value}
                        onClick={() => setTriggerEvent(tr.value)}
                        className={cn(
                          "p-3 rounded-xl cursor-pointer transition-all duration-150 flex items-center gap-3",
                          selected
                            ? "border border-indigo-600 bg-indigo-600/15"
                            : "border border-border bg-neutral-100 dark:bg-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-600"
                        )}
                      >
                        <Icon size={18} className={cn(selected ? "text-indigo-600" : "text-muted-foreground")} />
                        <span className={cn("text-sm", selected ? "font-semibold text-foreground" : "text-muted-foreground")}>
                          {t(tr.i18n)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {triggerEvent === "tag_added" && (
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground mb-1.5">
                    {t("conditionTag")}
                  </Label>
                  <Input
                    value={triggerConditionTag}
                    onChange={e => setTriggerConditionTag(e.target.value)}
                    placeholder={t("conditionTagPlaceholder")}
                    className="bg-background border-border"
                  />
                </div>
              )}

              {triggerEvent === "stage_changed" && (
                <div>
                  <Label className="text-xs font-semibold text-muted-foreground mb-1.5">
                    {t("conditionStage")}
                  </Label>
                  <Input
                    value={triggerConditionStage}
                    onChange={e => setTriggerConditionStage(e.target.value)}
                    placeholder={t("conditionStagePlaceholder")}
                    className="bg-background border-border"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                {t("stepsTitle")}
              </h2>
              <Badge variant="secondary" className="bg-indigo-600/15 text-indigo-600 dark:text-indigo-400 text-[10px] px-2 py-0.5 font-semibold">
                {t("stepsCount", { count: steps.length })}
              </Badge>
            </div>

            <div className="relative">
              <div className="absolute left-[19px] top-0 bottom-0 w-[2px] bg-neutral-200 dark:bg-neutral-700 z-0" />

              <div className="relative z-10 space-y-0">
                {steps.map((step, index) => {
                  const delay = formatDelay(step.delay_seconds);
                  const MsgIcon = MESSAGE_TYPE_ICONS[step.message_type] || MessageSquare;
                  const isExpanded = expandedStep === index;

                  return (
                    <div key={index}>
                      <div className="flex items-start gap-3 mb-0">
                        <div className="flex flex-col items-center flex-shrink-0">
                          <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center border-2 bg-card z-10",
                            isExpanded
                              ? "border-indigo-500 text-indigo-500"
                              : "border-neutral-300 dark:border-neutral-600 text-muted-foreground"
                          )}>
                            <span className="text-xs font-semibold">{index + 1}</span>
                          </div>
                        </div>

                        <Card className={cn(
                          "flex-1 border-border bg-card transition-all duration-200",
                          isExpanded && "ring-1 ring-indigo-500/30"
                        )}>
                          <CardContent className="p-0">
                            <button
                              onClick={() => setExpandedStep(isExpanded ? null : index)}
                              className="w-full flex items-center justify-between p-4 bg-transparent border-none cursor-pointer text-left"
                            >
                              <div className="flex items-center gap-3">
                                <div className={cn(
                                  "w-8 h-8 rounded-lg flex items-center justify-center",
                                  step.message_type === "template" ? "bg-blue-500/10" :
                                  step.message_type === "ai_generated" ? "bg-purple-500/10" :
                                  "bg-emerald-500/10"
                                )}>
                                  <MsgIcon size={16} className={cn(
                                    step.message_type === "template" ? "text-blue-500" :
                                    step.message_type === "ai_generated" ? "text-purple-500" :
                                    "text-emerald-500"
                                  )} />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-foreground">
                                      {t("stepNumber", { number: index + 1 })}
                                    </span>
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                                      {t(step.message_type === "template" ? "template" :
                                         step.message_type === "ai_generated" ? "aiGenerated" : "custom")}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                                    <Clock size={11} />
                                    <span>
                                      {t("delayLabel", { value: delay.value, unit: t(delay.unit) })}
                                    </span>
                                    {step.stop_if?.length > 0 && (
                                      <>
                                        <span className="mx-1">|</span>
                                        <span>{t("stopsIf")}: {step.stop_if.map(s => t(`stop_${s}`)).join(", ")}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                              {isExpanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                            </button>

                            {isExpanded && (
                              <div className="px-4 pb-4 border-t border-border pt-4 space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <Label className="text-xs font-semibold text-muted-foreground mb-1.5">
                                      {t("delay")}
                                    </Label>
                                    <div className="flex gap-2">
                                      <Input
                                        type="number"
                                        min={1}
                                        value={delay.value}
                                        onChange={e => updateStep(index, { delay_seconds: toSeconds(Number(e.target.value), delay.unit) })}
                                        className="bg-background border-border w-24"
                                      />
                                      <select
                                        value={delay.unit}
                                        onChange={e => updateStep(index, { delay_seconds: toSeconds(delay.value, e.target.value) })}
                                        className="flex-1 p-2 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                                      >
                                        <option value="minutes">{t("minutes")}</option>
                                        <option value="hours">{t("hours")}</option>
                                        <option value="days">{t("days")}</option>
                                      </select>
                                    </div>
                                  </div>

                                  <div>
                                    <Label className="text-xs font-semibold text-muted-foreground mb-1.5">
                                      {t("messageType")}
                                    </Label>
                                    <select
                                      value={step.message_type}
                                      onChange={e => updateStep(index, {
                                        message_type: e.target.value as DripStep["message_type"],
                                        content: "",
                                        template_name: "",
                                      })}
                                      className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                                    >
                                      <option value="template">{t("template")}</option>
                                      <option value="custom">{t("custom")}</option>
                                      <option value="ai_generated">{t("aiGenerated")}</option>
                                    </select>
                                  </div>
                                </div>

                                {step.message_type === "template" && (
                                  <div>
                                    <Label className="text-xs font-semibold text-muted-foreground mb-1.5">
                                      {t("templateName")}
                                    </Label>
                                    <Input
                                      value={step.template_name || ""}
                                      onChange={e => updateStep(index, { template_name: e.target.value })}
                                      placeholder="follow_up_day1"
                                      className="bg-background border-border"
                                    />
                                  </div>
                                )}

                                {step.message_type === "custom" && (
                                  <div>
                                    <Label className="text-xs font-semibold text-muted-foreground mb-1.5">
                                      {t("content")}
                                    </Label>
                                    <textarea
                                      value={step.content || ""}
                                      onChange={e => updateStep(index, { content: e.target.value })}
                                      placeholder={t("contentPlaceholder")}
                                      rows={3}
                                      className="w-full p-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none resize-none"
                                    />
                                    <p className="text-[11px] text-muted-foreground mt-1">
                                      {t("contentVariablesHint")}
                                    </p>
                                  </div>
                                )}

                                {step.message_type === "ai_generated" && (
                                  <div>
                                    <Label className="text-xs font-semibold text-muted-foreground mb-1.5">
                                      {t("aiPrompt")}
                                    </Label>
                                    <textarea
                                      value={step.content || ""}
                                      onChange={e => updateStep(index, { content: e.target.value })}
                                      placeholder={t("aiPromptPlaceholder")}
                                      rows={2}
                                      className="w-full p-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none resize-none"
                                    />
                                  </div>
                                )}

                                <div>
                                  <Label className="text-xs font-semibold text-muted-foreground mb-1.5">
                                    {t("stopConditions")}
                                  </Label>
                                  <div className="flex gap-3">
                                    {STOP_CONDITIONS.map(cond => (
                                      <label key={cond} className="flex items-center gap-2 text-sm cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={step.stop_if?.includes(cond) || false}
                                          onChange={() => toggleStopCondition(index, cond)}
                                          className="rounded border-border accent-indigo-600"
                                        />
                                        {t(`stop_${cond}`)}
                                      </label>
                                    ))}
                                  </div>
                                </div>

                                <div className="flex items-center justify-between pt-2 border-t border-border">
                                  <div className="flex gap-1">
                                    <button
                                      onClick={() => moveStep(index, "up")}
                                      disabled={index === 0}
                                      className={cn(
                                        "bg-transparent border-none p-1.5 rounded cursor-pointer transition-colors",
                                        index === 0
                                          ? "text-neutral-300 dark:text-neutral-700 cursor-not-allowed"
                                          : "text-muted-foreground hover:text-foreground hover:bg-neutral-100 dark:hover:bg-neutral-800"
                                      )}
                                    >
                                      <ChevronUp size={14} />
                                    </button>
                                    <button
                                      onClick={() => moveStep(index, "down")}
                                      disabled={index === steps.length - 1}
                                      className={cn(
                                        "bg-transparent border-none p-1.5 rounded cursor-pointer transition-colors",
                                        index === steps.length - 1
                                          ? "text-neutral-300 dark:text-neutral-700 cursor-not-allowed"
                                          : "text-muted-foreground hover:text-foreground hover:bg-neutral-100 dark:hover:bg-neutral-800"
                                      )}
                                    >
                                      <ChevronDown size={14} />
                                    </button>
                                  </div>

                                  <button
                                    onClick={() => removeStep(index)}
                                    disabled={steps.length <= 1}
                                    className={cn(
                                      "flex items-center gap-1.5 bg-transparent border-none text-sm cursor-pointer transition-colors px-2 py-1 rounded",
                                      steps.length <= 1
                                        ? "text-neutral-300 dark:text-neutral-700 cursor-not-allowed"
                                        : "text-red-500 hover:bg-red-500/10"
                                    )}
                                  >
                                    <Trash2 size={13} /> {tc("delete")}
                                  </button>
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </div>

                      <div className="flex items-center gap-3 my-1 ml-[15px]">
                        <div className="w-[10px] flex justify-center">
                          <div className="w-[2px] h-4 bg-transparent" />
                        </div>
                        <button
                          onClick={() => addStepAfter(index)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-dashed border-neutral-300 dark:border-neutral-600 bg-transparent text-muted-foreground text-xs cursor-pointer hover:border-indigo-500 hover:text-indigo-500 transition-colors"
                        >
                          <Plus size={12} /> {t("addStep")}
                        </button>
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center flex-shrink-0">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center border-2 border-emerald-500 bg-card z-10">
                      <Check size={16} className="text-emerald-500" />
                    </div>
                  </div>
                  <div className="flex items-center h-10 text-sm text-muted-foreground">
                    {t("sequenceEnd")}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <Card className="border-border bg-card sticky top-4">
            <CardContent className="p-5 space-y-4">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {t("settings")}
              </h3>

              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">{t("activeToggle")}</span>
                <button
                  onClick={() => setIsActive(!isActive)}
                  className={cn(
                    "w-11 h-6 rounded-full border-none cursor-pointer relative transition-colors duration-200",
                    isActive ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"
                  )}
                >
                  <div className={cn(
                    "w-[18px] h-[18px] rounded-full bg-white absolute top-[3px] transition-[left] duration-200 shadow-sm",
                    isActive ? "left-[23px]" : "left-[3px]"
                  )} />
                </button>
              </div>

              <div className="border-t border-border pt-4 space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t("summary.trigger")}</span>
                  <span className="font-semibold text-foreground">
                    {t(TRIGGERS.find(tr => tr.value === triggerEvent)?.i18n || "triggerManual")}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t("summary.steps")}</span>
                  <span className="font-semibold text-foreground">{steps.length}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t("summary.totalDuration")}</span>
                  <span className="font-semibold text-foreground">
                    {(() => {
                      const total = steps.reduce((s, step) => s + step.delay_seconds, 0);
                      const d = formatDelay(total);
                      return `${d.value} ${t(d.unit)}`;
                    })()}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t("summary.status")}</span>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-[10px] px-2 py-0.5 font-semibold",
                      isActive
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-neutral-500/15 text-neutral-600 dark:text-neutral-400"
                    )}
                  >
                    {isActive ? t("statusActive") : t("statusDraft")}
                  </Badge>
                </div>
              </div>

              <Button
                onClick={handleSave}
                disabled={saving || !name.trim()}
                className={cn(
                  "w-full gap-2 transition-colors duration-200",
                  name.trim()
                    ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                    : "bg-neutral-200 dark:bg-neutral-700 text-muted-foreground cursor-not-allowed"
                )}
              >
                <Save size={16} />
                {saving ? t("saving") : isNew ? t("create") : tc("save")}
              </Button>

              <Button
                variant="outline"
                onClick={() => router.push("/admin/automation/drip-sequences")}
                className="w-full border-border"
              >
                {tc("cancel")}
              </Button>
            </CardContent>
          </Card>

          {!isNew && (
            <Card className="border-border bg-card">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-indigo-500" />
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {t("prospecting.title")}
                  </h3>
                </div>
                <p className="text-xs text-muted-foreground">{t("prospecting.desc")}</p>
                {!isActive && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">{t("prospecting.mustBeActive")}</p>
                )}
                <select
                  value={selectedSegmentId}
                  onChange={e => setSelectedSegmentId(e.target.value)}
                  className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                >
                  <option value="">{t("prospecting.selectSegment")}</option>
                  {segments.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}{typeof s.contact_count === "number" ? ` (${s.contact_count})` : ""}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={handleEnrollSegment}
                  disabled={enrolling || !selectedSegmentId || !isActive}
                  className={cn(
                    "w-full gap-2 transition-colors duration-200",
                    selectedSegmentId && isActive
                      ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                      : "bg-neutral-200 dark:bg-neutral-700 text-muted-foreground cursor-not-allowed"
                  )}
                >
                  <Send size={15} />
                  {enrolling ? t("prospecting.enrolling") : t("prospecting.enrollBtn")}
                </Button>
                <p className="text-[11px] text-muted-foreground">{t("prospecting.hint")}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {toast && (
        <div className={cn(
          "fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold text-white shadow-[0_4px_20px_rgba(0,0,0,0.3)] animate-in slide-in-from-bottom-2 fade-in duration-300",
          toast.includes("Error") || toast.includes("error") ? "bg-red-500" : "bg-emerald-500"
        )}>
          {toast}
        </div>
      )}
    </div>
  );
}
