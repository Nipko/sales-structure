"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import {
    Brain, Cpu, Zap, Settings, ToggleLeft, ToggleRight, Sliders,
    MessageSquare, Clock, DollarSign, BarChart3, ChevronRight,
    AlertTriangle, CheckCircle2, RefreshCw, Globe, Shield,
} from "lucide-react";

// No mock data — loaded from API

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

    // Load AI config from API
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
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                    <Brain size={28} color="var(--accent)" /> AI / LLM Router
                    <DataSourceBadge isLive={isLive} />
                </h1>
                <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                    {activeModels} modelos activos · {avgLatency}ms latencia promedio · {rules.length} reglas de enrutamiento
                </p>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
                {[
                    { label: "Modelos", value: models.length, color: "var(--accent)", icon: Cpu },
                    { label: "Activos", value: activeModels, color: "#2ecc71", icon: CheckCircle2 },
                    { label: "Latencia Avg", value: `${avgLatency}ms`, color: "#3498db", icon: Clock },
                    { label: "Reglas", value: rules.length, color: "#9b59b6", icon: Sliders },
                ].map(stat => (
                    <div key={stat.label} style={{ padding: 20, borderRadius: 14, background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>{stat.label}</div>
                                <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{stat.value}</div>
                            </div>
                            <div style={{ width: 44, height: 44, borderRadius: 12, background: `${stat.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <stat.icon size={22} color={stat.color} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Models Section */}
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                <Cpu size={20} /> Modelos Configurados
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginBottom: 32 }}>
                {models.map(model => {
                    const sc = statusColors[model.status];
                    return (
                        <div key={model.id} onClick={() => setSelectedModel(selectedModel === model.id ? null : model.id)} style={{
                            padding: 20, borderRadius: 14, background: "var(--bg-secondary)",
                            border: `1px solid ${selectedModel === model.id ? "var(--accent)" : "var(--border)"}`,
                            cursor: "pointer", transition: "border-color 0.2s ease",
                        }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                                <div>
                                    <div style={{ fontSize: 16, fontWeight: 700 }}>{model.name}</div>
                                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{model.provider}</div>
                                </div>
                                <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: `${sc.color}15`, color: sc.color, fontWeight: 600 }}>
                                    {sc.label}
                                </span>
                            </div>
                            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.4 }}>
                                {model.description}
                            </div>
                            <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
                                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <Clock size={12} color="#3498db" /> {model.latencyMs}ms
                                </span>
                                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <DollarSign size={12} color="#2ecc71" /> ${model.costPer1k}/1K
                                </span>
                                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                    <BarChart3 size={12} color="#9b59b6" /> {model.accuracy}% accuracy
                                </span>
                            </div>
                            {/* Latency bar */}
                            <div style={{ marginTop: 10 }}>
                                <div style={{ height: 4, borderRadius: 2, background: "var(--bg-tertiary)", overflow: "hidden" }}>
                                    <div style={{
                                        width: `${Math.min(model.latencyMs / 10, 100)}%`, height: "100%", borderRadius: 2,
                                        background: model.latencyMs < 300 ? "#2ecc71" : model.latencyMs < 700 ? "#f39c12" : "#e74c3c",
                                        transition: "width 0.5s ease",
                                    }} />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Routing Rules */}
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                <Sliders size={20} /> Reglas de Enrutamiento
            </h2>
            <div style={{ borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ background: "var(--bg-secondary)" }}>
                            {["Prioridad", "Nombre", "Condición", "Modelo Asignado"].map(h => (
                                <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid var(--border)" }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rules.map(rule => (
                            <tr key={rule.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                <td style={{ padding: "12px 16px" }}>
                                    <span style={{ width: 28, height: 28, borderRadius: 8, background: "var(--accent-glow)", color: "var(--accent)", fontWeight: 700, fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                                        {rule.priority}
                                    </span>
                                </td>
                                <td style={{ padding: "12px 16px", fontWeight: 600, fontSize: 14 }}>{rule.name}</td>
                                <td style={{ padding: "12px 16px" }}>
                                    <code style={{ fontSize: 12, padding: "3px 8px", borderRadius: 4, background: "var(--bg-tertiary)", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                                        {rule.condition}
                                    </code>
                                </td>
                                <td style={{ padding: "12px 16px" }}>
                                    <span style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                                        <Brain size={14} color="var(--accent)" /> {rule.model}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Architecture Diagram */}
            <div style={{ marginTop: 24, padding: 20, borderRadius: 14, background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>🏗️ Flujo de Enrutamiento</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontFamily: "monospace", fontSize: 13 }}>
                    <span style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(46,204,113,0.1)", color: "#2ecc71", fontWeight: 600 }}>📱 WhatsApp</span>
                    <ChevronRight size={16} color="var(--text-secondary)" />
                    <span style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(108,92,231,0.1)", color: "var(--accent)", fontWeight: 600 }}>🧠 Intent Classifier</span>
                    <ChevronRight size={16} color="var(--text-secondary)" />
                    <span style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(155,89,182,0.1)", color: "#9b59b6", fontWeight: 600 }}>🔀 LLM Router</span>
                    <ChevronRight size={16} color="var(--text-secondary)" />
                    <span style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(52,152,219,0.1)", color: "#3498db", fontWeight: 600 }}>🤖 GPT-4o / GPT-3.5</span>
                    <ChevronRight size={16} color="var(--text-secondary)" />
                    <span style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(46,204,113,0.1)", color: "#2ecc71", fontWeight: 600 }}>📤 Respuesta</span>
                </div>
            </div>
        </div>
    );
}
