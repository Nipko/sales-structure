"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { DataSourceBadge } from "@/hooks/useApiData";
import {
    Users, UserPlus, Shield, Mail, Phone, Building2, Search,
    MoreVertical, ChevronDown, Eye, EyeOff, Plus, X,
} from "lucide-react";

// ============================================
// MOCK DATA
// ============================================
const mockUsers = [
    { id: "u1", email: "admin@parallext.com", firstName: "Admin", lastName: "Parallext", role: "super_admin" as const, tenantName: "—", isActive: true, createdAt: "2026-01-15" },
    { id: "u2", email: "carlos@gecko.com", firstName: "Carlos", lastName: "Medina", role: "tenant_admin" as const, tenantName: "Gecko Aventura", isActive: true, createdAt: "2026-02-01" },
    { id: "u3", email: "sofia@gecko.com", firstName: "Sofía", lastName: "Henao", role: "tenant_agent" as const, tenantName: "Gecko Aventura", isActive: true, createdAt: "2026-02-10" },
    { id: "u4", email: "maria@realestate.com", firstName: "María", lastName: "López", role: "tenant_admin" as const, tenantName: "InmoVista", isActive: true, createdAt: "2026-02-20" },
    { id: "u5", email: "pedro@realestate.com", firstName: "Pedro", lastName: "García", role: "tenant_agent" as const, tenantName: "InmoVista", isActive: false, createdAt: "2026-02-25" },
];

const roleConfig: Record<string, { label: string; color: string; icon: string }> = {
    super_admin: { label: "Super Admin", color: "#e74c3c", icon: "🛡️" },
    tenant_admin: { label: "Admin Tenant", color: "#9b59b6", icon: "👑" },
    tenant_agent: { label: "Agente", color: "#3498db", icon: "🎧" },
};

export default function UsersPage() {
    const { user } = useAuth();
    const { activeTenantId } = useTenant();
    const [users, setUsers] = useState(mockUsers);
    const [isLive, setIsLive] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [roleFilter, setRoleFilter] = useState<string>("all");
    const [showNewUser, setShowNewUser] = useState(false);
    const [newUser, setNewUser] = useState({ email: "", password: "", firstName: "", lastName: "", role: "tenant_agent", tenantId: "" });
    const [showPassword, setShowPassword] = useState(false);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    const filtered = users.filter(u => {
        const matchSearch = searchQuery
            ? `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(searchQuery.toLowerCase())
            : true;
        const matchRole = roleFilter === "all" || u.role === roleFilter;
        return matchSearch && matchRole;
    });

    const stats = {
        total: users.length,
        admins: users.filter(u => u.role === "super_admin" || u.role === "tenant_admin").length,
        agents: users.filter(u => u.role === "tenant_agent").length,
        active: users.filter(u => u.isActive).length,
    };

    async function handleCreateUser() {
        if (!newUser.email || !newUser.password || !newUser.firstName) return;
        setSaving(true);
        try {
            await api.registerUser({
                email: newUser.email,
                password: newUser.password,
                firstName: newUser.firstName,
                lastName: newUser.lastName,
                role: newUser.role,
                tenantId: newUser.tenantId || undefined,
            });
            // Optimistic add
            setUsers(prev => [...prev, {
                id: `u${Date.now()}`,
                email: newUser.email,
                firstName: newUser.firstName,
                lastName: newUser.lastName,
                role: newUser.role as any,
                tenantName: "—",
                isActive: true,
                createdAt: new Date().toISOString().split("T")[0],
            }]);
            setShowNewUser(false);
            setNewUser({ email: "", password: "", firstName: "", lastName: "", role: "tenant_agent", tenantId: "" });
            setToast("Usuario creado exitosamente");
            setTimeout(() => setToast(null), 2000);
        } catch {
            setToast("Error al crear usuario");
            setTimeout(() => setToast(null), 2000);
        } finally {
            setSaving(false);
        }
    }

    return (
        <>
            <div>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                    <div>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                            <Users size={28} color="var(--accent)" /> Usuarios
                            <DataSourceBadge isLive={isLive} />
                        </h1>
                        <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                            {stats.total} usuarios · {stats.active} activos · {stats.agents} agentes
                        </p>
                    </div>
                    <button onClick={() => setShowNewUser(true)} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "10px 20px",
                        borderRadius: 10, border: "none", background: "var(--accent)", color: "white",
                        fontWeight: 600, fontSize: 14, cursor: "pointer",
                    }}>
                        <UserPlus size={18} /> Nuevo Usuario
                    </button>
                </div>

                {/* Stats Cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
                    {[
                        { label: "Total", value: stats.total, color: "var(--accent)", icon: Users },
                        { label: "Admins", value: stats.admins, color: "#9b59b6", icon: Shield },
                        { label: "Agentes", value: stats.agents, color: "#3498db", icon: Users },
                        { label: "Activos", value: stats.active, color: "#2ecc71", icon: Users },
                    ].map(stat => (
                        <div key={stat.label} style={{
                            padding: 20, borderRadius: 14, background: "var(--bg-secondary)",
                            border: "1px solid var(--border)",
                        }}>
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

                {/* Filters */}
                <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                    <div style={{ position: "relative", flex: 1, maxWidth: 340 }}>
                        <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary)" }} />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Buscar por nombre o email..."
                            style={{ width: "100%", padding: "10px 10px 10px 36px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                        />
                    </div>
                    <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={{
                        padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)",
                        background: "var(--bg-secondary)", color: "var(--text-primary)", fontSize: 14, outline: "none",
                    }}>
                        <option value="all">Todos los roles</option>
                        <option value="super_admin">Super Admin</option>
                        <option value="tenant_admin">Admin Tenant</option>
                        <option value="tenant_agent">Agente</option>
                    </select>
                </div>

                {/* Users Table */}
                <div style={{ borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ background: "var(--bg-secondary)" }}>
                                {["Usuario", "Email", "Rol", "Tenant", "Estado", "Registrado"].map(h => (
                                    <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid var(--border)" }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(u => {
                                const rc = roleConfig[u.role] || roleConfig.tenant_agent;
                                return (
                                    <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                        <td style={{ padding: "12px 16px" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                                <div style={{
                                                    width: 36, height: 36, borderRadius: "50%",
                                                    background: `linear-gradient(135deg, ${rc.color}, ${rc.color}88)`,
                                                    display: "flex", alignItems: "center", justifyContent: "center",
                                                    color: "white", fontWeight: 700, fontSize: 14,
                                                }}>{u.firstName.charAt(0)}{u.lastName.charAt(0)}</div>
                                                <span style={{ fontWeight: 600 }}>{u.firstName} {u.lastName}</span>
                                            </div>
                                        </td>
                                        <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-secondary)" }}>{u.email}</td>
                                        <td style={{ padding: "12px 16px" }}>
                                            <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: `${rc.color}15`, color: rc.color, fontWeight: 600 }}>
                                                {rc.icon} {rc.label}
                                            </span>
                                        </td>
                                        <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-secondary)" }}>{u.tenantName}</td>
                                        <td style={{ padding: "12px 16px" }}>
                                            <span style={{
                                                fontSize: 11, padding: "3px 8px", borderRadius: 6, fontWeight: 600,
                                                background: u.isActive ? "rgba(46,204,113,0.15)" : "rgba(231,76,60,0.15)",
                                                color: u.isActive ? "#2ecc71" : "#e74c3c",
                                            }}>
                                                {u.isActive ? "Activo" : "Inactivo"}
                                            </span>
                                        </td>
                                        <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-secondary)" }}>{u.createdAt}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* New User Modal */}
            {showNewUser && (
                <div style={{
                    position: "fixed", inset: 0, zIndex: 1000, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
                }} onClick={() => setShowNewUser(false)}>
                    <div onClick={e => e.stopPropagation()} style={{
                        width: 460, padding: 28, borderRadius: 18,
                        background: "var(--bg-secondary)", border: "1px solid var(--border)",
                        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
                    }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Nuevo Usuario</h2>
                            <button onClick={() => setShowNewUser(false)} style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}><X size={20} /></button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                            <div>
                                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Nombre</label>
                                <input value={newUser.firstName} onChange={e => setNewUser(p => ({ ...p, firstName: e.target.value }))} placeholder="Carlos" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                            </div>
                            <div>
                                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Apellido</label>
                                <input value={newUser.lastName} onChange={e => setNewUser(p => ({ ...p, lastName: e.target.value }))} placeholder="Medina" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                            </div>
                        </div>
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Email</label>
                            <input value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} placeholder="carlos@empresa.com" type="email" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Contraseña</label>
                            <div style={{ position: "relative" }}>
                                <input value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} placeholder="Mínimo 6 caracteres" type={showPassword ? "text" : "password"} style={{ width: "100%", padding: "10px 36px 10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                                <button onClick={() => setShowPassword(!showPassword)} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}>
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Rol</label>
                            <select value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }}>
                                <option value="tenant_agent">🎧 Agente</option>
                                <option value="tenant_admin">👑 Admin Tenant</option>
                                <option value="super_admin">🛡️ Super Admin</option>
                            </select>
                        </div>
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Tenant ID (opcional)</label>
                            <input value={newUser.tenantId} onChange={e => setNewUser(p => ({ ...p, tenantId: e.target.value }))} placeholder="UUID del tenant" style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                            <button onClick={() => setShowNewUser(false)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)", fontSize: 14, cursor: "pointer" }}>Cancelar</button>
                            <button onClick={handleCreateUser} disabled={saving || !newUser.email || !newUser.password || !newUser.firstName} style={{
                                flex: 1, padding: "10px", borderRadius: 10, border: "none",
                                background: saving ? "var(--border)" : "var(--accent)", color: "white",
                                fontSize: 14, fontWeight: 600, cursor: saving ? "wait" : "pointer",
                            }}>{saving ? "Creando..." : "Crear Usuario"}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div style={{
                    position: "fixed", bottom: 24, right: 24, zIndex: 1100,
                    padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600,
                    background: toast.includes("Error") ? "#e74c3c" : "#2ecc71", color: "white",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.2)", animation: "slideUp 0.3s ease",
                }}>
                    ✓ {toast}
                </div>
            )}
            <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </>
    );
}
