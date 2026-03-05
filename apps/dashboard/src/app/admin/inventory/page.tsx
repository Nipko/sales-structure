"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { DataSourceBadge } from "@/hooks/useApiData";
import {
    Package,
    Search,
    Plus,
    AlertTriangle,
    TrendingUp,
    TrendingDown,
    ArrowUpDown,
    Tag,
    Box,
    BarChart3,
    X,
    Check,
    Minus,
} from "lucide-react";

// ---- Types ----
interface Product {
    id: string; name: string; sku: string; description: string; category: string;
    price: number; cost: number; currency: string; stock: number; minStock: number;
    maxStock: number; unit: string; imageUrl: string | null; isActive: boolean;
    tags: string[]; createdAt: string; updatedAt: string;
}

interface Category { id: string; name: string; color: string; productCount: number; }

interface StockMovement {
    id: string; productId: string; productName: string; type: "in" | "out" | "adjustment";
    quantity: number; previousStock: number; newStock: number; reason: string;
    createdAt: string; createdBy: string;
}

interface InventoryOverview {
    totalProducts: number; activeProducts: number; totalValue: number;
    lowStockAlerts: number; outOfStockCount: number; categories: Category[];
    products: Product[]; recentMovements: StockMovement[];
}

// ---- Helpers ----
const formatCurrency = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0 }).format(n);
const formatDate = (s: string) => { try { return new Date(s).toLocaleDateString("es-CO", { day: "2-digit", month: "short" }); } catch { return s; } };
const getStockStatus = (p: Product) => {
    if (p.stock === 0) return { label: "Agotado", color: "#ff4757", bg: "rgba(255,71,87,0.12)" };
    if (p.stock <= p.minStock) return { label: "Stock bajo", color: "#ffa502", bg: "rgba(255,165,2,0.12)" };
    return { label: "Disponible", color: "#2ecc71", bg: "rgba(46,204,113,0.12)" };
};
const movementTypeLabel = (t: string) => t === "in" ? "Entrada" : t === "out" ? "Salida" : "Ajuste";
const movementTypeColor = (t: string) => t === "in" ? "#2ecc71" : t === "out" ? "#ff4757" : "#ffa502";

export default function InventoryPage() {
    const { activeTenantId } = useTenant();
    const [data, setData] = useState<InventoryOverview | null>(null);
    const [isLive, setIsLive] = useState(false);
    const [search, setSearch] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showStockModal, setShowStockModal] = useState<Product | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            setLoading(true);
            if (!activeTenantId) { setLoading(false); return; }
            const result = await api.getInventoryOverview(activeTenantId);
            if (result.success && result.data) {
                setData(result.data);
                setIsLive(true);
            }
            setLoading(false);
        }
        load();
    }, [activeTenantId]);

    if (loading || !data) {
        return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 400 }}>
            <div style={{ width: 40, height: 40, border: "3px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        </div>;
    }

    const filteredProducts = data.products.filter(p => {
        const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
        const matchCategory = !selectedCategory || p.category === selectedCategory;
        return matchSearch && matchCategory;
    });

    const margin = data.products.length > 0
        ? ((data.products.reduce((s, p) => s + (p.price - p.cost) * p.stock, 0) / data.totalValue) * 100).toFixed(1)
        : "0";

    return (
        <div>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Inventario</h1>
                        <DataSourceBadge isLive={isLive} />
                    </div>
                    <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>Gestión de productos, stock y movimientos</p>
                </div>
                <button onClick={() => setShowCreateModal(true)} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "12px 20px",
                    borderRadius: 12, border: "none", background: "var(--accent)",
                    color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}>
                    <Plus size={18} /> Nuevo Producto
                </button>
            </div>

            {/* KPI Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, marginBottom: 24 }}>
                {[
                    { label: "Total Productos", value: data.totalProducts, icon: Package, color: "#6c5ce7", sub: `${data.activeProducts} activos` },
                    { label: "Valor del Inventario", value: formatCurrency(data.totalValue), icon: BarChart3, color: "#00b4d8", sub: `Margen ~${margin}%` },
                    { label: "Stock Bajo", value: data.lowStockAlerts, icon: AlertTriangle, color: "#ffa502", sub: "Requieren reabastecimiento" },
                    { label: "Agotados", value: data.outOfStockCount, icon: Box, color: "#ff4757", sub: "Sin disponibilidad" },
                    { label: "Categorías", value: data.categories.length, icon: Tag, color: "#2ecc71", sub: `${data.products.length} SKUs` },
                ].map((kpi, i) => {
                    const Icon = kpi.icon;
                    return (
                        <div key={i} style={{
                            background: "var(--bg-secondary)", borderRadius: 16,
                            border: "1px solid var(--border)", padding: 20,
                        }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{kpi.label}</span>
                                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${kpi.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <Icon size={18} color={kpi.color} />
                                </div>
                            </div>
                            <div style={{ fontSize: 26, fontWeight: 700, color: typeof kpi.value === "number" && ((kpi.label === "Stock Bajo" || kpi.label === "Agotados") && kpi.value > 0) ? kpi.color : "var(--text-primary)" }}>
                                {kpi.value}
                            </div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{kpi.sub}</div>
                        </div>
                    );
                })}
            </div>

            {/* Categories + Search */}
            <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
                <div style={{ display: "flex", gap: 8, flex: 1, flexWrap: "wrap" }}>
                    <button onClick={() => setSelectedCategory(null)} style={{
                        padding: "8px 16px", borderRadius: 10, border: selectedCategory === null ? "1px solid var(--accent)" : "1px solid var(--border)",
                        background: selectedCategory === null ? "rgba(108,92,231,0.1)" : "transparent",
                        color: selectedCategory === null ? "var(--accent)" : "var(--text-secondary)",
                        fontWeight: 600, fontSize: 13, cursor: "pointer",
                    }}>Todos ({data.totalProducts})</button>
                    {data.categories.map(cat => (
                        <button key={cat.id} onClick={() => setSelectedCategory(cat.name)} style={{
                            padding: "8px 16px", borderRadius: 10,
                            border: selectedCategory === cat.name ? `1px solid ${cat.color}` : "1px solid var(--border)",
                            background: selectedCategory === cat.name ? `${cat.color}15` : "transparent",
                            color: selectedCategory === cat.name ? cat.color : "var(--text-secondary)",
                            fontWeight: 500, fontSize: 13, cursor: "pointer",
                        }}>
                            {cat.name} ({cat.productCount})
                        </button>
                    ))}
                </div>
                <div style={{ position: "relative", width: 280 }}>
                    <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary)" }} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto o SKU..."
                        style={{
                            width: "100%", padding: "10px 14px 10px 36px", borderRadius: 10,
                            border: "1px solid var(--border)", background: "var(--bg-tertiary)",
                            color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box",
                        }} />
                </div>
            </div>

            {/* Products Table + Recent Movements */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
                {/* Products Table */}
                <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>
                    <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 15 }}>
                        Productos ({filteredProducts.length})
                    </div>
                    <div style={{ maxHeight: 520, overflowY: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                            <thead>
                                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                                    {["Producto", "SKU", "Categoría", "Precio", "Stock", "Estado", "Acciones"].map(h => (
                                        <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "var(--text-secondary)", fontSize: 12, textTransform: "uppercase" }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredProducts.map(product => {
                                    const status = getStockStatus(product);
                                    return (
                                        <tr key={product.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                            <td style={{ padding: "12px 16px" }}>
                                                <div style={{ fontWeight: 600 }}>{product.name}</div>
                                                <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{product.description?.slice(0, 40)}</div>
                                            </td>
                                            <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)" }}>{product.sku}</td>
                                            <td style={{ padding: "12px 16px" }}>
                                                <span style={{ padding: "4px 10px", borderRadius: 8, background: "var(--bg-tertiary)", fontSize: 12, fontWeight: 500 }}>{product.category}</span>
                                            </td>
                                            <td style={{ padding: "12px 16px", fontWeight: 600, color: "#6c5ce7" }}>{formatCurrency(product.price)}</td>
                                            <td style={{ padding: "12px 16px" }}>
                                                <span style={{ fontWeight: 700, fontSize: 16 }}>{product.stock}</span>
                                                <span style={{ fontSize: 11, color: "var(--text-secondary)", marginLeft: 4 }}>{product.unit}</span>
                                            </td>
                                            <td style={{ padding: "12px 16px" }}>
                                                <span style={{ padding: "4px 10px", borderRadius: 8, background: status.bg, color: status.color, fontSize: 12, fontWeight: 600 }}>{status.label}</span>
                                            </td>
                                            <td style={{ padding: "12px 16px" }}>
                                                <button onClick={() => setShowStockModal(product)} style={{
                                                    padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)",
                                                    background: "transparent", color: "var(--text-primary)", fontSize: 12,
                                                    cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                                                }}>
                                                    <ArrowUpDown size={14} /> Stock
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filteredProducts.length === 0 && (
                                    <tr><td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)" }}>No se encontraron productos</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Recent Movements */}
                <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)" }}>
                    <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 15 }}>
                        Movimientos Recientes
                    </div>
                    <div style={{ maxHeight: 520, overflowY: "auto" }}>
                        {data.recentMovements.map(m => (
                            <div key={m.id} style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 12 }}>
                                <div style={{
                                    width: 32, height: 32, borderRadius: 8,
                                    background: `${movementTypeColor(m.type)}15`,
                                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2,
                                }}>
                                    {m.type === "in" ? <TrendingUp size={16} color={movementTypeColor(m.type)} /> :
                                        m.type === "out" ? <TrendingDown size={16} color={movementTypeColor(m.type)} /> :
                                            <ArrowUpDown size={16} color={movementTypeColor(m.type)} />}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, fontSize: 13 }}>{m.productName}</div>
                                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{m.reason}</div>
                                    <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                                        <span style={{ fontSize: 12, color: movementTypeColor(m.type), fontWeight: 600 }}>
                                            {movementTypeLabel(m.type)}: {m.type === "in" ? "+" : m.type === "out" ? "-" : ""}{m.quantity}
                                        </span>
                                        <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                                            {m.previousStock} → {m.newStock}
                                        </span>
                                    </div>
                                </div>
                                <div style={{ fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                                    {formatDate(m.createdAt)}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Create Product Modal */}
            {showCreateModal && <CreateProductModal onClose={() => setShowCreateModal(false)} categories={data.categories} tenantId={activeTenantId || ""} onCreated={() => { setShowCreateModal(false); window.location.reload(); }} />}

            {/* Stock Adjustment Modal */}
            {showStockModal && <StockAdjustModal product={showStockModal} onClose={() => setShowStockModal(null)} tenantId={activeTenantId || ""} onAdjusted={() => { setShowStockModal(null); window.location.reload(); }} />}
        </div>
    );
}

// ---- Create Product Modal ----
function CreateProductModal({ onClose, categories, tenantId, onCreated }: { onClose: () => void; categories: Category[]; tenantId: string; onCreated: () => void }) {
    const [form, setForm] = useState({ name: "", sku: "", description: "", categoryId: "", price: "", cost: "", stock: "", unit: "unidad" });
    const [saving, setSaving] = useState(false);

    const handleSubmit = async () => {
        if (!form.name || !form.sku || !form.price) return;
        setSaving(true);
        await api.createInventoryProduct(tenantId, {
            name: form.name, sku: form.sku, description: form.description,
            categoryId: form.categoryId || undefined,
            price: parseFloat(form.price), cost: parseFloat(form.cost) || 0,
            stock: parseInt(form.stock) || 0, unit: form.unit,
        });
        onCreated();
    };

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg-secondary)", borderRadius: 20, border: "1px solid var(--border)", padding: 28, width: 480, maxHeight: "80vh", overflowY: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Nuevo Producto</h2>
                    <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)" }}><X size={20} /></button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {[
                        { key: "name", label: "Nombre del producto", placeholder: "Tour Rafting Río Fonce", type: "text" },
                        { key: "sku", label: "SKU", placeholder: "TOUR-RAFT-001", type: "text" },
                        { key: "description", label: "Descripción", placeholder: "Descripción breve...", type: "text" },
                    ].map(f => (
                        <div key={f.key}>
                            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>{f.label}</label>
                            <input value={(form as any)[f.key]} onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder}
                                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                        </div>
                    ))}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div>
                            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Precio</label>
                            <input type="number" value={form.price} onChange={e => setForm(prev => ({ ...prev, price: e.target.value }))} placeholder="120000"
                                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Costo</label>
                            <input type="number" value={form.cost} onChange={e => setForm(prev => ({ ...prev, cost: e.target.value }))} placeholder="45000"
                                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                        </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div>
                            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Stock inicial</label>
                            <input type="number" value={form.stock} onChange={e => setForm(prev => ({ ...prev, stock: e.target.value }))} placeholder="50"
                                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                        </div>
                        <div>
                            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Unidad</label>
                            <select value={form.unit} onChange={e => setForm(prev => ({ ...prev, unit: e.target.value }))}
                                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14, outline: "none", cursor: "pointer" }}>
                                {["unidad", "cupo", "porción", "viaje", "noche", "hora", "kg", "litro"].map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                        </div>
                    </div>
                </div>
                <button onClick={handleSubmit} disabled={saving || !form.name || !form.sku || !form.price} style={{
                    width: "100%", marginTop: 20, padding: "12px 24px", borderRadius: 12,
                    border: "none", background: "var(--accent)", color: "white",
                    fontWeight: 600, fontSize: 14, cursor: "pointer",
                    opacity: saving || !form.name || !form.sku || !form.price ? 0.5 : 1,
                }}>
                    {saving ? "Guardando..." : "Crear Producto"}
                </button>
            </div>
        </div>
    );
}

// ---- Stock Adjustment Modal ----
function StockAdjustModal({ product, onClose, tenantId, onAdjusted }: { product: Product; onClose: () => void; tenantId: string; onAdjusted: () => void }) {
    const [type, setType] = useState<"in" | "out" | "adjustment">("in");
    const [quantity, setQuantity] = useState("");
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);

    const handleSubmit = async () => {
        if (!quantity || !reason) return;
        setSaving(true);
        await api.adjustInventoryStock(tenantId, product.id, {
            type, quantity: parseInt(quantity), reason,
        });
        onAdjusted();
    };

    const newStock = type === "in" ? product.stock + (parseInt(quantity) || 0)
        : type === "out" ? Math.max(0, product.stock - (parseInt(quantity) || 0))
            : parseInt(quantity) || 0;

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg-secondary)", borderRadius: 20, border: "1px solid var(--border)", padding: 28, width: 420 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Ajustar Stock</h2>
                    <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)" }}><X size={20} /></button>
                </div>

                <div style={{ background: "var(--bg-tertiary)", borderRadius: 12, padding: 16, marginBottom: 20 }}>
                    <div style={{ fontWeight: 600 }}>{product.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>SKU: {product.sku} · Stock actual: <strong>{product.stock} {product.unit}</strong></div>
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                    {([
                        { id: "in" as const, label: "Entrada", icon: Plus, color: "#2ecc71" },
                        { id: "out" as const, label: "Salida", icon: Minus, color: "#ff4757" },
                        { id: "adjustment" as const, label: "Ajuste", icon: ArrowUpDown, color: "#ffa502" },
                    ]).map(opt => {
                        const Icon = opt.icon;
                        return (
                            <button key={opt.id} onClick={() => setType(opt.id)} style={{
                                flex: 1, padding: "10px", borderRadius: 10,
                                border: type === opt.id ? `2px solid ${opt.color}` : "1px solid var(--border)",
                                background: type === opt.id ? `${opt.color}15` : "transparent",
                                color: type === opt.id ? opt.color : "var(--text-secondary)",
                                fontWeight: 600, fontSize: 13, cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                            }}>
                                <Icon size={16} /> {opt.label}
                            </button>
                        );
                    })}
                </div>

                <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Cantidad</label>
                    <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder={type === "adjustment" ? "Nuevo stock total" : "Cantidad"}
                        style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 16, fontWeight: 700, outline: "none", boxSizing: "border-box" }} />
                </div>

                <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Razón</label>
                    <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Ej: Compra proveedor, venta reserva..."
                        style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                </div>

                {quantity && (
                    <div style={{ background: "var(--bg-tertiary)", borderRadius: 10, padding: 12, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Resultado:</span>
                        <span style={{ fontSize: 16, fontWeight: 700 }}>{product.stock} → <span style={{ color: newStock < product.minStock ? "#ff4757" : "#2ecc71" }}>{newStock}</span> {product.unit}</span>
                    </div>
                )}

                <button onClick={handleSubmit} disabled={saving || !quantity || !reason} style={{
                    width: "100%", padding: "12px", borderRadius: 12, border: "none",
                    background: type === "in" ? "#2ecc71" : type === "out" ? "#ff4757" : "#ffa502",
                    color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer",
                    opacity: saving || !quantity || !reason ? 0.5 : 1,
                }}>
                    {saving ? "Procesando..." : <><Check size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />Confirmar {movementTypeLabel(type)}</>}
                </button>
            </div>
        </div>
    );
}
