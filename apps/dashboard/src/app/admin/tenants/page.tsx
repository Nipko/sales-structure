"use client";

import { useState, useEffect } from "react";
import {
    Building2,
    Plus,
    Search,
    MoreVertical,
    Eye,
    Edit,
    Power,
    Trash2,
    Globe,
    MessageSquare,
    Users,
    X,
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

const mockTenants: Tenant[] = [
    {
        id: "1", name: "Gecko Aventura Extrema", slug: "gecko-aventura",
        industry: "Turismo", language: "es-CO", plan: "professional",
        isActive: true, createdAt: "2026-03-01", channels: 1, conversations: 89, users: 3,
    },
    {
        id: "2", name: "Demo Restaurant", slug: "demo-restaurant",
        industry: "Restaurante", language: "es-CO", plan: "starter",
        isActive: true, createdAt: "2026-03-02", channels: 1, conversations: 12, users: 1,
    },
];

export default function TenantsPage() {
    const [tenants, setTenants] = useState<Tenant[]>(mockTenants);
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
                    createdAt: t.createdAt?.split("T")[0] || "—",
                    channels: 0, conversations: 0, users: 0,
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
        // Try API first
        const result = await api.getTenants(); // We'll use POST via tenant creation
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
                            <th>Canales</th>
                            <th>Conversaciones</th>
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
                                <td>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 4,
                                        }}
                                    >
                                        <MessageSquare size={14} color="var(--text-secondary)" />
                                        {tenant.conversations}
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
                                <label>Slug (identificador único)</label>
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
                                        <option value="educacion">Educación</option>
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
                                        <option value="es-CO">Español (CO)</option>
                                        <option value="es-MX">Español (MX)</option>
                                        <option value="es-ES">Español (ES)</option>
                                        <option value="en-US">English (US)</option>
                                        <option value="pt-BR">Português (BR)</option>
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
        </div>
    );
}
