"use client";

import { useState, useEffect } from "react";
import {
    Building2,
    Plus,
    Search,
    Eye,
    Edit,
    Globe,
    MessageSquare,
    Users,
    X,
    ArrowLeft,
    KeyRound,
    CheckCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { DataSourceBadge } from "@/hooks/useApiData";

interface Tenant {
    id: string;
    name: string;
    slug: string;
    industry: string;
    language: string;
    plan: string;
    isActive: boolean;
    createdAt: string;
    channels: number;
    conversations: number;
    users: number;
}

interface TenantUser {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    isActive: boolean;
    createdAt: string;
    lastLoginAt: string | null;
}

export default function TenantsPage() {
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [isLive, setIsLive] = useState(false);
    const [newTenant, setNewTenant] = useState({
        name: "",
        slug: "",
        industry: "turismo",
        language: "es-CO",
        plan: "starter",
    });

    // Tenant detail view
    const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
    const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
    const [loadingUsers, setLoadingUsers] = useState(false);

    // Password reset modal
    const [resetUser, setResetUser] = useState<TenantUser | null>(null);
    const [newPassword, setNewPassword] = useState("");
    const [resettingPassword, setResettingPassword] = useState(false);

    // Toast
    const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

    function showToast(message: string, type: "success" | "error" = "success") {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    }

    // Load tenants from API
    useEffect(() => {
        async function load() {
            const result = await api.getTenants();
            if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                setTenants(result.data.map((t: any) => ({
                    id: t.id,
                    name: t.name,
                    slug: t.slug,
                    industry: t.industry || "N/A",
                    language: t.language || "es-CO",
                    plan: t.plan || "starter",
                    isActive: t.isActive ?? true,
                    createdAt: t.createdAt?.split("T")[0] || "\u2014",
                    channels: t._count?.channelAccounts || 0,
                    conversations: 0,
                    users: t._count?.users || 0,
                })));
                setIsLive(true);
            }
        }
        load();
    }, []);

    const filteredTenants = tenants.filter(
        (t) =>
            t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            t.slug.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleCreateTenant = async () => {
        const tenant: Tenant = {
            id: String(tenants.length + 1),
            name: newTenant.name,
            slug: newTenant.slug,
            industry: newTenant.industry,
            language: newTenant.language,
            plan: newTenant.plan,
            isActive: true,
            createdAt: new Date().toISOString().split("T")[0],
            channels: 0, conversations: 0, users: 0,
        };
        setTenants([tenant, ...tenants]);
        setShowCreateModal(false);
        setNewTenant({ name: "", slug: "", industry: "turismo", language: "es-CO", plan: "starter" });
    };

    const autoSlug = (name: string) =>
        name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "");

    const handleViewTenant = async (tenant: Tenant) => {
        setSelectedTenant(tenant);
        setLoadingUsers(true);
        const result = await api.getTenantUsers(tenant.id);
        if (result.success && Array.isArray(result.data)) {
            setTenantUsers(result.data);
        } else {
            setTenantUsers([]);
        }
        setLoadingUsers(false);
    };

    const handleResetPassword = async () => {
        if (!resetUser || !newPassword) return;
        setResettingPassword(true);
        try {
            const result = await api.adminResetPassword(resetUser.id, newPassword);
            if (result.success) {
                showToast(`Contrase\u00f1a restablecida para ${resetUser.email}`, "success");
                setResetUser(null);
                setNewPassword("");
            } else {
                showToast(result.error || "Error al restablecer contrase\u00f1a", "error");
            }
        } catch {
            showToast("Error de conexi\u00f3n", "error");
        }
        setResettingPassword(false);
    };

    const roleLabel = (role: string) => {
        const labels: Record<string, string> = {
            super_admin: "Super Admin",
            tenant_admin: "Admin",
            tenant_supervisor: "Supervisor",
            tenant_agent: "Agente",
        };
        return labels[role] || role;
    };

    // ========== TENANT DETAIL VIEW ==========
    if (selectedTenant) {
        return (
            <div className="animate-in">
                {/* Back button + header */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
                    <button
                        className="btn-outline"
                        style={{ padding: "8px 12px" }}
                        onClick={() => { setSelectedTenant(null); setTenantUsers([]); }}
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <div>
                        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>
                            {selectedTenant.name}
                        </h1>
                        <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                            {selectedTenant.slug} &middot; {selectedTenant.plan} &middot;{" "}
                            <span style={{ color: selectedTenant.isActive ? "var(--success)" : "var(--danger)" }}>
                                {selectedTenant.isActive ? "Activo" : "Inactivo"}
                            </span>
                        </p>
                    </div>
                </div>

                {/* Tenant info cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 32 }}>
                    {[
                        { label: "Industria", value: selectedTenant.industry },
                        { label: "Idioma", value: selectedTenant.language },
                        { label: "Plan", value: selectedTenant.plan },
                        { label: "Creado", value: selectedTenant.createdAt },
                        { label: "Usuarios", value: String(tenantUsers.length) },
                    ].map((item) => (
                        <div key={item.label} className="glass-card" style={{ padding: 20 }}>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                                {item.label}
                            </div>
                            <div style={{ fontSize: 18, fontWeight: 700 }}>{item.value}</div>
                        </div>
                    ))}
                </div>

                {/* Users table */}
                <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>
                    <Users size={20} style={{ verticalAlign: "middle", marginRight: 8 }} />
                    Usuarios del tenant
                </h2>
                <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
                    {loadingUsers ? (
                        <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)" }}>
                            Cargando usuarios...
                        </div>
                    ) : (
                        <table>
                            <thead>
                                <tr>
                                    <th>Nombre</th>
                                    <th>Email</th>
                                    <th>Rol</th>
                                    <th>Estado</th>
                                    <th>Creado</th>
                                    <th>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tenantUsers.map((user) => (
                                    <tr key={user.id}>
                                        <td style={{ fontWeight: 600 }}>
                                            {user.firstName} {user.lastName}
                                        </td>
                                        <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                                            {user.email}
                                        </td>
                                        <td>
                                            <span className="badge badge-info">
                                                {roleLabel(user.role)}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`badge ${user.isActive ? "badge-active" : "badge-inactive"}`}>
                                                <span style={{
                                                    width: 6, height: 6, borderRadius: "50%",
                                                    background: user.isActive ? "#00d68f" : "#ff4757",
                                                    display: "inline-block",
                                                }} />
                                                {user.isActive ? "Activo" : "Inactivo"}
                                            </span>
                                        </td>
                                        <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                                            {user.createdAt?.split("T")[0] || "\u2014"}
                                        </td>
                                        <td>
                                            <button
                                                className="btn-outline"
                                                style={{ padding: "6px 12px", display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
                                                onClick={() => { setResetUser(user); setNewPassword(""); }}
                                                title="Restablecer contrase\u00f1a"
                                            >
                                                <KeyRound size={14} />
                                                Restablecer contrase\u00f1a
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {!loadingUsers && tenantUsers.length === 0 && (
                        <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)" }}>
                            No hay usuarios en este tenant
                        </div>
                    )}
                </div>

                {/* Password reset modal */}
                {resetUser && (
                    <div
                        style={{
                            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
                            backdropFilter: "blur(4px)", display: "flex", alignItems: "center",
                            justifyContent: "center", zIndex: 100,
                        }}
                        onClick={() => setResetUser(null)}
                    >
                        <div
                            className="glass-card animate-in"
                            style={{ width: 440, maxWidth: "90vw", padding: 32 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
                                    Restablecer contrase\u00f1a
                                </h2>
                                <button
                                    onClick={() => setResetUser(null)}
                                    style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer" }}
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <p style={{ color: "var(--text-secondary)", marginBottom: 20, fontSize: 14 }}>
                                Usuario: <strong style={{ color: "var(--text-primary)" }}>{resetUser.firstName} {resetUser.lastName}</strong>
                                <br />
                                Email: <strong style={{ color: "var(--text-primary)" }}>{resetUser.email}</strong>
                            </p>

                            <div style={{ marginBottom: 20 }}>
                                <label>Nueva contrase\u00f1a</label>
                                <input
                                    type="password"
                                    placeholder="M\u00ednimo 6 caracteres"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    autoFocus
                                />
                            </div>

                            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                                <button className="btn-outline" onClick={() => setResetUser(null)}>
                                    Cancelar
                                </button>
                                <button
                                    className="btn-primary"
                                    onClick={handleResetPassword}
                                    disabled={newPassword.length < 6 || resettingPassword}
                                >
                                    {resettingPassword ? "Restableciendo..." : "Restablecer"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Toast */}
                {toast && (
                    <div style={{
                        position: "fixed", bottom: 24, right: 24, zIndex: 200,
                        padding: "14px 24px", borderRadius: 12,
                        background: toast.type === "success" ? "rgba(0, 214, 143, 0.15)" : "rgba(255, 71, 87, 0.15)",
                        border: `1px solid ${toast.type === "success" ? "var(--success)" : "var(--danger)"}`,
                        color: toast.type === "success" ? "var(--success)" : "var(--danger)",
                        display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 14,
                        backdropFilter: "blur(12px)",
                    }}>
                        <CheckCircle size={18} />
                        {toast.message}
                    </div>
                )}
            </div>
        );
    }

    // ========== TENANTS LIST VIEW ==========
    return (
        <div className="animate-in">
            {/* Header */}
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 32,
                }}
            >
                <div>
                    <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Tenants</h1>
                    <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>
                        Gestiona las empresas cliente conectadas a la plataforma
                    </p>
                </div>
                <button
                    className="btn-primary"
                    onClick={() => setShowCreateModal(true)}
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                    <Plus size={18} />
                    Nuevo Tenant
                </button>
            </div>

            {/* Search Bar */}
            <div style={{ marginBottom: 24, maxWidth: 400, position: "relative" }}>
                <Search
                    size={18}
                    style={{
                        position: "absolute",
                        left: 14,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "var(--text-secondary)",
                    }}
                />
                <input
                    placeholder="Buscar por nombre o slug..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ paddingLeft: 42 }}
                />
            </div>

            {/* Tenants Table */}
            <div className="glass-card" style={{ padding: 0, overflow: "hidden" }}>
                <table>
                    <thead>
                        <tr>
                            <th>Empresa</th>
                            <th>Industria</th>
                            <th>Plan</th>
                            <th>Estado</th>
                            <th>Usuarios</th>
                            <th>Canales</th>
                            <th>Creado</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredTenants.map((tenant) => (
                            <tr key={tenant.id}>
                                <td>
                                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                        <div
                                            style={{
                                                width: 36,
                                                height: 36,
                                                borderRadius: 8,
                                                background: tenant.isActive
                                                    ? "rgba(108, 92, 231, 0.15)"
                                                    : "rgba(255, 71, 87, 0.1)",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                            }}
                                        >
                                            <Building2
                                                size={18}
                                                color={tenant.isActive ? "#6c5ce7" : "#ff4757"}
                                            />
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 600 }}>{tenant.name}</div>
                                            <div
                                                style={{
                                                    fontSize: 12,
                                                    color: "var(--text-secondary)",
                                                }}
                                            >
                                                {tenant.slug}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td>{tenant.industry}</td>
                                <td>
                                    <span className={`badge badge-info`}>
                                        {tenant.plan}
                                    </span>
                                </td>
                                <td>
                                    <span
                                        className={`badge ${tenant.isActive ? "badge-active" : "badge-inactive"
                                            }`}
                                    >
                                        <span
                                            style={{
                                                width: 6,
                                                height: 6,
                                                borderRadius: "50%",
                                                background: tenant.isActive ? "#00d68f" : "#ff4757",
                                                display: "inline-block",
                                            }}
                                        />
                                        {tenant.isActive ? "Activo" : "Inactivo"}
                                    </span>
                                </td>
                                <td>
                                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        <Users size={14} color="var(--text-secondary)" />
                                        {tenant.users}
                                    </div>
                                </td>
                                <td>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 4,
                                        }}
                                    >
                                        <Globe size={14} color="var(--text-secondary)" />
                                        {tenant.channels}
                                    </div>
                                </td>
                                <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                                    {tenant.createdAt}
                                </td>
                                <td>
                                    <div style={{ display: "flex", gap: 6 }}>
                                        <button
                                            className="btn-outline"
                                            style={{ padding: "6px 10px" }}
                                            title="Ver detalles"
                                            onClick={() => handleViewTenant(tenant)}
                                        >
                                            <Eye size={15} />
                                        </button>
                                        <button
                                            className="btn-outline"
                                            style={{ padding: "6px 10px" }}
                                            title="Editar"
                                        >
                                            <Edit size={15} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {filteredTenants.length === 0 && (
                    <div
                        style={{
                            padding: 40,
                            textAlign: "center",
                            color: "var(--text-secondary)",
                        }}
                    >
                        No se encontraron tenants
                    </div>
                )}
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.6)",
                        backdropFilter: "blur(4px)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 100,
                    }}
                    onClick={() => setShowCreateModal(false)}
                >
                    <div
                        className="glass-card animate-in"
                        style={{
                            width: 500,
                            maxWidth: "90vw",
                            padding: 32,
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 24,
                            }}
                        >
                            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
                                Nuevo Tenant
                            </h2>
                            <button
                                onClick={() => setShowCreateModal(false)}
                                style={{
                                    background: "none",
                                    border: "none",
                                    color: "var(--text-secondary)",
                                    cursor: "pointer",
                                }}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                            <div>
                                <label>Nombre de la empresa</label>
                                <input
                                    placeholder="Ej: Gecko Aventura Extrema"
                                    value={newTenant.name}
                                    onChange={(e) => {
                                        setNewTenant({
                                            ...newTenant,
                                            name: e.target.value,
                                            slug: autoSlug(e.target.value),
                                        });
                                    }}
                                />
                            </div>

                            <div>
                                <label>Slug (identificador unico)</label>
                                <input
                                    placeholder="gecko-aventura"
                                    value={newTenant.slug}
                                    onChange={(e) =>
                                        setNewTenant({ ...newTenant, slug: e.target.value })
                                    }
                                />
                            </div>

                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr 1fr",
                                    gap: 16,
                                }}
                            >
                                <div>
                                    <label>Industria</label>
                                    <select
                                        value={newTenant.industry}
                                        onChange={(e) =>
                                            setNewTenant({ ...newTenant, industry: e.target.value })
                                        }
                                    >
                                        <option value="turismo">Turismo</option>
                                        <option value="restaurante">Restaurante</option>
                                        <option value="ecommerce">E-Commerce</option>
                                        <option value="servicios">Servicios</option>
                                        <option value="salud">Salud</option>
                                        <option value="educacion">Educacion</option>
                                        <option value="otro">Otro</option>
                                    </select>
                                </div>
                                <div>
                                    <label>Idioma</label>
                                    <select
                                        value={newTenant.language}
                                        onChange={(e) =>
                                            setNewTenant({ ...newTenant, language: e.target.value })
                                        }
                                    >
                                        <option value="es-CO">Espanol (CO)</option>
                                        <option value="es-MX">Espanol (MX)</option>
                                        <option value="es-ES">Espanol (ES)</option>
                                        <option value="en-US">English (US)</option>
                                        <option value="pt-BR">Portugues (BR)</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label>Plan</label>
                                <select
                                    value={newTenant.plan}
                                    onChange={(e) =>
                                        setNewTenant({ ...newTenant, plan: e.target.value })
                                    }
                                >
                                    <option value="starter">Starter</option>
                                    <option value="professional">Professional</option>
                                    <option value="enterprise">Enterprise</option>
                                </select>
                            </div>

                            <div
                                style={{
                                    display: "flex",
                                    gap: 12,
                                    marginTop: 8,
                                    justifyContent: "flex-end",
                                }}
                            >
                                <button
                                    className="btn-outline"
                                    onClick={() => setShowCreateModal(false)}
                                >
                                    Cancelar
                                </button>
                                <button
                                    className="btn-primary"
                                    onClick={handleCreateTenant}
                                    disabled={!newTenant.name || !newTenant.slug}
                                >
                                    Crear Tenant
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div style={{
                    position: "fixed", bottom: 24, right: 24, zIndex: 200,
                    padding: "14px 24px", borderRadius: 12,
                    background: toast.type === "success" ? "rgba(0, 214, 143, 0.15)" : "rgba(255, 71, 87, 0.15)",
                    border: `1px solid ${toast.type === "success" ? "var(--success)" : "var(--danger)"}`,
                    color: toast.type === "success" ? "var(--success)" : "var(--danger)",
                    display: "flex", alignItems: "center", gap: 10, fontWeight: 600, fontSize: 14,
                    backdropFilter: "blur(12px)",
                }}>
                    <CheckCircle size={18} />
                    {toast.message}
                </div>
            )}
        </div>
    );
}
