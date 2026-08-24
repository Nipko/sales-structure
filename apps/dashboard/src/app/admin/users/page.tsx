"use client";

import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import { cn } from "@/lib/utils";
import {
    Users, UserPlus, Shield, Search, MoreVertical, Plus, X, Tag,
    Mail, Send, RefreshCw, XCircle, Copy, Clock, CheckCircle2, AlertCircle,
    Edit2, Trash2,
} from "lucide-react";

const roleStyle: Record<string, { color: string; icon: string }> = {
    super_admin: { color: "#e74c3c", icon: "🛡️" },
    tenant_admin: { color: "#9b59b6", icon: "👑" },
    tenant_supervisor: { color: "#f39c12", icon: "⭐" },
    tenant_agent: { color: "#3498db", icon: "🎧" },
};

const SUGGESTED_SKILLS = ['ventas', 'soporte', 'técnico', 'facturación', 'quejas', 'general', 'vip', 'idiomas'];

interface Invitation {
    id: string;
    email: string;
    role: string;
    skillTags: string[];
    expiresAt: string;
    acceptedAt: string | null;
    revokedAt: string | null;
    resentAt: string | null;
    createdAt: string;
}

type InvStatus = "pending" | "accepted" | "revoked" | "expired";

function deriveStatus(inv: Invitation): InvStatus {
    if (inv.acceptedAt) return "accepted";
    if (inv.revokedAt) return "revoked";
    if (new Date(inv.expiresAt) < new Date()) return "expired";
    return "pending";
}

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
        const changed = tags.length !== skills.length || tags.some((t, i) => t !== skills[i]);
        if (changed) {
            setSaving(true);
            await onSave(userId, tags);
            setSaving(false);
        }
    }

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
    const tHelp = useTranslations("help");
    const { user } = useAuth();
    const { activeTenantId } = useTenant();

    const roleLabel = (role: string): string => {
        switch (role) {
            case "super_admin": return tRoles("superAdmin");
            case "tenant_admin": return tRoles("admin");
            case "tenant_supervisor": return tRoles("supervisor");
            case "tenant_agent": return tRoles("agent");
            case "tenant_viewer": return tRoles("viewer");
            default: return role;
        }
    };

    const [tab, setTab] = useState<"members" | "invitations">("members");
    const [users, setUsers] = useState<any[]>([]);
    const [invitations, setInvitations] = useState<Invitation[]>([]);
    const [isLive, setIsLive] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [roleFilter, setRoleFilter] = useState<string>("all");
    const [showInvite, setShowInvite] = useState(false);
    const [inviteForm, setInviteForm] = useState<{ email: string; role: string; skillTags: string[]; tenantId: string }>({
        email: "", role: "tenant_agent", skillTags: [], tenantId: "",
    });
    const [inviteSkillInput, setInviteSkillInput] = useState("");
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);

    const showToast = useCallback((msg: string, ms = 2200) => {
        setToast(msg);
        setTimeout(() => setToast(null), ms);
    }, []);

    const targetTenantId = user?.role === 'super_admin'
        ? (inviteForm.tenantId || activeTenantId || undefined)
        : (activeTenantId || undefined);

    const [showEdit, setShowEdit] = useState(false);
    const [editForm, setEditForm] = useState<{
        id: string;
        firstName: string;
        lastName: string;
        role: string;
        isActive: boolean;
        phone: string;
        jobTitle: string;
        skillTags: string[];
    }>({
        id: "",
        firstName: "",
        lastName: "",
        role: "tenant_agent",
        isActive: true,
        phone: "",
        jobTitle: "",
        skillTags: [],
    });

    function startEdit(u: any) {
        setEditForm({
            id: u.id,
            firstName: u.firstName || "",
            lastName: u.lastName || "",
            role: u.role || "tenant_agent",
            isActive: u.isActive ?? true,
            phone: u.phone || "",
            jobTitle: u.jobTitle || "",
            skillTags: u.skillTags || [],
        });
        setShowEdit(true);
    }

    async function handleSaveEdit() {
        if (!editForm.id) return;
        setSaving(true);
        try {
            const result = await api.updateUser(editForm.id, {
                firstName: editForm.firstName.trim(),
                lastName: editForm.lastName.trim(),
                role: editForm.role,
                isActive: editForm.isActive,
                phone: editForm.phone.trim(),
                jobTitle: editForm.jobTitle.trim(),
                skillTags: editForm.skillTags,
            });
            if (result.success) {
                showToast(t("toast.userUpdated"));
                setShowEdit(false);
                await loadUsers();
            } else {
                const errMsg = result.error || tc("errorSaving");
                showToast(errMsg);
            }
        } catch (err: any) {
            showToast(err?.message || tc("errorSaving"));
        } finally {
            setSaving(false);
        }
    }

    async function handleDeleteUser(userId: string, userName: string) {
        if (!confirm(t("confirmDeactivateUser"))) return;
        try {
            const result = await api.deleteUser(userId);
            if (result.success) {
                showToast(t("toast.userDeactivated"));
                await loadUsers();
            } else {
                const errMsg = result.error || tc("errorSaving");
                showToast(errMsg);
            }
        } catch (err: any) {
            showToast(err?.message || tc("errorSaving"));
        }
    }

    async function loadUsers() {
        try {
            const result = await api.getUsers();
            if (result.success && Array.isArray(result.data)) {
                setUsers(result.data.map((u: any) => ({
                    id: u.id,
                    email: u.email || '',
                    firstName: u.firstName || u.first_name || '',
                    lastName: u.lastName || u.last_name || '',
                    role: u.role || 'tenant_agent',
                    tenantName: u.tenantName || u.tenant_name || '—',
                    isActive: u.isActive ?? u.is_active ?? true,
                    createdAt: u.createdAt?.split('T')[0] || u.created_at?.split('T')[0] || '—',
                    skillTags: u.skillTags || u.skill_tags || [],
                    phone: u.phone || '',
                    jobTitle: u.jobTitle || u.job_title || '',
                })));
                setIsLive(true);
            }
        } catch (err) { console.error('Failed to load users:', err); }
    }

    async function loadInvitations() {
        if (!activeTenantId) return;
        try {
            const result = await api.listInvitations(activeTenantId);
            if (result.success && Array.isArray(result.data)) {
                setInvitations(result.data as Invitation[]);
            }
        } catch (err) { console.error('Failed to load invitations:', err); }
    }

    useEffect(() => {
        loadUsers();
        loadInvitations();
    }, [activeTenantId]);

    const filtered = users.filter(u => {
        const matchSearch = searchQuery ? `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(searchQuery.toLowerCase()) : true;
        const matchRole = roleFilter === "all" || u.role === roleFilter;
        return matchSearch && matchRole;
    });

    const stats = {
        total: users.length,
        admins: users.filter(u => u.role === "super_admin" || u.role === "tenant_admin").length,
        agents: users.filter(u => u.role === "tenant_agent").length,
        active: users.filter(u => u.isActive).length,
    };

    const pendingInvCount = invitations.filter(i => deriveStatus(i) === "pending").length;

    async function handleInvite() {
        if (!inviteForm.email || !targetTenantId) return;
        setSaving(true);
        try {
            const result = await api.createInvitation(targetTenantId, {
                email: inviteForm.email.trim().toLowerCase(),
                role: inviteForm.role,
                skillTags: inviteForm.skillTags,
            });
            if (!(result as any)?.success) {
                const errMsg = (result as any)?.error || (result as any)?.message;
                if (errMsg) {
                    showToast(errMsg);
                    setSaving(false);
                    return;
                }
                throw new Error('invite_failed');
            }
            setShowInvite(false);
            setInviteForm({ email: "", role: "tenant_agent", skillTags: [], tenantId: "" });
            setInviteSkillInput("");
            showToast(t("invitations.toast.sent"));
            await loadInvitations();
            setTab("invitations");
        } catch (err: any) {
            showToast(err?.message || tc("errorSaving"));
        } finally {
            setSaving(false);
        }
    }

    async function handleResend(inv: Invitation) {
        if (!activeTenantId) return;
        setBusyInvitationId(inv.id);
        try {
            const result = await api.resendInvitation(activeTenantId, inv.id);
            if ((result as any)?.success) {
                showToast(t("invitations.toast.resent"));
                await loadInvitations();
            } else {
                showToast(tc("errorSaving"));
            }
        } catch { showToast(tc("errorSaving")); }
        finally { setBusyInvitationId(null); }
    }

    async function handleRevoke(inv: Invitation) {
        if (!activeTenantId) return;
        if (!confirm(t("invitations.confirmRevoke"))) return;
        setBusyInvitationId(inv.id);
        try {
            const result = await api.revokeInvitation(activeTenantId, inv.id);
            if ((result as any)?.success) {
                showToast(t("invitations.toast.revoked"));
                await loadInvitations();
            } else {
                showToast(tc("errorSaving"));
            }
        } catch { showToast(tc("errorSaving")); }
        finally { setBusyInvitationId(null); }
    }

    async function handleSaveSkills(userId: string, skillTags: string[]) {
        try {
            const result = await api.updateUserSkills(userId, skillTags);
            if (result.success) {
                setUsers(prev => prev.map(u => u.id === userId ? { ...u, skillTags } : u));
                showToast(t("toast.skillsSaved"));
            } else {
                showToast(tc("errorSaving"));
            }
        } catch { showToast(tc("errorSaving")); }
    }

    function addInviteSkill(tag: string) {
        const trimmed = tag.trim().toLowerCase();
        if (trimmed && !inviteForm.skillTags.includes(trimmed)) {
            setInviteForm(p => ({ ...p, skillTags: [...p.skillTags, trimmed] }));
        }
        setInviteSkillInput("");
    }

    function removeInviteSkill(tag: string) {
        setInviteForm(p => ({ ...p, skillTags: p.skillTags.filter(t => t !== tag) }));
    }

    const isAdmin = user?.role === 'super_admin' || user?.role === 'tenant_admin';
    const inviteSkillsApplicable = inviteForm.role === 'tenant_agent' || inviteForm.role === 'tenant_supervisor';

    return (
        <>
            <div>
                <PageHeader
                    title={t('title')}
                    subtitle={t('subtitleStats', { total: stats.total, active: stats.active, agents: stats.agents })}
                    icon={Users}
                    badge={<DataSourceBadge isLive={isLive} />}
                    action={isAdmin ? (
                        <button onClick={() => setShowInvite(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-sm cursor-pointer hover:opacity-90 press-effect">
                            <UserPlus size={16} /> {t("modal.inviteButton")}
                        </button>
                    ) : null}
                />

                <HelpPanel
                    title={tHelp("users.title")}
                    description={tHelp("users.description")}
                    tips={tHelp.raw("users.tips") as string[]}
                    mediaKey="users"
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

                {/* Tabs */}
                <div className="flex border-b border-border mb-5" role="tablist">
                    <button
                        role="tab"
                        aria-selected={tab === "members"}
                        onClick={() => setTab("members")}
                        className={cn(
                            "px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px cursor-pointer bg-transparent transition-colors",
                            tab === "members" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {t("tabs.members")}
                    </button>
                    <button
                        role="tab"
                        aria-selected={tab === "invitations"}
                        onClick={() => setTab("invitations")}
                        className={cn(
                            "px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px cursor-pointer bg-transparent transition-colors flex items-center gap-2",
                            tab === "invitations" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {t("tabs.invitations")}
                        {pendingInvCount > 0 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400">
                                {pendingInvCount}
                            </span>
                        )}
                    </button>
                </div>

                {tab === "members" && (
                    <>
                        <div className="flex gap-3 mb-5">
                            <div className="relative flex-1 max-w-[340px]">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={tc("search") + "..."} className="w-full py-2.5 pl-9 pr-2.5 rounded-[10px] border border-border bg-card text-foreground text-sm outline-none box-border" />
                            </div>
                            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="px-3.5 py-2.5 rounded-[10px] border border-border bg-card text-foreground text-sm outline-none">
                                <option value="all">{t("filter.allRoles")}</option>
                                <option value="super_admin">{tRoles("superAdmin")}</option>
                                <option value="tenant_admin">{tRoles("admin")}</option>
                                <option value="tenant_supervisor">{tRoles("supervisor")}</option>
                                <option value="tenant_agent">{tRoles("agent")}</option>
                            </select>
                        </div>

                        <div className="rounded-[14px] border border-border overflow-hidden">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="bg-card">
                                        {([
                                            ...(["user", "email", "role", "skills", "tenant", "status", "registered"] as const),
                                            ...(isAdmin ? ["actions" as const] : [])
                                        ]).map(k => (
                                            <th key={k} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">
                                                {k === "skills" ? t("skills") : k === "actions" ? t("invitations.headers.actions") : t(`headers.${k}`)}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map(u => {
                                        const rc = roleStyle[u.role] || roleStyle.tenant_agent;
                                        return (
                                            <tr key={u.id} className="border-b border-border hover:bg-neutral-500/5 transition-colors">
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm" style={{ background: `linear-gradient(135deg, ${rc.color}, ${rc.color}88)` }}>
                                                            {u.firstName.charAt(0)}{u.lastName.charAt(0)}
                                                        </div>
                                                        <div>
                                                            <div className="font-semibold leading-tight">{u.firstName} {u.lastName}</div>
                                                            {u.jobTitle && <span className="text-[10px] text-muted-foreground">{u.jobTitle}</span>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-[13px] text-muted-foreground">
                                                    <div>{u.email}</div>
                                                    {u.phone && <span className="text-[10px] text-muted-foreground">{u.phone}</span>}
                                                </td>
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
                                                        {u.isActive ? tc("active") : tc("inactive")}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-[13px] text-muted-foreground">{u.createdAt}</td>
                                                {isAdmin && (
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => startEdit(u)}
                                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-transparent text-[11px] font-semibold text-foreground cursor-pointer hover:bg-muted transition-colors"
                                                                title={t("edit")}
                                                            >
                                                                <Edit2 size={11} />
                                                                {t("edit")}
                                                            </button>
                                                            {u.id !== user?.id && u.role !== 'tenant_admin' && u.role !== 'super_admin' && (
                                                                <button
                                                                    onClick={() => handleDeleteUser(u.id, `${u.firstName} ${u.lastName}`)}
                                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-500/30 bg-transparent text-[11px] font-semibold text-red-500 cursor-pointer hover:bg-red-500/10 transition-colors"
                                                                    title={t("delete")}
                                                                >
                                                                    <Trash2 size={11} />
                                                                    {t("delete")}
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}

                {tab === "invitations" && (
                    <div className="rounded-[14px] border border-border overflow-hidden">
                        {invitations.length === 0 ? (
                            <div className="p-12 text-center">
                                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                                    <Mail size={26} className="text-primary" />
                                </div>
                                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                                    {t("invitations.empty")}
                                </p>
                            </div>
                        ) : (
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="bg-card">
                                        {(["email", "role", "status", "sent", "expires", "actions"] as const).map(k => (
                                            <th key={k} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border">
                                                {t(`invitations.headers.${k}`)}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {invitations.map(inv => {
                                        const status = deriveStatus(inv);
                                        const rc = roleStyle[inv.role] || roleStyle.tenant_agent;
                                        const statusStyle: Record<InvStatus, { bg: string; color: string; icon: any }> = {
                                            pending: { bg: "rgba(245,158,11,0.15)", color: "#f59e0b", icon: Clock },
                                            accepted: { bg: "rgba(46,204,113,0.15)", color: "#2ecc71", icon: CheckCircle2 },
                                            revoked: { bg: "rgba(231,76,60,0.15)", color: "#e74c3c", icon: XCircle },
                                            expired: { bg: "rgba(148,163,184,0.18)", color: "#94a3b8", icon: AlertCircle },
                                        };
                                        const ss = statusStyle[status];
                                        const Icon = ss.icon;
                                        const canResend = status === "pending" || status === "expired";
                                        const canRevoke = status === "pending";
                                        const busy = busyInvitationId === inv.id;
                                        return (
                                            <tr key={inv.id} className="border-b border-border">
                                                <td className="px-4 py-3 text-[13px]">{inv.email}</td>
                                                <td className="px-4 py-3">
                                                    <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold" style={{ background: `${rc.color}15`, color: rc.color }}>
                                                        {rc.icon} {roleLabel(inv.role)}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md font-semibold" style={{ background: ss.bg, color: ss.color }}>
                                                        <Icon size={11} /> {t(`invitations.status.${status}`)}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-[13px] text-muted-foreground">{new Date(inv.createdAt).toLocaleDateString()}</td>
                                                <td className="px-4 py-3 text-[13px] text-muted-foreground">{new Date(inv.expiresAt).toLocaleDateString()}</td>
                                                <td className="px-4 py-3">
                                                    {(canResend || canRevoke) && (
                                                        <div className="flex items-center gap-2">
                                                            {canResend && (
                                                                <button
                                                                    onClick={() => handleResend(inv)}
                                                                    disabled={busy}
                                                                    title={t("invitations.actions.resend")}
                                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-transparent text-[11px] font-semibold text-foreground cursor-pointer hover:bg-muted transition-colors disabled:opacity-50"
                                                                >
                                                                    <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
                                                                    {t("invitations.actions.resend")}
                                                                </button>
                                                            )}
                                                            {canRevoke && (
                                                                <button
                                                                    onClick={() => handleRevoke(inv)}
                                                                    disabled={busy}
                                                                    title={t("invitations.actions.revoke")}
                                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-500/30 bg-transparent text-[11px] font-semibold text-red-500 cursor-pointer hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                                                >
                                                                    <XCircle size={11} />
                                                                    {t("invitations.actions.revoke")}
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>

            {/* Invite modal */}
            {showInvite && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowInvite(false)}>
                    <div onClick={e => e.stopPropagation()} className="w-[480px] p-7 rounded-[18px] bg-card border border-border shadow-2xl">
                        <div className="flex justify-between items-start mb-5">
                            <div>
                                <h2 className="text-xl font-semibold m-0">{t("modal.inviteTitle")}</h2>
                                <p className="text-[13px] text-muted-foreground mt-1.5 leading-snug max-w-[380px]">
                                    {t("modal.inviteSubtitle")}
                                </p>
                            </div>
                            <button onClick={() => setShowInvite(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer mt-1"><X size={20} /></button>
                        </div>

                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.email")}</label>
                            <input
                                type="email"
                                value={inviteForm.email}
                                onChange={e => setInviteForm(p => ({ ...p, email: e.target.value }))}
                                placeholder={t("modal.emailPlaceholder")}
                                autoFocus
                                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border"
                            />
                        </div>

                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.role")}</label>
                            <select
                                value={inviteForm.role}
                                onChange={e => setInviteForm(p => ({ ...p, role: e.target.value }))}
                                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border"
                            >
                                <option value="tenant_agent">🎧 {tRoles("agent")}</option>
                                <option value="tenant_supervisor">⭐ {tRoles("supervisor")}</option>
                                <option value="tenant_admin">👑 {tRoles("admin")}</option>
                            </select>
                        </div>

                        {inviteSkillsApplicable && (
                            <div className="mb-3.5">
                                <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.skillTagsLabel")}</label>
                                <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-border bg-background min-h-[44px] items-center">
                                    {inviteForm.skillTags.map(tag => (
                                        <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg-tertiary,hsl(var(--muted)))] border border-border text-xs">
                                            {tag}
                                            <button type="button" onClick={() => removeInviteSkill(tag)} className="bg-transparent border-none p-0 cursor-pointer text-muted-foreground hover:text-foreground leading-none">
                                                <X size={10} />
                                            </button>
                                        </span>
                                    ))}
                                    <input
                                        value={inviteSkillInput}
                                        onChange={e => setInviteSkillInput(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                if (inviteSkillInput.trim()) addInviteSkill(inviteSkillInput);
                                            } else if (e.key === "Backspace" && !inviteSkillInput && inviteForm.skillTags.length > 0) {
                                                setInviteForm(p => ({ ...p, skillTags: p.skillTags.slice(0, -1) }));
                                            }
                                        }}
                                        placeholder={inviteForm.skillTags.length === 0 ? t("skillPlaceholder") : ""}
                                        className="flex-1 min-w-[80px] border-none outline-none bg-transparent text-xs text-foreground placeholder:text-muted-foreground"
                                    />
                                </div>
                                <p className="mt-1 text-[11px] text-muted-foreground">{t("modal.skillTagsHint")}</p>
                            </div>
                        )}

                        {user?.role === 'super_admin' && (
                            <div className="mb-3.5">
                                <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.tenantIdLabel")}</label>
                                <input
                                    value={inviteForm.tenantId}
                                    onChange={e => setInviteForm(p => ({ ...p, tenantId: e.target.value }))}
                                    placeholder={t("modal.tenantIdPlaceholder")}
                                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border"
                                />
                                <p className="mt-1 text-[11px] text-muted-foreground">{t("modal.tenantIdHint")}</p>
                            </div>
                        )}

                        <div className="flex gap-2.5 mt-5">
                            <button onClick={() => setShowInvite(false)} className="flex-1 py-2.5 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer">{tc("cancel")}</button>
                            <button
                                onClick={handleInvite}
                                disabled={saving || !inviteForm.email || !targetTenantId}
                                className={cn(
                                    "flex-1 py-2.5 rounded-[10px] border-none text-white text-sm font-semibold inline-flex items-center justify-center gap-2",
                                    saving ? "bg-muted cursor-wait" : "bg-primary cursor-pointer",
                                )}
                            >
                                {saving ? (
                                    <>{tc("saving")}</>
                                ) : (
                                    <><Send size={14} /> {t("modal.inviteButton")}</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit modal */}
            {showEdit && (
                <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowEdit(false)}>
                    <div onClick={e => e.stopPropagation()} className="w-[480px] p-7 rounded-[18px] bg-card border border-border shadow-2xl">
                        <div className="flex justify-between items-start mb-5">
                            <div>
                                <h2 className="text-xl font-semibold m-0">{t("modal.editTitle")}</h2>
                                <p className="text-[13px] text-muted-foreground mt-1.5 leading-snug max-w-[380px]">
                                    {t("modal.editSubtitle")}
                                </p>
                            </div>
                            <button onClick={() => setShowEdit(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer mt-1"><X size={20} /></button>
                        </div>

                        <div className="grid grid-cols-2 gap-3 mb-3.5">
                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.firstName")}</label>
                                <input
                                    value={editForm.firstName}
                                    onChange={e => setEditForm(p => ({ ...p, firstName: e.target.value }))}
                                    placeholder={t("modal.firstNamePlaceholder")}
                                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.lastName")}</label>
                                <input
                                    value={editForm.lastName}
                                    onChange={e => setEditForm(p => ({ ...p, lastName: e.target.value }))}
                                    placeholder={t("modal.lastNamePlaceholder")}
                                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border"
                                />
                            </div>
                        </div>

                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.phone")}</label>
                            <input
                                value={editForm.phone}
                                onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))}
                                placeholder="+57 300 123 4567"
                                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border"
                            />
                        </div>

                        <div className="mb-3.5">
                            <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.jobTitle")}</label>
                            <input
                                value={editForm.jobTitle}
                                onChange={e => setEditForm(p => ({ ...p, jobTitle: e.target.value }))}
                                placeholder={t("modal.jobTitlePlaceholder")}
                                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border"
                            />
                        </div>

                        {/* Role selection - only allow tenant_admin to edit other roles (cannot edit another tenant_admin or promote to super_admin) */}
                        {editForm.role !== "super_admin" && (
                            <div className="mb-3.5">
                                <label className="block text-xs font-semibold text-muted-foreground mb-1">{t("modal.role")}</label>
                                <select
                                    value={editForm.role}
                                    disabled={editForm.id === user?.id} // Cannot change own role to prevent self-lockout
                                    onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))}
                                    className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm outline-none box-border disabled:opacity-50"
                                >
                                    <option value="tenant_agent">🎧 {tRoles("agent")}</option>
                                    <option value="tenant_supervisor">⭐ {tRoles("supervisor")}</option>
                                    <option value="tenant_admin">👑 {tRoles("admin")}</option>
                                </select>
                                {editForm.id === user?.id && (
                                    <p className="mt-1 text-[10px] text-muted-foreground">{t("modal.roleSelfLockHint")}</p>
                                )}
                            </div>
                        )}

                        <div className="mb-5 flex items-center justify-between p-3 rounded-lg border border-border bg-background/50">
                            <div>
                                <span className="block text-xs font-semibold text-foreground">{t("modal.status")}</span>
                                <span className="text-[11px] text-muted-foreground">{t("modal.statusHint")}</span>
                            </div>
                            <input
                                type="checkbox"
                                checked={editForm.isActive}
                                disabled={editForm.id === user?.id} // Cannot deactivate self
                                onChange={e => setEditForm(p => ({ ...p, isActive: e.target.checked }))}
                                className="w-5 h-5 cursor-pointer accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                        </div>

                        <div className="flex gap-2.5 mt-5">
                            <button onClick={() => setShowEdit(false)} className="flex-1 py-2.5 rounded-[10px] border border-border bg-transparent text-foreground text-sm cursor-pointer">{tc("cancel")}</button>
                            <button
                                onClick={handleSaveEdit}
                                disabled={saving}
                                className={cn(
                                    "flex-1 py-2.5 rounded-[10px] border-none text-white text-sm font-semibold inline-flex items-center justify-center gap-2",
                                    saving ? "bg-muted cursor-wait" : "bg-primary cursor-pointer",
                                )}
                            >
                                {saving ? tc("saving") : tc("save")}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {toast && (
                <div className={cn("fixed bottom-6 right-6 z-[1100] px-5 py-3 rounded-[10px] text-sm font-semibold text-white shadow-lg animate-in", toast.toLowerCase().includes("error") ? "bg-red-500" : "bg-emerald-500")}>
                    ✓ {toast}
                </div>
            )}
        </>
    );
}
