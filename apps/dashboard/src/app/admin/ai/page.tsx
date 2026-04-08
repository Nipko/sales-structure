"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import { cn } from "@/lib/utils";
import {
    Brain, Cpu, Zap, Settings, ToggleLeft, ToggleRight, Sliders,
    MessageSquare, Clock, DollarSign, BarChart3, ChevronRight,
    AlertTriangle, CheckCircle2, RefreshCw, Globe, Shield,
} from "lucide-react";

const statusColors: Record<string, { label: string; color: string }> = {
    active: { label: "Activo", color: "#2ecc71" },
    standby: { label: "Standby", color: "#f39c12" },
    inactive: { label: "Inactivo", color: "#95a5a6" },
};

export default function AIRouterPage() {
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const [models, setModels] = useState<any[]>([]);
    const [rules, setRules] = useState<any[]>([]);
    const [selectedModel, setSelectedModel] = useState<string | null>(null);
    const [isLive, setIsLive] = useState(false);

    useEffect(() => {
        async function load() {
            if (!activeTenantId) return;
            try {
                const result = await api.fetch(`/ai/config/${activeTenantId}`);
                if (result?.data) {
                    if (Array.isArray(result.data.models)) setModels(result.data.models);
                    if (Array.isArray(result.data.routingRules)) setRules(result.data.routingRules);
                    setIsLive(true);
                }
            } catch (err) {
                console.error('Failed to load AI config:', err);
            }
        }
        load();
    }, [activeTenantId]);

    const activeModels = models.filter(m => m.status === "active").length;
    const avgLatency = Math.round(models.filter(m => m.status === "active").reduce((s, m) => s + m.latencyMs, 0) / (activeModels || 1));

    return (
        <div>
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-[28px] font-bold m-0 flex items-center gap-2.5">
                    <Brain size={28} className="text-primary" /> AI / LLM Router
                    <DataSourceBadge isLive={isLive} />
                </h1>
                <p className="text-muted-foreground mt-1">
                    {activeModels} modelos activos · {avgLatency}ms latencia promedio · {rules.length} reglas de enrutamiento
                </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-4 gap-4 mb-6">
                {[
                    { label: "Modelos", value: models.length, color: "#6c5ce7", icon: Cpu },
                    { label: "Activos", value: activeModels, color: "#2ecc71", icon: CheckCircle2 },
                    { label: "Latencia Avg", value: `${avgLatency}ms`, color: "#3498db", icon: Clock },
                    { label: "Reglas", value: rules.length, color: "#9b59b6", icon: Sliders },
                ].map(stat => (
                    <div key={stat.label} className="p-5 rounded-[14px] bg-card border border-border">
                        <div className="flex justify-between items-center">
                            <div>
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{stat.label}</div>
                                <div className="text-[28px] font-bold mt-1">{stat.value}</div>
                            </div>
                            <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${stat.color}15` }}>
                                <stat.icon size={22} color={stat.color} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Models Section */}
            <h2 className="text-lg font-bold mb-3.5 flex items-center gap-2">
                <Cpu size={20} /> Modelos Configurados
            </h2>
            <div className="grid grid-cols-2 gap-3.5 mb-8">
                {models.map(model => {
                    const sc = statusColors[model.status];
                    return (
                        <div
                            key={model.id}
                            onClick={() => setSelectedModel(selectedModel === model.id ? null : model.id)}
                            className={cn(
                                "p-5 rounded-[14px] bg-card border cursor-pointer transition-colors duration-200",
                                selectedModel === model.id ? "border-primary" : "border-border"
                            )}
                        >
                            <div className="flex justify-between items-start mb-2.5">
                                <div>
                                    <div className="text-base font-bold">{model.name}</div>
                                    <div className="text-xs text-muted-foreground mt-0.5">{model.provider}</div>
                                </div>
                                <span
                                    className="text-[10px] px-2 py-0.5 rounded-md font-semibold"
                                    style={{ background: `${sc.color}15`, color: sc.color }}
                                >
                                    {sc.label}
                                </span>
                            </div>
                            <div className="text-[13px] text-muted-foreground mb-3 leading-snug">
                                {model.description}
                            </div>
                            <div className="flex gap-4 text-xs">
                                <span className="flex items-center gap-1">
                                    <Clock size={12} color="#3498db" /> {model.latencyMs}ms
                                </span>
                                <span className="flex items-center gap-1">
                                    <DollarSign size={12} color="#2ecc71" /> ${model.costPer1k}/1K
                                </span>
                                <span className="flex items-center gap-1">
                                    <BarChart3 size={12} color="#9b59b6" /> {model.accuracy}% accuracy
                                </span>
                            </div>
                            {/* Latency bar */}
                            <div className="mt-2.5">
                                <div className="h-1 rounded-sm bg-muted overflow-hidden">
                                    <div
                                        className="h-full rounded-sm transition-[width] duration-500"
                                        style={{
                                            width: `${Math.min(model.latencyMs / 10, 100)}%`,
                                            background: model.latencyMs < 300 ? "#2ecc71" : model.latencyMs < 700 ? "#f39c12" : "#e74c3c",
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Routing Rules */}
            <h2 className="text-lg font-bold mb-3.5 flex items-center gap-2">
                <Sliders size={20} /> Reglas de Enrutamiento
            </h2>
            <div className="rounded-[14px] border border-border overflow-hidden">
                <table className="w-full border-collapse">
                    <thead>
                        <tr className="bg-card">
                            {["Prioridad", "Nombre", "Condición", "Modelo Asignado"].map(h => (
                                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rules.map(rule => (
                            <tr key={rule.id} className="border-b border-border">
                                <td className="px-4 py-3">
                                    <span className="w-7 h-7 rounded-lg bg-[var(--accent-glow)] text-primary font-bold text-[13px] inline-flex items-center justify-center">
                                        {rule.priority}
                                    </span>
                                </td>
                                <td className="px-4 py-3 font-semibold text-sm">{rule.name}</td>
                                <td className="px-4 py-3">
                                    <code className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                                        {rule.condition}
                                    </code>
                                </td>
                                <td className="px-4 py-3">
                                    <span className="text-[13px] font-semibold flex items-center gap-1.5">
                                        <Brain size={14} className="text-primary" /> {rule.model}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Architecture Diagram */}
            <div className="mt-6 p-5 rounded-[14px] bg-card border border-border">
                <div className="text-sm font-bold mb-3">🏗️ Flujo de Enrutamiento</div>
                <div className="flex items-center gap-3 flex-wrap font-mono text-[13px]">
                    <span className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 font-semibold">📱 WhatsApp</span>
                    <ChevronRight size={16} className="text-muted-foreground" />
                    <span className="px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-semibold">🧠 Intent Classifier</span>
                    <ChevronRight size={16} className="text-muted-foreground" />
                    <span className="px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-500 font-semibold">🔀 LLM Router</span>
                    <ChevronRight size={16} className="text-muted-foreground" />
                    <span className="px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-500 font-semibold">🤖 GPT-4o / GPT-3.5</span>
                    <ChevronRight size={16} className="text-muted-foreground" />
                    <span className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 font-semibold">📤 Respuesta</span>
                </div>
            </div>
        </div>
    );
}
