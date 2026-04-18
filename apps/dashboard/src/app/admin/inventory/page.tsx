"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { DataSourceBadge } from "@/hooks/useApiData";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import {
    Package, Search, Plus, AlertTriangle, TrendingUp, TrendingDown, ArrowUpDown, Tag, Box, BarChart3, X, Check, Minus,
} from "lucide-react";

interface Product { id: string; name: string; sku: string; description: string; category: string; price: number; cost: number; currency: string; stock: number; minStock: number; maxStock: number; unit: string; imageUrl: string | null; isActive: boolean; tags: string[]; createdAt: string; updatedAt: string; }
interface Category { id: string; name: string; color: string; productCount: number; }
interface StockMovement { id: string; productId: string; productName: string; type: "in" | "out" | "adjustment"; quantity: number; previousStock: number; newStock: number; reason: string; createdAt: string; createdBy: string; }
interface InventoryOverview { totalProducts: number; activeProducts: number; totalValue: number; lowStockAlerts: number; outOfStockCount: number; categories: Category[]; products: Product[]; recentMovements: StockMovement[]; }

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
    const t = useTranslations('inventory');
    const tc = useTranslations("common");
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
            if (result.success && result.data) { setData(result.data); setIsLive(true); }
            setLoading(false);
        }
        load();
    }, [activeTenantId]);

    if (loading || !data) {
        return <div className="flex justify-center items-center h-[400px]"><div className="w-10 h-10 border-[3px] border-border border-t-primary rounded-full animate-spin" /></div>;
    }

    const filteredProducts = data.products.filter(p => {
        const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase());
        const matchCategory = !selectedCategory || p.category === selectedCategory;
        return matchSearch && matchCategory;
    });

    const margin = data.products.length > 0 ? ((data.products.reduce((s, p) => s + (p.price - p.cost) * p.stock, 0) / data.totalValue) * 100).toFixed(1) : "0";

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <div className="flex items-center gap-2.5">
                        <h1 className="text-[28px] font-semibold m-0">{t('title')}</h1>
                        <DataSourceBadge isLive={isLive} />
                    </div>
                    <p className="text-muted-foreground mt-1">Gestion de productos, stock y movimientos</p>
                </div>
                <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 px-5 py-3 rounded-xl border-none bg-primary text-white font-semibold text-sm cursor-pointer">
                    <Plus size={18} /> Nuevo Producto
                </button>
            </div>

            <div className="grid grid-cols-5 gap-4 mb-6">
                {[
                    { label: "Total Productos", value: data.totalProducts, icon: Package, color: "#6c5ce7", sub: `${data.activeProducts} activos` },
                    { label: "Valor del Inventario", value: formatCurrency(data.totalValue), icon: BarChart3, color: "#00b4d8", sub: `Margen ~${margin}%` },
                    { label: "Stock Bajo", value: data.lowStockAlerts, icon: AlertTriangle, color: "#ffa502", sub: "Requieren reabastecimiento" },
                    { label: "Agotados", value: data.outOfStockCount, icon: Box, color: "#ff4757", sub: tc("noData") },
                    { label: "Categorias", value: data.categories.length, icon: Tag, color: "#2ecc71", sub: `${data.products.length} SKUs` },
                ].map((kpi, i) => {
                    const Icon = kpi.icon;
                    return (
                        <div key={i} className="bg-card rounded-xl border border-border p-5">
                            <div className="flex justify-between mb-3">
                                <span className="text-[13px] text-muted-foreground">{kpi.label}</span>
                                <div className="w-9 h-9 rounded-[10px] flex items-center justify-center" style={{ background: `${kpi.color}15` }}>
                                    <Icon size={18} color={kpi.color} />
                                </div>
                            </div>
                            <div className="text-[26px] font-semibold" style={{ color: typeof kpi.value === "number" && ((kpi.label === "Stock Bajo" || kpi.label === "Agotados") && kpi.value > 0) ? kpi.color : undefined }}>
                                {kpi.value}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">{kpi.sub}</div>
                        </div>
                    );
                })}
            </div>

            <div className="flex gap-4 mb-5">
                <div className="flex gap-2 flex-1 flex-wrap">
                    <button onClick={() => setSelectedCategory(null)} className={cn("px-4 py-2 rounded-[10px] font-semibold text-[13px] cursor-pointer", selectedCategory === null ? "border border-primary bg-primary/10 text-primary" : "border border-border bg-transparent text-muted-foreground")}>Todos ({data.totalProducts})</button>
                    {data.categories.map(cat => (
                        <button key={cat.id} onClick={() => setSelectedCategory(cat.name)} className="px-4 py-2 rounded-[10px] font-medium text-[13px] cursor-pointer" style={{ border: selectedCategory === cat.name ? `1px solid ${cat.color}` : "1px solid var(--border)", background: selectedCategory === cat.name ? `${cat.color}15` : "transparent", color: selectedCategory === cat.name ? cat.color : undefined }}>
                            {cat.name} ({cat.productCount})
                        </button>
                    ))}
                </div>
                <div className="relative w-[280px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder={tc("search") + "..."} className="w-full py-2.5 pl-9 pr-3.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none box-border" />
                </div>
            </div>

            <div className="grid grid-cols-[2fr_1fr] gap-4">
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                    <div className="px-5 py-4 border-b border-border font-semibold text-[15px]">Productos ({filteredProducts.length})</div>
                    <div className="max-h-[520px] overflow-y-auto">
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    {["Producto", "SKU", "Categoria", "Precio", "Stock", "Estado", "Acciones"].map(h => (
                                        <th key={h} className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs uppercase">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredProducts.map(product => {
                                    const status = getStockStatus(product);
                                    return (
                                        <tr key={product.id} className="border-b border-border">
                                            <td className="px-4 py-3"><div className="font-semibold">{product.name}</div><div className="text-xs text-muted-foreground mt-0.5">{product.description?.slice(0, 40)}</div></td>
                                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{product.sku}</td>
                                            <td className="px-4 py-3"><span className="px-2.5 py-1 rounded-lg bg-muted text-xs font-medium">{product.category}</span></td>
                                            <td className="px-4 py-3 font-semibold text-primary">{formatCurrency(product.price)}</td>
                                            <td className="px-4 py-3"><span className="font-semibold text-base">{product.stock}</span><span className="text-[11px] text-muted-foreground ml-1">{product.unit}</span></td>
                                            <td className="px-4 py-3"><span className="px-2.5 py-1 rounded-lg text-xs font-semibold" style={{ background: status.bg, color: status.color }}>{status.label}</span></td>
                                            <td className="px-4 py-3">
                                                <button onClick={() => setShowStockModal(product)} className="px-3 py-1.5 rounded-lg border border-border bg-transparent text-foreground text-xs cursor-pointer flex items-center gap-1">
                                                    <ArrowUpDown size={14} /> Stock
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filteredProducts.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">No se encontraron productos</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="bg-card rounded-xl border border-border">
                    <div className="px-5 py-4 border-b border-border font-semibold text-[15px]">Movimientos Recientes</div>
                    <div className="max-h-[520px] overflow-y-auto">
                        {data.recentMovements.map(m => (
                            <div key={m.id} className="px-5 py-3.5 border-b border-border flex items-start gap-3">
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${movementTypeColor(m.type)}15` }}>
                                    {m.type === "in" ? <TrendingUp size={16} color={movementTypeColor(m.type)} /> : m.type === "out" ? <TrendingDown size={16} color={movementTypeColor(m.type)} /> : <ArrowUpDown size={16} color={movementTypeColor(m.type)} />}
                                </div>
                                <div className="flex-1">
                                    <div className="font-semibold text-[13px]">{m.productName}</div>
                                    <div className="text-xs text-muted-foreground mt-0.5">{m.reason}</div>
                                    <div className="flex gap-3 mt-1.5">
                                        <span className="text-xs font-semibold" style={{ color: movementTypeColor(m.type) }}>{movementTypeLabel(m.type)}: {m.type === "in" ? "+" : m.type === "out" ? "-" : ""}{m.quantity}</span>
                                        <span className="text-[11px] text-muted-foreground">{m.previousStock} → {m.newStock}</span>
                                    </div>
                                </div>
                                <div className="text-[11px] text-muted-foreground whitespace-nowrap">{formatDate(m.createdAt)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {showCreateModal && <CreateProductModal onClose={() => setShowCreateModal(false)} categories={data.categories} tenantId={activeTenantId || ""} onCreated={() => { setShowCreateModal(false); window.location.reload(); }} />}
            {showStockModal && <StockAdjustModal product={showStockModal} onClose={() => setShowStockModal(null)} tenantId={activeTenantId || ""} onAdjusted={() => { setShowStockModal(null); window.location.reload(); }} />}
        </div>
    );
}

function CreateProductModal({ onClose, categories, tenantId, onCreated }: { onClose: () => void; categories: Category[]; tenantId: string; onCreated: () => void }) {
    const tc = useTranslations("common");
    const [form, setForm] = useState({ name: "", sku: "", description: "", categoryId: "", price: "", cost: "", stock: "", unit: "unidad" });
    const [saving, setSaving] = useState(false);

    const handleSubmit = async () => {
        if (!form.name || !form.sku || !form.price) return;
        setSaving(true);
        await api.createInventoryProduct(tenantId, { name: form.name, sku: form.sku, description: form.description, categoryId: form.categoryId || undefined, price: parseFloat(form.price), cost: parseFloat(form.cost) || 0, stock: parseInt(form.stock) || 0, unit: form.unit });
        onCreated();
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-[1000] flex items-center justify-center" onClick={onClose}>
            <div onClick={e => e.stopPropagation()} className="bg-card rounded-[20px] border border-border p-7 w-[480px] max-h-[80vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-5">
                    <h2 className="text-xl font-semibold m-0">Nuevo Producto</h2>
                    <button onClick={onClose} className="bg-transparent border-none cursor-pointer text-muted-foreground"><X size={20} /></button>
                </div>
                <div className="flex flex-col gap-3.5">
                    {[
                        { key: "name", label: "Nombre del producto", placeholder: "Tour Rafting Rio Fonce" },
                        { key: "sku", label: "SKU", placeholder: "TOUR-RAFT-001" },
                        { key: "description", label: "Descripcion", placeholder: "Descripcion breve..." },
                    ].map(f => (
                        <div key={f.key}>
                            <label className="text-[13px] font-semibold block mb-1">{f.label}</label>
                            <input value={(form as any)[f.key]} onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none box-border" />
                        </div>
                    ))}
                    <div className="grid grid-cols-2 gap-3">
                        {[{ key: "price", label: "Precio", ph: "120000" }, { key: "cost", label: "Costo", ph: "45000" }].map(f => (
                            <div key={f.key}>
                                <label className="text-[13px] font-semibold block mb-1">{f.label}</label>
                                <input type="number" value={(form as any)[f.key]} onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.ph} className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none box-border" />
                            </div>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[13px] font-semibold block mb-1">Stock inicial</label>
                            <input type="number" value={form.stock} onChange={e => setForm(prev => ({ ...prev, stock: e.target.value }))} placeholder="50" className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none box-border" />
                        </div>
                        <div>
                            <label className="text-[13px] font-semibold block mb-1">Unidad</label>
                            <select value={form.unit} onChange={e => setForm(prev => ({ ...prev, unit: e.target.value }))} className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none cursor-pointer">
                                {["unidad", "cupo", "porcion", "viaje", "noche", "hora", "kg", "litro"].map(u => <option key={u} value={u}>{u}</option>)}
                            </select>
                        </div>
                    </div>
                </div>
                <button onClick={handleSubmit} disabled={saving || !form.name || !form.sku || !form.price} className={cn("w-full mt-5 py-3 px-6 rounded-xl border-none bg-primary text-white font-semibold text-sm cursor-pointer", (saving || !form.name || !form.sku || !form.price) && "opacity-50")}>
                    {saving ? "Guardando..." : tc("create")}
                </button>
            </div>
        </div>
    );
}

function StockAdjustModal({ product, onClose, tenantId, onAdjusted }: { product: Product; onClose: () => void; tenantId: string; onAdjusted: () => void }) {
    const [type, setType] = useState<"in" | "out" | "adjustment">("in");
    const [quantity, setQuantity] = useState("");
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);

    const handleSubmit = async () => {
        if (!quantity || !reason) return;
        setSaving(true);
        await api.adjustInventoryStock(tenantId, product.id, { type, quantity: parseInt(quantity), reason });
        onAdjusted();
    };

    const newStock = type === "in" ? product.stock + (parseInt(quantity) || 0) : type === "out" ? Math.max(0, product.stock - (parseInt(quantity) || 0)) : parseInt(quantity) || 0;

    return (
        <div className="fixed inset-0 bg-black/60 z-[1000] flex items-center justify-center" onClick={onClose}>
            <div onClick={e => e.stopPropagation()} className="bg-card rounded-[20px] border border-border p-7 w-[420px]">
                <div className="flex justify-between items-center mb-5">
                    <h2 className="text-xl font-semibold m-0">Ajustar Stock</h2>
                    <button onClick={onClose} className="bg-transparent border-none cursor-pointer text-muted-foreground"><X size={20} /></button>
                </div>
                <div className="bg-muted rounded-xl p-4 mb-5">
                    <div className="font-semibold">{product.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">SKU: {product.sku} · Stock actual: <strong>{product.stock} {product.unit}</strong></div>
                </div>
                <div className="flex gap-2 mb-4">
                    {([
                        { id: "in" as const, label: "Entrada", icon: Plus, color: "#2ecc71" },
                        { id: "out" as const, label: "Salida", icon: Minus, color: "#ff4757" },
                        { id: "adjustment" as const, label: "Ajuste", icon: ArrowUpDown, color: "#ffa502" },
                    ]).map(opt => {
                        const Icon = opt.icon;
                        return (
                            <button key={opt.id} onClick={() => setType(opt.id)} className="flex-1 py-2.5 rounded-[10px] font-semibold text-[13px] cursor-pointer flex items-center justify-center gap-1.5" style={{ border: type === opt.id ? `2px solid ${opt.color}` : "1px solid var(--border)", background: type === opt.id ? `${opt.color}15` : "transparent", color: type === opt.id ? opt.color : undefined }}>
                                <Icon size={16} /> {opt.label}
                            </button>
                        );
                    })}
                </div>
                <div className="mb-3.5">
                    <label className="text-[13px] font-semibold block mb-1">Cantidad</label>
                    <input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder={type === "adjustment" ? "Nuevo stock total" : "Cantidad"} className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-base font-semibold outline-none box-border" />
                </div>
                <div className="mb-3.5">
                    <label className="text-[13px] font-semibold block mb-1">Razon</label>
                    <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Ej: Compra proveedor, venta reserva..." className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none box-border" />
                </div>
                {quantity && (
                    <div className="bg-muted rounded-[10px] p-3 mb-4 flex justify-between items-center">
                        <span className="text-[13px] text-muted-foreground">Resultado:</span>
                        <span className="text-base font-semibold">{product.stock} → <span style={{ color: newStock < product.minStock ? "#ff4757" : "#2ecc71" }}>{newStock}</span> {product.unit}</span>
                    </div>
                )}
                <button onClick={handleSubmit} disabled={saving || !quantity || !reason} className={cn("w-full py-3 rounded-xl border-none text-white font-semibold text-sm cursor-pointer flex items-center justify-center gap-1.5", (saving || !quantity || !reason) && "opacity-50")} style={{ background: type === "in" ? "#2ecc71" : type === "out" ? "#ff4757" : "#ffa502" }}>
                    {saving ? "Procesando..." : <><Check size={16} />Confirmar {movementTypeLabel(type)}</>}
                </button>
            </div>
        </div>
    );
}
