"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
    Building2, Plus, Search, Eye, Edit, Globe, MessageSquare, Users, X, ArrowLeft, KeyRound, CheckCircle, Activity, Link2,
} from "lucide-react";
import { api } from "@/lib/api";
import { DataSourceBadge } from "@/hooks/useApiData";

interface Tenant { id: string; name: string; slug: string; industry: string; language: string; plan: string; isActive: boolean; createdAt: string; channels: number; conversations: number; users: number; }
interface TenantUser { id: string; email: string; firstName: string; lastName: string; role: string; isActive: boolean; createdAt: string; lastLoginAt: string | null; }

export default function TenantsPage() {
    const t = useTranslations('tenants');
    const tc = useTranslations('common');
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [isLive, setIsLive] = useState(false);
    const [newTenant, setNewTenant] = useState({ name: "", slug: "", industry: "turismo", language: "es-CO", plan: "starter" });
    const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
    const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [resetUser, setResetUser] = useState<TenantUser | null>(null);
    const [newPassword, setNewPassword] = useState("");
    const [resettingPassword, setResettingPassword] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

    function showToast(message: string, type: "success" | "error" = "success") { setToast({ message, type }); setTimeout(() => setToast(null), 3000); }

    useEffect(() => {
        async function load() {
            const result = await api.getTenants();
            if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                setTenants(result.data.map((t: any) => ({ id: t.id, name: t.name, slug: t.slug, industry: t.industry || "N/A", language: t.language || "es-CO", plan: t.plan || "starter", isActive: t.isActive ?? true, createdAt: t.createdAt?.split("T")[0] || "\u2014", channels: t._count?.channelAccounts || 0, conversations: 0, users: t._count?.users || 0 })));
                setIsLive(true);
            }
        }
        load();
    }, []);

    const filteredTenants = tenants.filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase()) || t.slug.toLowerCase().includes(searchQuery.toLowerCase()));

    const handleCreateTenant = async () => {
        try {
            const result = await api.createTenant({
                name: newTenant.name,
                slug: newTenant.slug,
                industry: newTenant.industry,
                language: newTenant.language,
                plan: newTenant.plan,
            });
            if (result.success) {
                showToast(`Tenant "${newTenant.name}" creado exitosamente`, "success");
                setShowCreateModal(false);
                setNewTenant({ name: "", slug: "", industry: "turismo", language: "es-CO", plan: "starter" });
                // Reload tenant list
                const reloadResult = await api.getTenants();
                if (reloadResult.success && Array.isArray(reloadResult.data)) {
                    setTenants(reloadResult.data.map((t: any) => ({ id: t.id, name: t.name, slug: t.slug, industry: t.industry || "N/A", language: t.language || "es-CO", plan: t.plan || "starter", isActive: t.isActive ?? true, createdAt: t.createdAt?.split("T")[0] || "\u2014", channels: t._count?.channelAccounts || 0, conversations: 0, users: t._count?.users || 0 })));
                }
            } else {
                showToast(result.error || tc("errorSaving"), "error");
            }
        } catch {
            showToast(tc("connectionError"), "error");
        }
    };

    const autoSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    const handleViewTenant = async (tenant: Tenant) => {
        setSelectedTenant(tenant); setLoadingUsers(true);
        const result = await api.getTenantUsers(tenant.id);
        if (result.success && Array.isArray(result.data)) setTenantUsers(result.data); else setTenantUsers([]);
        setLoadingUsers(false);
    };

    const handleResetPassword = async () => {
        if (!resetUser || !newPassword) return;
        setResettingPassword(true);
        try {
            const result = await api.adminResetPassword(resetUser.id, newPassword);
            if (result.success) { showToast(`Contrase\u00f1a restablecida para ${resetUser.email}`, "success"); setResetUser(null); setNewPassword(""); }
            else showToast(result.error || tc("errorSaving"));
        } catch { showToast("Error de conexi\u00f3n", "error"); }
        setResettingPassword(false);
    };

    const roleLabel = (role: string) => ({ super_admin: "Super Admin", tenant_admin: "Admin", tenant_supervisor: "Supervisor", tenant_agent: "Agente" }[role] || role);

    // TENANT DETAIL VIEW
    if (selectedTenant) {
        return (
            <div className="animate-in">
                <div className="flex items-center gap-3 mb-8">
                    <button className="btn-outline p-2" onClick={() => { setSelectedTenant(null); setTenantUsers([]); }}><ArrowLeft size={18} /></button>
                    <div>
                        <h1 className="text-[28px] font-semibold m-0">{selectedTenant.name}</h1>
                        <p className="text-muted-foreground mt-1">
                            {selectedTenant.slug} &middot; {selectedTenant.plan} &middot; <span className={selectedTenant.isActive ? "text-[var(--success)]" : "text-destructive"}>{selectedTenant.isActive ? "Activo" : "Inactivo"}</span>
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 mb-8">
                    {[{ label: "Industria", value: selectedTenant.industry }, { label: "Idioma", value: selectedTenant.language }, { label: "Plan", value: selectedTenant.plan }, { label: "Creado", value: selectedTenant.createdAt }, { label: "Usuarios", value: String(tenantUsers.length) }].map(item => (
                        <div key={item.label} className="glass-card p-5">
                            <div className="text-xs text-muted-foreground mb-1">{item.label}</div>
                            <div className="text-lg font-semibold">{item.value}</div>
                        </div>
                    ))}
                </div>

                <h2 className="text-xl font-semibold mb-4"><Users size={20} className="inline align-middle mr-2" />Usuarios del tenant</h2>
                <div className="glass-card p-0 overflow-hidden">
                    {loadingUsers ? <div className="p-10 text-center text-muted-foreground">Cargando usuarios...</div> : (
                        <table>
                            <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Creado</th><th>Acciones</th></tr></thead>
                            <tbody>
                                {tenantUsers.map(user => (
                                    <tr key={user.id}>
                                        <td className="font-semibold">{user.firstName} {user.lastName}</td>
                                        <td className="text-muted-foreground text-[13px]">{user.email}</td>
                                        <td><span className="badge badge-info">{roleLabel(user.role)}</span></td>
                                        <td><span className={cn("badge", user.isActive ? "badge-active" : "badge-inactive")}><span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: user.isActive ? "#00d68f" : "#ff4757" }} /> {user.isActive ? "Activo" : "Inactivo"}</span></td>
                                        <td className="text-muted-foreground text-[13px]">{user.createdAt?.split("T")[0] || "\u2014"}</td>
                                        <td><button className="btn-outline px-3 py-1.5 flex items-center gap-1.5 text-[13px]" onClick={() => { setResetUser(user); setNewPassword(""); }} title="Restablecer contrase\u00f1a"><KeyRound size={14} />Restablecer contrase\u00f1a</button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {!loadingUsers && tenantUsers.length === 0 && <div className="p-10 text-center text-muted-foreground">No hay usuarios en este tenant</div>}
                </div>

                {resetUser && (
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={() => setResetUser(null)}>
                        <div className="glass-card animate-in w-[440px] max-w-[90vw] p-8" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="m-0 text-xl font-semibold">Restablecer contrase\u00f1a</h2>
                                <button onClick={() => setResetUser(null)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                            </div>
                            <p className="text-muted-foreground mb-5 text-sm">Usuario: <strong className="text-foreground">{resetUser.firstName} {resetUser.lastName}</strong><br />Email: <strong className="text-foreground">{resetUser.email}</strong></p>
                            <div className="mb-5"><label>Nueva contrase\u00f1a</label><input type="password" placeholder="M\u00ednimo 6 caracteres" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoFocus /></div>
                            <div className="flex gap-3 justify-end">
                                <button className="btn-outline" onClick={() => setResetUser(null)}>Cancelar</button>
                                <button className="btn-primary" onClick={handleResetPassword} disabled={newPassword.length < 6 || resettingPassword}>{resettingPassword ? "Restableciendo..." : "Restablecer"}</button>
                            </div>
                        </div>
                    </div>
                )}

                {toast && (
                    <div className={cn("fixed bottom-6 right-6 z-[200] px-6 py-3.5 rounded-xl flex items-center gap-2.5 font-semibold text-sm backdrop-blur-xl border", toast.type === "success" ? "bg-[var(--success)]/15 border-[var(--success)] text-[var(--success)]" : "bg-destructive/15 border-destructive text-destructive")}>
                        <CheckCircle size={18} /> {toast.message}
                    </div>
                )}
            </div>
        );
    }

    // TENANTS LIST VIEW
    return (
        <div className="animate-in">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-[28px] font-semibold m-0">{t('title')}</h1>
                    <p className="text-muted-foreground mt-1">Gestiona las empresas cliente conectadas a la plataforma</p>
                </div>
                <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreateModal(true)}><Plus size={18} /> Nuevo Tenant</button>
            </div>

            {/* System Stats */}
            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                    { label: "Total Tenants", value: tenants.length, icon: Building2, color: "text-indigo-500", bg: "bg-indigo-500/10" },
                    { label: "Tenants Activos", value: tenants.filter(t => t.isActive).length, icon: Activity, color: "text-emerald-500", bg: "bg-emerald-500/10" },
                    { label: "Total Usuarios", value: tenants.reduce((s, t) => s + t.users, 0), icon: Users, color: "text-sky-500", bg: "bg-sky-500/10" },
                    { label: "Canales Conectados", value: tenants.reduce((s, t) => s + t.channels, 0), icon: Link2, color: "text-amber-500", bg: "bg-amber-500/10" },
                ].map(stat => {
                    const Icon = stat.icon;
                    return (
                        <div key={stat.label} className="glass-card p-5 flex items-start justify-between">
                            <div>
                                <p className="text-xs text-muted-foreground mb-1">{stat.label}</p>
                                <p className="text-3xl font-semibold">{stat.value}</p>
                            </div>
                            <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", stat.bg)}>
                                <Icon size={22} className={stat.color} />
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mb-6 max-w-[400px] relative">
                <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input placeholder={tc("search") + "..."} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-[42px]" />
            </div>

            <div className="glass-card p-0 overflow-hidden">
                <table>
                    <thead><tr><th>Empresa</th><th>Industria</th><th>Plan</th><th>Estado</th><th>Usuarios</th><th>Canales</th><th>Creado</th><th></th></tr></thead>
                    <tbody>
                        {filteredTenants.map(tenant => (
                            <tr key={tenant.id}>
                                <td>
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: tenant.isActive ? "rgba(108,92,231,0.15)" : "rgba(255,71,87,0.1)" }}>
                                            <Building2 size={18} color={tenant.isActive ? "#6c5ce7" : "#ff4757"} />
                                        </div>
                                        <div><div className="font-semibold">{tenant.name}</div><div className="text-xs text-muted-foreground">{tenant.slug}</div></div>
                                    </div>
                                </td>
                                <td>{tenant.industry}</td>
                                <td><span className="badge badge-info">{tenant.plan}</span></td>
                                <td><span className={cn("badge", tenant.isActive ? "badge-active" : "badge-inactive")}><span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: tenant.isActive ? "#00d68f" : "#ff4757" }} />{tenant.isActive ? "Activo" : "Inactivo"}</span></td>
                                <td><div className="flex items-center gap-1"><Users size={14} className="text-muted-foreground" />{tenant.users}</div></td>
                                <td><div className="flex items-center gap-1"><Globe size={14} className="text-muted-foreground" />{tenant.channels}</div></td>
                                <td className="text-muted-foreground text-[13px]">{tenant.createdAt}</td>
                                <td>
                                    <div className="flex gap-1.5">
                                        <button className="btn-outline p-1.5" title="Ver detalles" onClick={() => handleViewTenant(tenant)}><Eye size={15} /></button>
                                        <button className="btn-outline p-1.5" title="Editar"><Edit size={15} /></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {filteredTenants.length === 0 && <div className="p-10 text-center text-muted-foreground">No se encontraron tenants</div>}
            </div>

            {showCreateModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]" onClick={() => setShowCreateModal(false)}>
                    <div className="glass-card animate-in w-[500px] max-w-[90vw] p-8" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="m-0 text-xl font-semibold">Nuevo Tenant</h2>
                            <button onClick={() => setShowCreateModal(false)} className="bg-transparent border-none text-muted-foreground cursor-pointer"><X size={20} /></button>
                        </div>
                        <div className="flex flex-col gap-4">
                            <div><label>Nombre de la empresa</label><input placeholder="Ej: Gecko Aventura Extrema" value={newTenant.name} onChange={e => setNewTenant({ ...newTenant, name: e.target.value, slug: autoSlug(e.target.value) })} /></div>
                            <div><label>Slug (identificador unico)</label><input placeholder="gecko-aventura" value={newTenant.slug} onChange={e => setNewTenant({ ...newTenant, slug: e.target.value })} /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label>Industria</label><select value={newTenant.industry} onChange={e => setNewTenant({ ...newTenant, industry: e.target.value })}><option value="turismo">Turismo</option><option value="restaurante">Restaurante</option><option value="ecommerce">E-Commerce</option><option value="servicios">Servicios</option><option value="salud">Salud</option><option value="educacion">Educacion</option><option value="otro">Otro</option></select></div>
                                <div><label>Idioma</label><select value={newTenant.language} onChange={e => setNewTenant({ ...newTenant, language: e.target.value })}><option value="es-CO">Espanol (CO)</option><option value="es-MX">Espanol (MX)</option><option value="es-ES">Espanol (ES)</option><option value="en-US">English (US)</option><option value="pt-BR">Portugues (BR)</option></select></div>
                            </div>
                            <div><label>Plan</label><select value={newTenant.plan} onChange={e => setNewTenant({ ...newTenant, plan: e.target.value })}><option value="starter">Starter</option><option value="professional">Professional</option><option value="enterprise">Enterprise</option></select></div>
                            <div className="flex gap-3 mt-2 justify-end">
                                <button className="btn-outline" onClick={() => setShowCreateModal(false)}>Cancelar</button>
                                <button className="btn-primary" onClick={handleCreateTenant} disabled={!newTenant.name || !newTenant.slug}>Crear Tenant</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {toast && (
                <div className={cn("fixed bottom-6 right-6 z-[200] px-6 py-3.5 rounded-xl flex items-center gap-2.5 font-semibold text-sm backdrop-blur-xl border", toast.type === "success" ? "bg-[var(--success)]/15 border-[var(--success)] text-[var(--success)]" : "bg-destructive/15 border-destructive text-destructive")}>
                    <CheckCircle size={18} /> {toast.message}
                </div>
            )}
        </div>
    );
}
