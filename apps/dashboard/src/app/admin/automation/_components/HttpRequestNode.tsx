"use client";

import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useTranslations } from "next-intl";
import { Globe, X, Plus, Trash2 } from "lucide-react";
import VariableSelector from "./VariableSelector";

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;

const METHOD_COLORS: Record<string, string> = {
    GET: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    POST: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    PUT: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    DELETE: "bg-red-500/20 text-red-400 border-red-500/30",
    PATCH: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

interface HeaderEntry { key: string; value: string }
interface MappingEntry { variable: string; jsonPath: string }

function HttpRequestNode({ data: _data, id }: NodeProps) {
    const data = _data as any;
    const t = useTranslations("automation");
    const [expanded, setExpanded] = useState(false);
    const [activeField, setActiveField] = useState<string | null>(null);

    const method: string = data.method || "GET";
    const url: string = data.url || "";
    const headers: HeaderEntry[] = data.headers || [];
    const body: string = data.body || "";
    const responseMapping: MappingEntry[] = data.responseMapping || [];
    const retryCount: number = data.retryCount ?? 0;
    const timeout: number = data.timeout ?? 5000;
    const onFailure: string = data.onFailure || "continue";

    const showBody = ["POST", "PUT", "PATCH"].includes(method);

    const truncatedUrl = url.length > 35 ? url.slice(0, 35) + "..." : url;

    const handleChange = (field: string, value: any) => {
        data.onChange?.(id, field, value);
    };

    const handleHeaderChange = (index: number, field: "key" | "value", val: string) => {
        const updated = [...headers];
        updated[index] = { ...updated[index], [field]: val };
        handleChange("headers", updated);
    };

    const addHeader = () => {
        handleChange("headers", [...headers, { key: "", value: "" }]);
    };

    const removeHeader = (index: number) => {
        handleChange("headers", headers.filter((_, i) => i !== index));
    };

    const handleMappingChange = (index: number, field: "variable" | "jsonPath", val: string) => {
        const updated = [...responseMapping];
        updated[index] = { ...updated[index], [field]: val };
        handleChange("responseMapping", updated);
    };

    const addMapping = () => {
        handleChange("responseMapping", [...responseMapping, { variable: "", jsonPath: "" }]);
    };

    const removeMapping = (index: number) => {
        handleChange("responseMapping", responseMapping.filter((_, i) => i !== index));
    };

    const handleVariableInsert = (variable: string) => {
        if (activeField === "url") {
            handleChange("url", url + variable);
        } else if (activeField === "body") {
            handleChange("body", body + variable);
        }
    };

    // ─── Collapsed view (node summary) ──────────────────────────
    if (!expanded) {
        return (
            <div
                className="rounded-xl border-2 border-teal-500/40 bg-teal-500/[0.06] px-4 py-3 min-w-[240px] max-w-[280px] shadow-lg backdrop-blur-sm cursor-pointer"
                onDoubleClick={() => setExpanded(true)}
            >
                <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-teal-500 !border-2 !border-teal-300" />
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-teal-500/20 flex items-center justify-center">
                            <Globe size={16} className="text-teal-500" />
                        </div>
                        <span className="text-xs font-bold text-teal-500 uppercase tracking-wider">{t("httpRequest")}</span>
                    </div>
                    <button onClick={() => data.onDelete?.(id)} className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
                        <X size={14} />
                    </button>
                </div>
                <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${METHOD_COLORS[method] || METHOD_COLORS.GET}`}>
                        {method}
                    </span>
                    {url && (
                        <span className="text-xs text-muted-foreground truncate flex-1" title={url}>
                            {truncatedUrl}
                        </span>
                    )}
                </div>
                {!url && (
                    <span className="text-[11px] text-muted-foreground/60 italic">{t("httpUrl")}...</span>
                )}
                <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-teal-500 !border-2 !border-teal-300" />
            </div>
        );
    }

    // ─── Expanded view (inline editor) ──────────────────────────
    return (
        <div className="rounded-xl border-2 border-teal-500/40 bg-teal-500/[0.06] px-4 py-3 min-w-[380px] max-w-[420px] shadow-lg backdrop-blur-sm">
            <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-teal-500 !border-2 !border-teal-300" />

            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-teal-500/20 flex items-center justify-center">
                        <Globe size={16} className="text-teal-500" />
                    </div>
                    <span className="text-xs font-bold text-teal-500 uppercase tracking-wider">{t("httpRequest")}</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setExpanded(false)}
                        className="p-1 rounded hover:bg-teal-500/20 text-muted-foreground hover:text-teal-400 transition-colors text-[10px] font-medium px-2"
                    >
                        {t("save")}
                    </button>
                    <button onClick={() => data.onDelete?.(id)} className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
                        <X size={14} />
                    </button>
                </div>
            </div>

            {/* Method + URL */}
            <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">{t("httpMethod")}</label>
                <div className="flex items-center gap-2">
                    <select
                        value={method}
                        onChange={e => handleChange("method", e.target.value)}
                        className="rounded-lg border border-border bg-background/80 text-foreground text-sm px-2.5 py-1.5 outline-none w-28"
                    >
                        {HTTP_METHODS.map(m => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>
                    <div className="flex-1 relative">
                        <input
                            value={url}
                            onChange={e => handleChange("url", e.target.value)}
                            onFocus={() => setActiveField("url")}
                            placeholder="https://api.example.com/endpoint"
                            className="w-full rounded-lg border border-border bg-background/80 text-foreground text-sm px-2.5 py-1.5 outline-none placeholder:text-muted-foreground"
                        />
                    </div>
                </div>

                {/* Variable selector */}
                <div className="flex justify-end">
                    <VariableSelector onInsert={handleVariableInsert} />
                </div>

                {/* Headers */}
                <div>
                    <label className="text-[11px] font-medium text-muted-foreground">{t("httpHeaders")}</label>
                    <div className="space-y-1 mt-1">
                        {headers.map((h, i) => (
                            <div key={i} className="flex items-center gap-1">
                                <input
                                    value={h.key}
                                    onChange={e => handleHeaderChange(i, "key", e.target.value)}
                                    placeholder={t("httpHeaderKey")}
                                    className="flex-1 rounded-lg border border-border bg-background/80 text-foreground text-xs px-2 py-1 outline-none placeholder:text-muted-foreground"
                                />
                                <input
                                    value={h.value}
                                    onChange={e => handleHeaderChange(i, "value", e.target.value)}
                                    placeholder={t("httpHeaderValue")}
                                    className="flex-1 rounded-lg border border-border bg-background/80 text-foreground text-xs px-2 py-1 outline-none placeholder:text-muted-foreground"
                                />
                                <button onClick={() => removeHeader(i)} className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={addHeader}
                        className="flex items-center gap-1 mt-1 text-[11px] text-teal-400 hover:text-teal-300 transition-colors"
                    >
                        <Plus size={12} /> {t("httpAddHeader")}
                    </button>
                </div>

                {/* Body (only for POST/PUT/PATCH) */}
                {showBody && (
                    <div>
                        <label className="text-[11px] font-medium text-muted-foreground">{t("httpBody")}</label>
                        <textarea
                            value={body}
                            onChange={e => handleChange("body", e.target.value)}
                            onFocus={() => setActiveField("body")}
                            placeholder='{"key": "value"}'
                            rows={4}
                            className="w-full mt-1 rounded-lg border border-border bg-background/80 text-foreground text-xs px-2.5 py-1.5 outline-none placeholder:text-muted-foreground font-mono resize-y"
                        />
                    </div>
                )}

                {/* Response Mapping */}
                <div>
                    <label className="text-[11px] font-medium text-muted-foreground">{t("httpResponseMapping")}</label>
                    <div className="space-y-1 mt-1">
                        {responseMapping.map((m, i) => (
                            <div key={i} className="flex items-center gap-1">
                                <input
                                    value={m.variable}
                                    onChange={e => handleMappingChange(i, "variable", e.target.value)}
                                    placeholder={t("httpVariableName")}
                                    className="flex-1 rounded-lg border border-border bg-background/80 text-foreground text-xs px-2 py-1 outline-none placeholder:text-muted-foreground"
                                />
                                <input
                                    value={m.jsonPath}
                                    onChange={e => handleMappingChange(i, "jsonPath", e.target.value)}
                                    placeholder={t("httpJsonPath")}
                                    className="flex-1 rounded-lg border border-border bg-background/80 text-foreground text-xs px-2 py-1 outline-none placeholder:text-muted-foreground font-mono"
                                />
                                <button onClick={() => removeMapping(i)} className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                    <button
                        onClick={addMapping}
                        className="flex items-center gap-1 mt-1 text-[11px] text-teal-400 hover:text-teal-300 transition-colors"
                    >
                        <Plus size={12} /> {t("httpAddMapping")}
                    </button>
                </div>

                {/* Retry, Timeout, On Failure */}
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <label className="text-[11px] font-medium text-muted-foreground">{t("httpRetryCount")}</label>
                        <input
                            type="number"
                            min={0}
                            max={3}
                            value={retryCount}
                            onChange={e => handleChange("retryCount", Math.min(3, Math.max(0, parseInt(e.target.value) || 0)))}
                            className="w-full mt-1 rounded-lg border border-border bg-background/80 text-foreground text-xs px-2 py-1 outline-none"
                        />
                    </div>
                    <div>
                        <label className="text-[11px] font-medium text-muted-foreground">{t("httpTimeout")}</label>
                        <input
                            type="number"
                            min={1000}
                            max={10000}
                            step={500}
                            value={timeout}
                            onChange={e => handleChange("timeout", Math.min(10000, Math.max(1000, parseInt(e.target.value) || 5000)))}
                            className="w-full mt-1 rounded-lg border border-border bg-background/80 text-foreground text-xs px-2 py-1 outline-none"
                        />
                    </div>
                    <div>
                        <label className="text-[11px] font-medium text-muted-foreground">{t("httpOnFailure")}</label>
                        <select
                            value={onFailure}
                            onChange={e => handleChange("onFailure", e.target.value)}
                            className="w-full mt-1 rounded-lg border border-border bg-background/80 text-foreground text-xs px-2 py-1 outline-none"
                        >
                            <option value="continue">{t("httpOnFailureContinue")}</option>
                            <option value="stop">{t("httpOnFailureStop")}</option>
                        </select>
                    </div>
                </div>
            </div>

            <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-teal-500 !border-2 !border-teal-300" />
        </div>
    );
}

export default HttpRequestNode;
