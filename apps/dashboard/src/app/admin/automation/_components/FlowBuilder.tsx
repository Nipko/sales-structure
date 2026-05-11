"use client";

import { useCallback, useMemo, useState, useRef } from "react";
import {
    ReactFlow, Background, Controls, MiniMap, Panel,
    useNodesState, useEdgesState, addEdge,
    Handle, Position, MarkerType,
    type Node, type Edge, type Connection, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTranslations } from "next-intl";
import {
    UserPlus, MessageSquare, UserCheck, Clock, Timer, ArrowRight,
    Send, ListTodo, Tag, Users, Shuffle, Hourglass, GitBranch,
    Plus, Trash2, GripVertical, X, Save, Play,
} from "lucide-react";

const TRIGGER_DEFS = [
    { value: "lead.captured", icon: UserPlus, i18n: "triggerLeadCaptured" },
    { value: "new_message", icon: MessageSquare, i18n: "triggerNewMessage" },
    { value: "conversation_assigned", icon: UserCheck, i18n: "triggerConversationAssigned" },
    { value: "sla_timeout", icon: Clock, i18n: "triggerSlaTimeout" },
    { value: "inactivity", icon: Timer, i18n: "triggerInactivity" },
    { value: "stage_changed", icon: ArrowRight, i18n: "triggerStageChanged" },
];

const ACTION_DEFS = [
    { value: "send_template", icon: Send, i18n: "actionSendTemplate" },
    { value: "create_task", icon: ListTodo, i18n: "actionCreateTask" },
    { value: "change_stage", icon: ArrowRight, i18n: "actionChangeStage" },
    { value: "add_tag", icon: Tag, i18n: "actionAddTag" },
    { value: "assign_agent", icon: Users, i18n: "actionAssignAgent" },
];

const CONDITION_FIELDS = [
    { value: "channel", i18n: "fieldChannel" },
    { value: "stage", i18n: "fieldStage" },
    { value: "score", i18n: "fieldScore" },
    { value: "tag", i18n: "fieldTag" },
    { value: "source", i18n: "fieldSource" },
];

const OPERATORS = [
    { value: "equals", i18n: "opEquals" },
    { value: "not_equals", i18n: "opNotEquals" },
    { value: "greater_than", i18n: "opGreaterThan" },
    { value: "less_than", i18n: "opLessThan" },
    { value: "contains", i18n: "opContains" },
];

// ─── Custom Nodes ────────────────────────────────────────────

function TriggerNode({ data: _data, id }: NodeProps) {
    const data = _data as any;
    const t = useTranslations("automation");
    const def = TRIGGER_DEFS.find(d => d.value === data.triggerType);
    const Icon = def?.icon || Shuffle;
    return (
        <div className="rounded-xl border-2 border-emerald-500/40 bg-emerald-500/[0.06] px-4 py-3 min-w-[220px] shadow-lg backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                    <Play size={16} className="text-emerald-500" />
                </div>
                <span className="text-xs font-bold text-emerald-500 uppercase tracking-wider">{t("flowTrigger")}</span>
            </div>
            <select
                value={data.triggerType || ""}
                onChange={e => data.onChange?.(id, "triggerType", e.target.value)}
                className="w-full rounded-lg border border-border bg-background/80 text-foreground text-sm px-2.5 py-1.5 outline-none"
            >
                <option value="">{t("selectTrigger")}</option>
                {TRIGGER_DEFS.map(tr => (
                    <option key={tr.value} value={tr.value}>{t(tr.i18n)}</option>
                ))}
            </select>
            <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-emerald-300" />
        </div>
    );
}

function ConditionNode({ data: _data, id }: NodeProps) {
    const data = _data as any;
    const t = useTranslations("automation");
    return (
        <div className="rounded-xl border-2 border-amber-500/40 bg-amber-500/[0.06] px-4 py-3 min-w-[260px] shadow-lg backdrop-blur-sm">
            <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-amber-500 !border-2 !border-amber-300" />
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                        <GitBranch size={16} className="text-amber-500" />
                    </div>
                    <span className="text-xs font-bold text-amber-500 uppercase tracking-wider">{t("flowCondition")}</span>
                </div>
                <button onClick={() => data.onDelete?.(id)} className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
                    <X size={14} />
                </button>
            </div>
            <div className="space-y-1.5">
                <select
                    value={data.field || ""}
                    onChange={e => data.onChange?.(id, "field", e.target.value)}
                    className="w-full rounded-lg border border-border bg-background/80 text-foreground text-sm px-2.5 py-1.5 outline-none"
                >
                    <option value="">{t("selectField")}</option>
                    {CONDITION_FIELDS.map(f => (
                        <option key={f.value} value={f.value}>{t(f.i18n)}</option>
                    ))}
                </select>
                <select
                    value={data.operator || "equals"}
                    onChange={e => data.onChange?.(id, "operator", e.target.value)}
                    className="w-full rounded-lg border border-border bg-background/80 text-foreground text-sm px-2.5 py-1.5 outline-none"
                >
                    {OPERATORS.map(op => (
                        <option key={op.value} value={op.value}>{t(op.i18n)}</option>
                    ))}
                </select>
                <input
                    value={data.value || ""}
                    onChange={e => data.onChange?.(id, "value", e.target.value)}
                    placeholder={t("conditionValue")}
                    className="w-full rounded-lg border border-border bg-background/80 text-foreground text-sm px-2.5 py-1.5 outline-none placeholder:text-muted-foreground"
                />
            </div>
            <Handle type="source" position={Position.Bottom} id="yes" className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-emerald-300 !left-[30%]" />
            <Handle type="source" position={Position.Bottom} id="no" className="!w-3 !h-3 !bg-red-500 !border-2 !border-red-300 !left-[70%]" />
            <div className="flex justify-between mt-1 px-2 text-[10px] text-muted-foreground">
                <span className="text-emerald-500 font-semibold">{t("flowYes")}</span>
                <span className="text-red-500 font-semibold">{t("flowNo")}</span>
            </div>
        </div>
    );
}

function ActionNode({ data: _data, id }: NodeProps) {
    const data = _data as any;
    const t = useTranslations("automation");
    const def = ACTION_DEFS.find(d => d.value === data.actionType);
    const Icon = def?.icon || Shuffle;
    return (
        <div className="rounded-xl border-2 border-indigo-500/40 bg-indigo-500/[0.06] px-4 py-3 min-w-[240px] shadow-lg backdrop-blur-sm">
            <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-indigo-300" />
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                        <Icon size={16} className="text-indigo-500" />
                    </div>
                    <span className="text-xs font-bold text-indigo-500 uppercase tracking-wider">{t("flowAction")}</span>
                </div>
                <button onClick={() => data.onDelete?.(id)} className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
                    <X size={14} />
                </button>
            </div>
            <select
                value={data.actionType || ""}
                onChange={e => data.onChange?.(id, "actionType", e.target.value)}
                className="w-full rounded-lg border border-border bg-background/80 text-foreground text-sm px-2.5 py-1.5 outline-none mb-1.5"
            >
                <option value="">{t("selectAction")}</option>
                {ACTION_DEFS.map(a => (
                    <option key={a.value} value={a.value}>{t(a.i18n)}</option>
                ))}
            </select>
            {data.actionType === "send_template" && (
                <input
                    value={data.config?.template_name || ""}
                    onChange={e => data.onChange?.(id, "config", { ...data.config, template_name: e.target.value })}
                    placeholder={t("templateName")}
                    className="w-full rounded-lg border border-border bg-background/80 text-foreground text-sm px-2.5 py-1.5 outline-none placeholder:text-muted-foreground mb-1.5"
                />
            )}
            {data.actionType === "change_stage" && (
                <input
                    value={data.config?.stage || ""}
                    onChange={e => data.onChange?.(id, "config", { ...data.config, stage: e.target.value })}
                    placeholder={t("targetStage")}
                    className="w-full rounded-lg border border-border bg-background/80 text-foreground text-sm px-2.5 py-1.5 outline-none placeholder:text-muted-foreground mb-1.5"
                />
            )}
            {data.actionType === "add_tag" && (
                <input
                    value={data.config?.tag || ""}
                    onChange={e => data.onChange?.(id, "config", { ...data.config, tag: e.target.value })}
                    placeholder={t("tagName")}
                    className="w-full rounded-lg border border-border bg-background/80 text-foreground text-sm px-2.5 py-1.5 outline-none placeholder:text-muted-foreground mb-1.5"
                />
            )}
            {data.actionType === "create_task" && (
                <input
                    value={data.config?.task_description || ""}
                    onChange={e => data.onChange?.(id, "config", { ...data.config, task_description: e.target.value })}
                    placeholder={t("taskDescription")}
                    className="w-full rounded-lg border border-border bg-background/80 text-foreground text-sm px-2.5 py-1.5 outline-none placeholder:text-muted-foreground mb-1.5"
                />
            )}
            <div className="flex items-center gap-2 mt-1">
                <Hourglass size={12} className="text-muted-foreground" />
                <input
                    type="number"
                    min={0}
                    value={data.delay ?? 0}
                    onChange={e => data.onChange?.(id, "delay", parseInt(e.target.value) || 0)}
                    className="w-16 rounded-lg border border-border bg-background/80 text-foreground text-xs px-2 py-1 outline-none"
                />
                <span className="text-[11px] text-muted-foreground">{t("delaySeconds")}</span>
            </div>
            <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-indigo-300" />
        </div>
    );
}

function DelayNode({ data: _data, id }: NodeProps) {
    const data = _data as any;
    const t = useTranslations("automation");
    return (
        <div className="rounded-xl border-2 border-purple-500/40 bg-purple-500/[0.06] px-4 py-3 min-w-[200px] shadow-lg backdrop-blur-sm">
            <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-purple-500 !border-2 !border-purple-300" />
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                        <Hourglass size={16} className="text-purple-500" />
                    </div>
                    <span className="text-xs font-bold text-purple-500 uppercase tracking-wider">{t("flowDelay")}</span>
                </div>
                <button onClick={() => data.onDelete?.(id)} className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
                    <X size={14} />
                </button>
            </div>
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    min={1}
                    value={data.delayMinutes ?? 5}
                    onChange={e => data.onChange?.(id, "delayMinutes", parseInt(e.target.value) || 1)}
                    className="w-20 rounded-lg border border-border bg-background/80 text-foreground text-sm px-2.5 py-1.5 outline-none"
                />
                <select
                    value={data.delayUnit || "minutes"}
                    onChange={e => data.onChange?.(id, "delayUnit", e.target.value)}
                    className="flex-1 rounded-lg border border-border bg-background/80 text-foreground text-sm px-2.5 py-1.5 outline-none"
                >
                    <option value="minutes">{t("minutes")}</option>
                    <option value="hours">{t("hours")}</option>
                    <option value="days">{t("days")}</option>
                </select>
            </div>
            <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-purple-500 !border-2 !border-purple-300" />
        </div>
    );
}

const nodeTypes = {
    trigger: TriggerNode,
    condition: ConditionNode,
    action: ActionNode,
    delay: DelayNode,
};

// ─── Flow Builder ────────────────────────────────────────────

interface FlowBuilderProps {
    rule?: any;
    onSave: (data: { name: string; trigger_type: string; conditions: any[]; actions: any[]; active: boolean }) => void;
    onCancel: () => void;
}

let nodeIdCounter = 0;
function nextId() { return `node_${++nodeIdCounter}_${Date.now()}`; }

function buildInitialNodes(rule?: any): { nodes: Node[]; edges: Edge[] } {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const triggerId = nextId();
    nodes.push({
        id: triggerId,
        type: "trigger",
        position: { x: 250, y: 30 },
        data: { triggerType: rule?.trigger_type || "" },
    });

    let lastId = triggerId;
    let yPos = 170;

    const conditions = rule?.conditions || rule?.conditions_json || [];
    for (const cond of conditions) {
        const condId = nextId();
        nodes.push({
            id: condId,
            type: "condition",
            position: { x: 230, y: yPos },
            data: { field: cond.field || "", operator: cond.operator || "equals", value: cond.value || "" },
        });
        edges.push({
            id: `e-${lastId}-${condId}`,
            source: lastId,
            target: condId,
            sourceHandle: lastId === triggerId ? undefined : "yes",
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: "#6c5ce7", strokeWidth: 2 },
        });
        lastId = condId;
        yPos += 200;
    }

    const actions = rule?.actions || rule?.actions_json || [];
    for (const act of actions) {
        if (act.delay && act.delay > 0) {
            const delayId = nextId();
            const delayMinutes = Math.round(act.delay / 60) || 1;
            nodes.push({
                id: delayId,
                type: "delay",
                position: { x: 260, y: yPos },
                data: { delayMinutes, delayUnit: "minutes" },
            });
            edges.push({
                id: `e-${lastId}-${delayId}`,
                source: lastId,
                target: delayId,
                sourceHandle: nodes.find(n => n.id === lastId)?.type === "condition" ? "yes" : undefined,
                markerEnd: { type: MarkerType.ArrowClosed },
                style: { stroke: "#6c5ce7", strokeWidth: 2 },
            });
            lastId = delayId;
            yPos += 150;
        }
        const actId = nextId();
        nodes.push({
            id: actId,
            type: "action",
            position: { x: 240, y: yPos },
            data: { actionType: act.type || "", config: act.config || {}, delay: 0 },
        });
        edges.push({
            id: `e-${lastId}-${actId}`,
            source: lastId,
            target: actId,
            sourceHandle: nodes.find(n => n.id === lastId)?.type === "condition" ? "yes" : undefined,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: "#6c5ce7", strokeWidth: 2 },
        });
        lastId = actId;
        yPos += 200;
    }

    return { nodes, edges };
}

function serializeFlow(nodes: Node[], edges: Edge[]): {
    trigger_type: string;
    conditions: any[];
    actions: any[];
} {
    const triggerNode = nodes.find(n => n.type === "trigger");
    const trigger_type = (triggerNode?.data as any)?.triggerType || "";

    const conditionNodes = nodes.filter(n => n.type === "condition");
    const conditions = conditionNodes.map(n => ({
        field: (n.data as any).field || "",
        operator: (n.data as any).operator || "equals",
        value: (n.data as any).value || "",
    })).filter(c => c.field);

    const orderedActions: any[] = [];
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
        const list = adjacency.get(e.source) || [];
        list.push(e.target);
        adjacency.set(e.source, list);
    }

    const visited = new Set<string>();
    function walk(nodeId: string) {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);
        const node = nodes.find(n => n.id === nodeId);
        if (!node) return;

        if (node.type === "action") {
            orderedActions.push({
                type: (node.data as any).actionType || "",
                config: (node.data as any).config || {},
                delay: (node.data as any).delay || 0,
            });
        }
        if (node.type === "delay") {
            const mins = (node.data as any).delayMinutes || 1;
            const unit = (node.data as any).delayUnit || "minutes";
            const multiplier = unit === "hours" ? 3600 : unit === "days" ? 86400 : 60;
            const nextTargets = adjacency.get(nodeId) || [];
            for (const t of nextTargets) {
                const nextNode = nodes.find(n => n.id === t);
                if (nextNode?.type === "action") {
                    (nextNode.data as any)._pendingDelay = mins * multiplier;
                }
            }
        }

        const targets = adjacency.get(nodeId) || [];
        for (const t of targets) walk(t);
    }

    if (triggerNode) walk(triggerNode.id);

    for (const act of orderedActions) {
        const node = nodes.find(n => n.type === "action" && (n.data as any).actionType === act.type);
        if (node && (node.data as any)._pendingDelay) {
            act.delay = (node.data as any)._pendingDelay;
        }
    }

    return { trigger_type, conditions, actions: orderedActions.filter(a => a.type) };
}

export default function FlowBuilder({ rule, onSave, onCancel }: FlowBuilderProps) {
    const t = useTranslations("automation");
    const initial = useMemo(() => buildInitialNodes(rule), []);
    const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
    const [ruleName, setRuleName] = useState(rule?.name || "");

    const handleNodeChange = useCallback((nodeId: string, field: string, value: any) => {
        setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, [field]: value } } : n));
    }, [setNodes]);

    const handleNodeDelete = useCallback((nodeId: string) => {
        setNodes(nds => nds.filter(n => n.id !== nodeId));
        setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
    }, [setNodes, setEdges]);

    const enrichedNodes = useMemo(() =>
        nodes.map(n => ({
            ...n,
            data: { ...n.data, onChange: handleNodeChange, onDelete: handleNodeDelete },
        })),
    [nodes, handleNodeChange, handleNodeDelete]);

    const onConnect = useCallback((connection: Connection) => {
        setEdges(eds => addEdge({
            ...connection,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: "#6c5ce7", strokeWidth: 2 },
        }, eds));
    }, [setEdges]);

    const addNode = useCallback((type: "condition" | "action" | "delay") => {
        const lastNode = nodes[nodes.length - 1];
        const y = lastNode ? lastNode.position.y + 200 : 200;
        const id = nextId();
        const newNode: Node = {
            id,
            type,
            position: { x: 250, y },
            data: type === "condition"
                ? { field: "", operator: "equals", value: "" }
                : type === "delay"
                ? { delayMinutes: 5, delayUnit: "minutes" }
                : { actionType: "", config: {}, delay: 0 },
        };
        setNodes(nds => [...nds, newNode]);

        if (lastNode) {
            setEdges(eds => [...eds, {
                id: `e-${lastNode.id}-${id}`,
                source: lastNode.id,
                target: id,
                sourceHandle: lastNode.type === "condition" ? "yes" : undefined,
                markerEnd: { type: MarkerType.ArrowClosed },
                style: { stroke: "#6c5ce7", strokeWidth: 2 },
            }]);
        }
    }, [nodes, setNodes, setEdges]);

    const handleSave = () => {
        const { trigger_type, conditions, actions } = serializeFlow(nodes, edges);
        if (!trigger_type) return;
        onSave({
            name: ruleName || t("untitledRule"),
            trigger_type,
            conditions,
            actions,
            active: rule?.active ?? true,
        });
    };

    return (
        <div className="flex flex-col h-[calc(100vh-160px)] bg-background rounded-xl border border-border overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card">
                <div className="flex items-center gap-3">
                    <input
                        value={ruleName}
                        onChange={e => setRuleName(e.target.value)}
                        placeholder={t("ruleName")}
                        className="rounded-lg border border-border bg-background text-foreground text-sm px-3 py-1.5 outline-none w-64 placeholder:text-muted-foreground"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => addNode("condition")}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-500 text-xs font-medium hover:bg-amber-500/20 transition-colors"
                    >
                        <GitBranch size={14} /> {t("addCondition")}
                    </button>
                    <button
                        onClick={() => addNode("action")}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-500 text-xs font-medium hover:bg-indigo-500/20 transition-colors"
                    >
                        <Plus size={14} /> {t("addAction")}
                    </button>
                    <button
                        onClick={() => addNode("delay")}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 text-purple-500 text-xs font-medium hover:bg-purple-500/20 transition-colors"
                    >
                        <Hourglass size={14} /> {t("flowDelay")}
                    </button>
                    <div className="w-px h-6 bg-border mx-1" />
                    <button
                        onClick={onCancel}
                        className="px-3 py-1.5 rounded-lg border border-border bg-transparent text-muted-foreground text-xs font-medium hover:bg-muted transition-colors"
                    >
                        {t("cancel")}
                    </button>
                    <button
                        onClick={handleSave}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:opacity-90 transition-opacity"
                    >
                        <Save size={14} /> {t("save")}
                    </button>
                </div>
            </div>

            {/* Canvas */}
            <div className="flex-1">
                <ReactFlow
                    nodes={enrichedNodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    nodeTypes={nodeTypes}
                    fitView
                    snapToGrid
                    snapGrid={[20, 20]}
                    defaultEdgeOptions={{
                        markerEnd: { type: MarkerType.ArrowClosed },
                        style: { stroke: "#6c5ce7", strokeWidth: 2 },
                    }}
                    proOptions={{ hideAttribution: true }}
                >
                    <Background gap={20} size={1} color="hsl(var(--border) / 0.3)" />
                    <Controls className="!bg-card !border-border !rounded-lg !shadow-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground" />
                    <MiniMap
                        nodeColor={n => {
                            if (n.type === "trigger") return "#10b981";
                            if (n.type === "condition") return "#f59e0b";
                            if (n.type === "action") return "#6366f1";
                            if (n.type === "delay") return "#a855f7";
                            return "#6b7280";
                        }}
                        maskColor="hsl(var(--background) / 0.8)"
                        className="!bg-card !border-border !rounded-lg"
                    />
                </ReactFlow>
            </div>
        </div>
    );
}
