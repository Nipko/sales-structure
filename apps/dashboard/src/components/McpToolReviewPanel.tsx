"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";

interface RemoteTool {
    name: string; description: string; serverId: string; toolName: string;
    authorizedForAgent: boolean;
    parameters?: { properties?: Record<string, unknown> };
    review?: { effect?: string; dataClassification?: string; contactIdArgument?: string; tenantIdArgument?: string; requiresConfirmation?: boolean; requiresHumanApproval?: boolean };
}

/** Advanced connection owners review capabilities; ordinary agent setup uses the resulting status. */
export function McpToolReviewPanel({ tenantId }: { tenantId: string }) {
    const t = useTranslations("mcp.review");
    const [tools, setTools] = useState<RemoteTool[]>([]);
    const [selected, setSelected] = useState<RemoteTool | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const empty = { effect: "read", dataClassification: "public", contactIdArgument: "", tenantIdArgument: "", requiresConfirmation: false, requiresHumanApproval: false };
    const [form, setForm] = useState(empty);
    const load = useCallback(async () => {
        setError(""); setBusy(true);
        try {
            const result: any = await api.getMcpServerTools(tenantId);
            if (!result?.success) throw new Error();
            setTools(result.data || []);
        } catch { setError(t("loadError")); }
        finally { setBusy(false); }
    }, [tenantId, t]);
    useEffect(() => { setSelected(null); setTools([]); void load(); }, [load]);

    const review = (tool: RemoteTool) => { setSelected(tool); setForm({ ...empty, ...tool.review,
        contactIdArgument: tool.review?.contactIdArgument || "", tenantIdArgument: tool.review?.tenantIdArgument || "",
    }); };
    const save = async (revoke = false) => {
        if (!selected) return;
        setError(""); setBusy(true);
        try {
            const result = await api.setMcpToolApproval(tenantId, { serverId: selected.serverId, toolName: selected.toolName, ...form, revoke });
            if (!result?.success) throw new Error();
            setSelected(null); await load();
        } catch { setError(t("saveError")); }
        finally { setBusy(false); }
    };
    const properties = Object.keys(selected?.parameters?.properties || {});
    const needsContact = form.effect !== "read" || form.dataClassification !== "public";
    return <section className="mt-5 rounded-xl border border-border bg-card p-5 space-y-4" aria-busy={busy}>
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button type="button" disabled={busy} onClick={() => void load()} className="text-sm underline disabled:opacity-50">{t("refresh")}</button>
        {!busy && !tools.length && !error && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
        <ul className="space-y-2">{tools.map(tool => <li key={tool.name} className="rounded-lg border border-border p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0"><p className="text-sm font-medium break-all">{tool.toolName}</p>
                <p className="text-xs text-muted-foreground">{tool.description}</p>
                <p className="text-xs mt-1">{t(tool.authorizedForAgent ? "authorized" : "reviewRequired")}</p></div>
            <button type="button" disabled={busy} onClick={() => review(tool)} className="text-sm underline">{t("inspect")}</button>
        </li>)}</ul>
        {selected && <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-3 rounded-lg bg-muted/40 p-4">
            <h3 className="font-medium text-sm break-all">{selected.toolName}</h3>
            <details><summary className="cursor-pointer text-sm">{t("contract")}</summary>
                <pre className="overflow-auto text-xs max-h-48">{JSON.stringify(selected.parameters, null, 2)}</pre></details>
            <label className="block text-sm">{t("effect")}<select className="block w-full border rounded p-2 bg-background" value={form.effect}
                onChange={event => setForm({ ...form, effect: event.target.value, requiresConfirmation: event.target.value !== "read", requiresHumanApproval: event.target.value === "irreversible" || form.requiresHumanApproval })}>
                {["read", "write", "payment", "notification", "irreversible"].map(effect => <option key={effect} value={effect}>{t(`effects.${effect}`)}</option>)}
            </select></label>
            <label className="block text-sm">{t("data")}<select className="block w-full border rounded p-2 bg-background" value={form.dataClassification} onChange={event => setForm({ ...form, dataClassification: event.target.value })}>
                {["public", "contact", "sensitive"].map(scope => <option key={scope} value={scope}>{t(`scopes.${scope}`)}</option>)}
            </select></label>
            <p className="text-xs text-muted-foreground">{t("scopeHelp")}</p>
            {(["contactIdArgument", "tenantIdArgument"] as const).map(field => <label key={field} className="block text-sm">{t(field)}
                <select className="block w-full border rounded p-2 bg-background" value={form[field]} required={field === "contactIdArgument" && needsContact}
                    onChange={event => setForm({ ...form, [field]: event.target.value })}>
                    <option value="">{t(field === "tenantIdArgument" ? "dedicated" : "none")}</option>
                    {properties.map(property => <option key={property} value={property}>{property}</option>)}
                </select></label>)}
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.requiresConfirmation} disabled={form.effect !== "read"} onChange={event => setForm({ ...form, requiresConfirmation: event.target.checked })} />{t("confirmation")}</label>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.requiresHumanApproval} disabled={form.effect === "irreversible"} onChange={event => setForm({ ...form, requiresHumanApproval: event.target.checked })} />{t("human")}</label>
            <p className="text-xs text-muted-foreground">{t("changes")}</p>
            <div className="flex flex-wrap gap-3 text-sm">
                <button type="submit" disabled={busy || (needsContact && !form.contactIdArgument)} className="rounded bg-primary text-primary-foreground px-3 py-2 disabled:opacity-50">{t("approve")}</button>
                {selected.review && <button type="button" disabled={busy} onClick={() => void save(true)} className="underline">{t("revoke")}</button>}
                <button type="button" disabled={busy} onClick={() => setSelected(null)} className="underline">{t("close")}</button>
            </div>
        </form>}
    </section>;
}
