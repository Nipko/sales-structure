"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useTenant } from "@/contexts/TenantContext";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import {
    GripVertical, Plus, Trash2, Save, Loader2, Settings, Eye, EyeOff,
} from "lucide-react";

interface PipelineStage {
    id?: string;
    name: string;
    slug: string;
    color: string;
    position: number;
    default_probability: number;
    sla_hours: number | null;
    is_terminal: boolean;
}

const DEFAULT_STAGES: PipelineStage[] = [
    { name: 'Nuevo', slug: 'nuevo', color: '#95a5a6', position: 0, default_probability: 10, sla_hours: null, is_terminal: false },
    { name: 'Contactado', slug: 'contactado', color: '#3498db', position: 1, default_probability: 20, sla_hours: null, is_terminal: false },
    { name: 'Respondió', slug: 'respondio', color: '#9b59b6', position: 2, default_probability: 30, sla_hours: null, is_terminal: false },
    { name: 'Calificado', slug: 'calificado', color: '#e67e22', position: 3, default_probability: 50, sla_hours: null, is_terminal: false },
    { name: 'Tibio', slug: 'tibio', color: '#f39c12', position: 4, default_probability: 60, sla_hours: null, is_terminal: false },
    { name: 'Caliente', slug: 'caliente', color: '#e74c3c', position: 5, default_probability: 80, sla_hours: null, is_terminal: false },
    { name: 'Listo para cierre', slug: 'listo_cierre', color: '#27ae60', position: 6, default_probability: 95, sla_hours: null, is_terminal: false },
    { name: 'Ganado', slug: 'ganado', color: '#2ecc71', position: 7, default_probability: 100, sla_hours: null, is_terminal: true },
    { name: 'Perdido', slug: 'perdido', color: '#7f8c8d', position: 8, default_probability: 0, sla_hours: null, is_terminal: true },
    { name: 'No interesado', slug: 'no_interesado', color: '#bdc3c7', position: 9, default_probability: 0, sla_hours: null, is_terminal: true },
];

export default function PipelineSettingsPage() {
    const t = useTranslations("pipelineSettings");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [stages, setStages] = useState<PipelineStage[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [dragIdx, setDragIdx] = useState<number | null>(null);

    useEffect(() => {
        if (!activeTenantId) return;
        setLoading(true);
        api.fetch(`/crm/pipeline-stages/${activeTenantId}`)
            .then((res: any) => {
                const data = res?.data || [];
                if (data.length > 0) {
                    setStages(data.map((s: any, i: number) => ({ ...s, position: s.position ?? i })));
                } else {
                    setStages(DEFAULT_STAGES);
                }
            })
            .catch(() => setStages(DEFAULT_STAGES))
            .finally(() => setLoading(false));
    }, [activeTenantId]);

    const handleSave = async () => {
        if (!activeTenantId) return;
        setSaving(true);
        try {
            // Delete all existing stages and recreate
            const existingRes = await api.fetch(`/crm/pipeline-stages/${activeTenantId}`);
            const existing = existingRes?.data || [];
            for (const s of existing) {
                await api.fetch(`/crm/pipeline-stages/${activeTenantId}/${s.id}`, { method: 'DELETE' });
            }

            // Create all stages in order
            for (let i = 0; i < stages.length; i++) {
                const s = stages[i];
                await api.fetch(`/crm/pipeline-stages/${activeTenantId}`, {
                    method: 'POST',
                    body: JSON.stringify({
                        name: s.name,
                        slug: s.slug,
                        color: s.color,
                        position: i,
                        default_probability: s.default_probability,
                        sla_hours: s.sla_hours,
                        is_terminal: s.is_terminal,
                    }),
                });
            }
            setDirty(false);
        } catch (err) {
            console.error('Failed to save pipeline stages:', err);
        } finally {
            setSaving(false);
        }
    };

    const addStage = () => {
        const newPos = stages.length;
        setStages([...stages, {
            name: '',
            slug: '',
            color: '#3498db',
            position: newPos,
            default_probability: 0,
            sla_hours: null,
            is_terminal: false,
        }]);
        setDirty(true);
    };

    const removeStage = (idx: number) => {
        setStages(stages.filter((_, i) => i !== idx));
        setDirty(true);
    };

    const updateStage = (idx: number, field: string, value: any) => {
        setStages(stages.map((s, i) => {
            if (i !== idx) return s;
            const updated = { ...s, [field]: value };
            if (field === 'name' && !s.id) {
                updated.slug = value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            }
            return updated;
        }));
        setDirty(true);
    };

    const handleDrop = (dropIdx: number) => {
        if (dragIdx === null || dragIdx === dropIdx) return;
        const reordered = [...stages];
        const [moved] = reordered.splice(dragIdx, 1);
        reordered.splice(dropIdx, 0, moved);
        setStages(reordered);
        setDragIdx(null);
        setDirty(true);
    };

    if (loading) {
        return <div className="flex items-center justify-center h-[400px] text-muted-foreground"><Loader2 className="animate-spin" /></div>;
    }

    return (
        <div className="max-w-[800px] mx-auto pb-20">
            <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
                icon={Settings}
            />

            <div className="bg-card border border-border rounded-xl overflow-hidden">
                {/* Header row */}
                <div className="grid grid-cols-[40px_1fr_80px_100px_80px_40px] gap-2 px-4 py-3 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    <div></div>
                    <div>{t("name")}</div>
                    <div>{t("color")}</div>
                    <div>{t("probability")}</div>
                    <div>{t("terminal")}</div>
                    <div></div>
                </div>

                {/* Stage rows */}
                {stages.map((stage, idx) => (
                    <div
                        key={idx}
                        draggable
                        onDragStart={() => setDragIdx(idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleDrop(idx)}
                        className={cn(
                            "grid grid-cols-[40px_1fr_80px_100px_80px_40px] gap-2 px-4 py-2.5 border-b border-border items-center transition-colors",
                            dragIdx === idx && "opacity-50 bg-indigo-50 dark:bg-indigo-500/10"
                        )}
                    >
                        <div className="cursor-grab text-muted-foreground"><GripVertical size={16} /></div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: stage.color }} />
                            <input
                                type="text"
                                value={stage.name}
                                onChange={(e) => updateStage(idx, 'name', e.target.value)}
                                placeholder={t("stageName")}
                                className="w-full px-2 py-1.5 rounded-lg border border-border bg-transparent text-sm outline-none focus:border-indigo-500/50"
                            />
                        </div>
                        <input
                            type="color"
                            value={stage.color}
                            onChange={(e) => updateStage(idx, 'color', e.target.value)}
                            className="w-8 h-8 rounded cursor-pointer border-none"
                        />
                        <div className="flex items-center gap-1">
                            <input
                                type="number"
                                min={0}
                                max={100}
                                value={stage.default_probability}
                                onChange={(e) => updateStage(idx, 'default_probability', Number(e.target.value))}
                                className="w-16 px-2 py-1.5 rounded-lg border border-border bg-transparent text-sm outline-none text-center"
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                        </div>
                        <div className="flex justify-center">
                            <button
                                onClick={() => updateStage(idx, 'is_terminal', !stage.is_terminal)}
                                className={cn(
                                    "p-1.5 rounded-lg border-none cursor-pointer transition-colors",
                                    stage.is_terminal
                                        ? "bg-red-500/15 text-red-500"
                                        : "bg-transparent text-muted-foreground hover:text-foreground"
                                )}
                                title={stage.is_terminal ? t("terminalYes") : t("terminalNo")}
                            >
                                {stage.is_terminal ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                        </div>
                        <button
                            onClick={() => removeStage(idx)}
                            className="p-1.5 rounded-lg border-none bg-transparent text-muted-foreground hover:text-red-500 hover:bg-red-500/10 cursor-pointer transition-colors"
                        >
                            <Trash2 size={14} />
                        </button>
                    </div>
                ))}

                {/* Add stage button */}
                <button
                    onClick={addStage}
                    className="w-full px-4 py-3 flex items-center justify-center gap-1.5 text-sm text-indigo-500 bg-transparent border-none cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
                >
                    <Plus size={14} /> {t("addStage")}
                </button>
            </div>

            {/* Sticky save bar */}
            {dirty && (
                <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-sm px-6 py-3 flex items-center justify-end gap-3">
                    <span className="text-xs text-muted-foreground mr-auto">{t("unsavedChanges")}</span>
                    <button
                        onClick={() => { setStages(DEFAULT_STAGES); setDirty(false); }}
                        className="px-4 py-2 rounded-lg border border-border bg-transparent text-sm text-muted-foreground cursor-pointer hover:bg-muted transition-colors"
                    >
                        {t("reset")}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-5 py-2 rounded-lg border-none bg-indigo-500 text-white text-sm font-semibold cursor-pointer flex items-center gap-1.5 hover:bg-indigo-600 disabled:opacity-50 transition-colors"
                    >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        {saving ? tc("saving") : tc("saveChanges")}
                    </button>
                </div>
            )}
        </div>
    );
}
