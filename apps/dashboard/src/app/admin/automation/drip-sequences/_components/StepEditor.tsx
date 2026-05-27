"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X, GripVertical } from "lucide-react";

interface DripStep {
    delay_seconds: number;
    message_type: "template" | "custom" | "ai_generated";
    content?: string;
    template_name?: string;
    template_language?: string;
    stop_conditions?: string[];
}

interface StepEditorProps {
    step: DripStep;
    index: number;
    onChange: (index: number, step: DripStep) => void;
    onRemove: (index: number) => void;
    t: (key: string, values?: Record<string, any>) => string;
}

export default function StepEditor({ step, index, onChange, onRemove, t }: StepEditorProps) {
    const delayHours = Math.floor(step.delay_seconds / 3600);
    const delayDays = Math.floor(step.delay_seconds / 86400);
    const delayUnit = step.delay_seconds >= 86400 ? "days" : "hours";
    const delayValue = delayUnit === "days" ? delayDays : delayHours;

    function handleDelayChange(value: number, unit: string) {
        const seconds = unit === "days" ? value * 86400 : value * 3600;
        onChange(index, { ...step, delay_seconds: seconds });
    }

    function handleStopCondition(condition: string, checked: boolean) {
        const current = step.stop_conditions || [];
        const next = checked
            ? [...current, condition]
            : current.filter(c => c !== condition);
        onChange(index, { ...step, stop_conditions: next });
    }

    return (
        <Card className="border-border bg-card relative">
            <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <GripVertical size={16} className="text-muted-foreground" />
                        <span className="text-sm font-semibold text-foreground">
                            {t("stepNumber", { number: index + 1 })}
                        </span>
                    </div>
                    <button
                        onClick={() => onRemove(index)}
                        className="bg-transparent border-none text-red-500 cursor-pointer p-1 opacity-70 hover:opacity-100"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                    {/* Delay */}
                    <div>
                        <Label className="text-xs font-semibold text-muted-foreground mb-1">
                            {t("delay")}
                        </Label>
                        <div className="flex gap-2">
                            <Input
                                type="number"
                                min={0}
                                value={delayValue}
                                onChange={e => handleDelayChange(Number(e.target.value), delayUnit)}
                                className="bg-background border-border w-20"
                            />
                            <select
                                value={delayUnit}
                                onChange={e => handleDelayChange(delayValue, e.target.value)}
                                className="flex-1 p-2 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                            >
                                <option value="hours">{t("hours")}</option>
                                <option value="days">{t("days")}</option>
                            </select>
                        </div>
                    </div>

                    {/* Message Type */}
                    <div>
                        <Label className="text-xs font-semibold text-muted-foreground mb-1">
                            {t("messageType")}
                        </Label>
                        <select
                            value={step.message_type}
                            onChange={e => onChange(index, { ...step, message_type: e.target.value as any, content: "", template_name: "" })}
                            className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                        >
                            <option value="template">{t("template")}</option>
                            <option value="custom">{t("custom")}</option>
                            <option value="ai_generated">{t("aiGenerated")}</option>
                        </select>
                    </div>
                </div>

                {/* Content field based on type */}
                {step.message_type === "template" && (
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                            <Label className="text-xs font-semibold text-muted-foreground mb-1">
                                {t("templateName")}
                            </Label>
                            <Input
                                value={step.template_name || ""}
                                onChange={e => onChange(index, { ...step, template_name: e.target.value })}
                                placeholder="follow_up"
                                className="bg-background border-border"
                            />
                        </div>
                        <div>
                            <Label className="text-xs font-semibold text-muted-foreground mb-1">
                                {t("language")}
                            </Label>
                            <select
                                value={step.template_language || "es"}
                                onChange={e => onChange(index, { ...step, template_language: e.target.value })}
                                className="w-full p-2 rounded-lg border border-border bg-background text-foreground text-sm outline-none"
                            >
                                <option value="es">Espanol</option>
                                <option value="en">English</option>
                                <option value="pt">Portugues</option>
                                <option value="fr">Francais</option>
                            </select>
                        </div>
                    </div>
                )}

                {step.message_type === "custom" && (
                    <div className="mb-3">
                        <Label className="text-xs font-semibold text-muted-foreground mb-1">
                            {t("content")}
                        </Label>
                        <textarea
                            value={step.content || ""}
                            onChange={e => onChange(index, { ...step, content: e.target.value })}
                            placeholder="{name}, ..."
                            rows={3}
                            className="w-full p-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none resize-none"
                        />
                        <p className="text-[11px] text-muted-foreground mt-1">
                            {"{name}"} = contact name
                        </p>
                    </div>
                )}

                {step.message_type === "ai_generated" && (
                    <div className="mb-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs">
                        AI-generated messages coming soon
                    </div>
                )}

                {/* Stop conditions */}
                <div>
                    <Label className="text-xs font-semibold text-muted-foreground mb-1.5">
                        {t("stopConditions")}
                    </Label>
                    <div className="flex gap-4">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={step.stop_conditions?.includes("replied") || false}
                                onChange={e => handleStopCondition("replied", e.target.checked)}
                                className="rounded border-border"
                            />
                            {t("stopIfReplied")}
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={step.stop_conditions?.includes("converted") || false}
                                onChange={e => handleStopCondition("converted", e.target.checked)}
                                className="rounded border-border"
                            />
                            {t("stopIfConverted")}
                        </label>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
