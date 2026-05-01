"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import { cn } from "@/lib/utils";
import {
    Users, UserPlus, Shield, Mail, Phone, Building2, Search, MoreVertical, ChevronDown, Eye, EyeOff, Plus, X, Tag,
} from "lucide-react";

const roleStyle: Record<string, { color: string; icon: string }> = {
    super_admin: { color: "#e74c3c", icon: "🛡️" },
    tenant_admin: { color: "#9b59b6", icon: "👑" },
    tenant_agent: { color: "#3498db", icon: "🎧" },
};

const SUGGESTED_SKILLS = ['ventas', 'soporte', 'técnico', 'facturación', 'quejas', 'general', 'vip', 'idiomas'];

function SkillTagsEditor({ userId, skills, onSave, t }: { userId: string; skills: string[]; onSave: (userId: string, tags: string[]) => void; t: any }) {
    const [editing, setEditing] = useState(false);
    const [tags, setTags] = useState<string[]>(skills);
    const [input, setInput] = useState("");
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (editing && inputRef.current) inputRef.current.focus();
    }, [editing]);

    useEffect(() => {
        if (!editing) return;
        function handleClickOutside(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                handleSave();
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [editing, tags]);

    function addTag(tag: string) {
        const trimmed = tag.trim().toLowerCase();
        if (trimmed && !tags.includes(trimmed)) {
            setTags(prev => [...prev, trimmed]);
        }
        setInput("");
    }

    function removeTag(tag: string) {
        setTags(prev => prev.filter(t => t !== tag));
    }

    async function handleSave() {
        setEditing(false);
        // Only save if tags actually changed
        const changed = tags.length !== skills.length || tags.some((t, i) => t !== skills[i]);
        if (changed) {
            setSaving(true);
            await onSave(userId, tags);
            setSaving(false);
        }
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter") {
            e.preventDefault();
            if (input.trim()) addTag(input);
        } else if (e.key === "Backspace" && !input && tags.length > 0) {
            setTags(prev => prev.slice(0, -1));
        } else if (e.key === "Escape") {
            setTags(skills);
            setEditing(false);
        }
    }

    if (!editing) {
        return (
            <div
                className="flex flex-wrap gap-1 cursor-pointer min-h-[28px] items-center group"
                onClick={(e) => { e.stopPropagation(); setEditing(true); setTags(skills); }}
            >
                {skills.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground italic opacity-60 group-hover:opacity-100 transition-opacity">
                        {t("noSkills")}
                    </span>
                ) : (
                    skills.map(tag => (
                        <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--bg-tertiary,hsl(var(--muted)))] border border-border text-xs text-foreground">
                            {tag}
                        </span>
                    ))
                )}
            </div>
        );
    }

    const unusedSuggestions = SUGGESTED_SKILLS.filter(s => !tags.includes(s));

    return (
        <div ref={containerRef} className="min-w-[220px]" onClick={e => e.stopPropagation()}>
            <div className="flex flex-wrap gap-1 p-1.5 rounded-lg border border-primary/50 bg-background min-h-[32px] items-center">
                {tags.map(tag => (
                    <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg-tertiary,hsl(var(--muted)))] border border-border text-xs">
                        {tag}
                        <button onClick={() => removeTag(tag)} className="bg-transparent border-none p-0 cursor-pointer text-muted-foreground hover:text-foreground leading-none">
                            <X size={10} />
                        </button>
                    </span>
                ))}
                <input
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={tags.length === 0 ? t("skillPlaceholder") : ""}
                    className="flex-1 min-w-[80px] border-none outline-none bg-transparent text-xs text-foreground placeholder:text-muted-foreground"
                />
            </div>
            {unusedSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                    <span className="text-[10px] text-muted-foreground mr-1 self-center">{t("suggestedSkills")}:</span>
                    {unusedSuggestions.map(s => (
                        <button
                            key={s}
                            onClick={() => addTag(s)}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border border-dashed border-border text-[10px] text-muted-foreground bg-transparent cursor-pointer hover:border-primary hover:text-foreground transition-colors"
                        >
                            <Plus size={8} /> {s}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function UsersPage() {
    const t = useTranslations('users');
    const tc = useTranslations("common");
    const tRoles = useTranslations("roles");
    const { user } = useAuth();

    const roleLabel = (role: string): string => {
        switch (role) {
            case "super_admin": return tRoles("superAdmin");
            case "tenant_admin": return tRoles("admin");
            case "tenant_agent": return tRoles("agent");
            case "tenant_viewer": return tRoles("viewer");
            default: return role;
        }
    };
    const { activeTenantId } = useTenant();
    const [users, setUsers] = useState<any[]>([]);
    const [isLive, setIsLive] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [roleFilter, setRoleFilter] = useState<string>("all");
    const [showNewUser, setShowNewUser] = useState(false);
    const [newUser, setNewUser] = useState({ email: "", password: "", firstName: "", lastName: "", role: "tenant_agent", tenantId: "" });
    const [showPassword, setShowPassword] = useState(false);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    useEffect(() => {
        async function load() {
            try {
                const result = await api.getUsers();
                if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                    setUsers(result.data.map((u: any) => ({ id: u.id, email: u.email || '', firstName: u.firstName || u.first_name || '', lastName: u.lastName || u.last_name || '', role: u.role || 'tenant_agent', tenantName: u.tenantName || u.tenant_name || '—', isActive: u.isActive ?? u.is_active ?? true, createdAt: u.createdAt?.split('T')[0] || u.created_at?.split('T')[0] || '—', skillTags: u.skillTags || u.skill_tags || [] })));
                    setIsLive(true);
                }
            } catch (err) { console.error('Failed to load users:', err); }
        }
        load();
    }, []);

    const filtered = users.filter(u => {
        const matchSearch = searchQuery ? `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(searchQuery.toLowerCase()) : true;
        const matchRole = roleFilter === "all" || u.role === roleFilter;
        return matchSearch && matchRole;
    });

    const stats = { total: users.length, admins: users.filter(u => u.role === "super_admin" || u.role === "tenant_admin").length, agents: users.filter(u => u.role === "tenant_agent").length, active: users.filter(u => u.isActive).length };

    async function handleCreateUser() {
        if (!newUser.email || !newUser.password || !newUser.firstName) return;
        setSaving(true);
        try {
            await api.registerUser({ email: newUser.email, password: newUser.password, firstName: newUser.firstName, lastName: newUser.lastName, role: newUser.role, tenantId: newUser.tenantId || undefined });
            setUsers(prev => [...prev, { id: `u${Date.now()}`, email: newUser.email, firstName: newUser.firstName, lastName: newUser.lastName, role: newUser.role as any, tenantName: "—", isActive: true, createdAt: new Date().toISOString().split("T")[0], skillTags: [] }]);
            setShowNewUser(false);
            setNewUser({ email: "", password: "", firstName: "", lastName: "", role: "tenant_agent", tenantId: "" });
            setToast(t("toast.created")); setTimeout(() => setToast(null), 2000);
        } catch { setToast(tc("errorSaving")); setTimeout(() => setToast(null), 2000); }
        finally { setSaving(false); }
    }

    async function handleSaveSkills(userId: string, skillTags: string[]) {
        try {
            const result = await api.updateUserSkills(userId, skillTags);
            if (result.success) {
                setUsers(prev => prev.map(u => u.id === userId ? { ...u, skillTags } : u));
                setToast(t("toast.skillsSaved")); setTimeout(() => setToast(null), 2000);
            } else {
                setToast(tc("errorSaving")); setTimeout(() => setToast(null), 2000);
            }
        } catch {
            setToast(tc("errorSaving")); setTimeout(() => setToast(null), 2000);
        }
    }

    const isAdmin = user?.role === 'super_admin' || user?.role === 'tenant_admin';

    return (
        <>
            <div>
                <PageHeader
                    title={t('title')}
                    subtitle={t('subtitleStats', { total: stats.total, active: stats.active, agents: stats.agents })}
                    icon={Users}
                    badge={<DataSourceBadge isLive={isLive} />}
                    action={
                        <button onClick={() => setShowNewUser(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-sm cursor-pointer hover:opacity-90 press-effect">
                            <UserPlus size={16} /> {tc("create")}
                        </button>
                    }
                />

                <div className="grid grid-cols-4 gap-4 mb-6">
                    {([
                        { key: "total", value: stats.total, color: "#6c5ce7", icon: Users },
                        { key: "admins", value: stats.admins, color: "#9b59b6", icon: Shield },
                        { key: "agents", value: stats.agents, color: "#3498db", icon: Users },
                        { key: "active", value: stats.active, color: "#2ecc71", icon: Users },
                    ] as const).map(stat => (
                        <div key={stat.key} className="p-5 rounded-[14px] bg-card border border-border">
                            <div className="flex justify-between items-center">
                                <div>
                                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t(`stats.${stat.key}`)}</div>
                                    <div className="text-[28px] font-semibold mt-1">{stat.value}</div>
                                </div>
                                <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `${stat.color}15` }}>
                                    <stat.icon size={22} color={stat.color} />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex gap-3 mb-5">
                    <div className="relative flex-1 max-w-[340px]">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={tc("search") + "..."} className="w-full py-2.5 pl-9 pr-2.5 rounded-[10px] border border-border bg-card text-foreground text-sm outline-none box-border" />
                    </div>
                    <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="px-3.5 py-2.5 rounded-[10px] border border-border bg-card text-foreground text-sm outline-none">
                        <option value="all">{t("filter.allRoles")}</option>
                        <option value="super_admin">{tRoles("superAdmin")}</option>
                        <option value="tenant_admin">{tRoles("admin")}</option>
                        <option value="tenant_agent">{tRoles("agent")}</option>
                    </select>
                </div>

                <div className="rounded-[14px] border border-border overflow-hidden">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="bg-card">
                                {(["user", "email", "role", "skills", "tenant", "status", "registered"] as const).map(k => (
                                    <th key={k} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">
                                        {k === "skills" ? t("skills") : t(`headers.${k}`)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(u => {
                                const rc = roleStyle[u.role] || roleStyle.tenant_agent;
                                return (
                                    <tr key={u.id} className="border-b border-border">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm" style={{ background: `linear-gradient(135deg, ${rc.color}, ${rc.color}88)` }}>
                                                    {u.firstName.charAt(0)}{u.lastName.charAt(0)}
                                                </div>
                                                <span className="font-semibold">{u.firstName} {u.lastName}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-[13px] text-muted-foreground">{u.email}</td>
                                        <td className="px-4 py-3">
                                            <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold" style={{ background: `${rc.color}15`, color: rc.color }}>{rc.icon} {roleLabel(u.role)}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            {isAdmin ? (
                                                <SkillTagsEditor userId={u.id} skills={u.skillTags || []} onSave={handleSaveSkills} t={t} />
                                            ) : (
                                                <div className="flex flex-wrap gap-1">
                                                    {(u.skillTags || []).length === 0 ? (
                                                        <span className="text-[11px] text-muted-foreground italic">{t("noSkills")}</span>
                                                    ) : (
                                                        (u.skillTags || []).map((tag: string) => (
                                                            <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded-full bg-[var(--bg-tertiary,hsl(var(--muted)))] border border-border text-xs text-foreground">
                                                                {tag}
                                                            </span>
                                                        ))
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-[13px] text-muted-foreground">{u.tenantName}</td>
                                        <td className="px-4 py-3">
                                            <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold" style={{ background: u.isActive ? "rgba(46,204,113,0.15)" : "rgba(231,76,60,0.15)", color: u.isActive ? "#2ecc71" : "#e74c3c" }}>
                                                {u.isActive ?  tc("active") : tc("inactive")}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-[13px] text-muted-foreground">{u.createdAt}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {showNewUser && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowNewUser(false)}>
                    <div onClick={e => e.stopPropagation()} className="w-[460px] p-7 rounded-[18px] bg-card border border-border shadow-2xl">
                        <div className="flex justify-between items-center mb-5">
                            <h2 className="text-xl font-semibold m-0">{t("modal.title")}</h2>
                            <button onClick={() => setShowNewUser(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="grid grid-cols-2 gap-3 mb-3.5">
                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.firstName")}</label>
                                <input value={newUser.firstName} onChange={e => setNewUser(p => ({ ...p, firstName: e.target.value }))} placeholder={t("modal.firstNamePlaceholder")} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.lastName")}</label>
                                <input value={newUser.lastName} onChange={e => setNewUser(p => ({ ...p, lastName: e.target.value }))} placeholder={t("modal.lastNamePlaceholder")} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                            </div>
                        </div>
                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.email")}</label>
                            <input value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} placeholder={t("modal.emailPlaceholder")} type="email" className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                        </div>
                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.password")}</label>
                            <div className="relative">
                                <input value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} placeholder={t("modal.passwordPlaceholder")} type={showPassword ? "text" : "password"} className="w-full px-3 py-2.5 pr-9 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                                <button onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent border-none text-muted-foreground cursor-pointer">
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>
                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.role")}</label>
                            <select value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border">
                                <option value="tenant_agent">🎧 {tRoles("agent")}</option>
                                <option value="tenant_admin">👑 {tRoles("admin")}</option>
                                {user?.role === 'super_admin' && <option value="super_admin">🛡️ {tRoles("superAdmin")}</option>}
                            </select>
                        </div>
                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.tenantIdLabel")}</label>
                            <input value={newUser.tenantId} onChange={e => setNewUser(p => ({ ...p, tenantId: e.target.value }))} placeholder={t("modal.tenantIdPlaceholder")} className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border" />
                        </div>
                        <div className="flex gap-2.5 mt-5">
                            <button onClick={() => setShowNewUser(false)} className="flex-1 py-2.5 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer">{tc("cancel")}</button>
                            <button onClick={handleCreateUser} disabled={saving || !newUser.email || !newUser.password || !newUser.firstName} className={cn("flex-1 py-2.5 rounded-[10px] border-none text-white text-sm font-semibold", saving ? "bg-muted cursor-wait" : "bg-primary cursor-pointer")}>
                                {saving ? tc("saving") : tc("create")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {toast && (
                <div className={cn("fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold text-white shadow-lg animate-in", toast.includes("Error") ? "bg-red-500" : "bg-emerald-500")}>
                    ✓ {toast}
                </div>
            )}
        </>
    );
}
