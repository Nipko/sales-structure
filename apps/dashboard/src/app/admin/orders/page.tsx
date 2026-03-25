"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { DataSourceBadge } from "@/hooks/useApiData";
import {
    ShoppingCart,
    Search,
    Plus,
    CreditCard,
    DollarSign,
    Package,
    CheckCircle,
    Clock,
    XCircle,
    X,
    User,
    Check,
    FileText,
} from "lucide-react";

// ---- Types ----
interface OrderItem {
    id: string; productId: string; productName: string; quantity: number; unitPrice: number; totalPrice: number;
}

interface Order {
    id: string; contactId: string; contactName: string; status: "pending" | "confirmed" | "paid" | "cancelled";
    totalAmount: number; currency: string; paymentMethod: string; notes: string;
    createdAt: string; updatedAt: string;
    items: OrderItem[];
}

interface OrdersOverview {
    totalRevenue: number; pendingRevenue: number; orderCount: number; pendingCount: number; orders: Order[];
}

interface Contact { id: string; name: string; phone: string; }
interface Product { id: string; name: string; price: number; stock: number; unit: string; }

// ---- Helpers ----
const formatCurrency = (n: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0 }).format(n);
const formatDate = (s: string) => { try { return new Date(s).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return s; } };

const statusConfig = {
    pending: { label: "Pendiente", color: "#ffa502", bg: "rgba(255,165,2,0.12)", icon: Clock },
    confirmed: { label: "Confirmada", color: "#1f93ff", bg: "rgba(31,147,255,0.12)", icon: Package },
    paid: { label: "Pagada", color: "#2ecc71", bg: "rgba(46,204,113,0.12)", icon: CheckCircle },
    cancelled: { label: "Cancelada", color: "#ff4757", bg: "rgba(255,71,87,0.12)", icon: XCircle },
};

export default function OrdersPage() {
    const { activeTenantId } = useTenant();
    const [data, setData] = useState<OrdersOverview | null>(null);
    const [isLive, setIsLive] = useState(false);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [loading, setLoading] = useState(true);

    // Form data for dropdowns
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [products, setProducts] = useState<Product[]>([]);

    useEffect(() => {
        async function load() {
            setLoading(true);
            if (!activeTenantId) { setLoading(false); return; }

            // Load Orders Overview
            const result = await api.getOrdersOverview(activeTenantId);
            if (result.success && result.data) {
                setData(result.data);
                setIsLive(true);
            } else {
                setData({ totalRevenue: 0, pendingRevenue: 0, orderCount: 0, pendingCount: 0, orders: [] });
            }

            // Prefetch Contacts and Products for the Create Order Modal
            Promise.all([
                api.getOrderContacts(activeTenantId),
                api.getInventoryProducts(activeTenantId)
            ]).then(([contactsRes, productsRes]) => {
                if (contactsRes?.success) setContacts(contactsRes.data || []);
                if (productsRes?.success) setProducts(productsRes.data || []);
            }).catch(console.error);

            setLoading(false);
        }
        load();
    }, [activeTenantId]);

    const handleUpdateStatus = async (orderId: string, status: string) => {
        if (!activeTenantId) return;
        const res = await api.updateOrderStatus(activeTenantId, orderId, status);
        if (res.success) {
            setData(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    orders: prev.orders.map(o => o.id === orderId ? { ...o, status: status as any } : o)
                };
            });
        }
    };

    const handleOpenInvoice = async (orderId: string) => {
        if (!activeTenantId) return;
        const token = localStorage.getItem("accessToken");
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";

        const res = await fetch(`${baseUrl}/orders/${activeTenantId}/${orderId}/invoice`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;

        const html = await res.text();
        const blob = new Blob([html], { type: "text/html" });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    };

    if (loading || !data) {
        return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 400 }}>
            <div style={{ width: 40, height: 40, border: "3px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        </div>;
    }

    const filteredOrders = data.orders.filter(o => {
        const matchSearch = !search || o.contactName.toLowerCase().includes(search.toLowerCase()) || o.id.toLowerCase().includes(search.toLowerCase());
        const matchStatus = !statusFilter || o.status === statusFilter;
        return matchSearch && matchStatus;
    });

    return (
        <div>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Órdenes y Reservas</h1>
                        <DataSourceBadge isLive={isLive} />
                    </div>
                    <p style={{ color: "var(--text-secondary)", margin: "4px 0 0" }}>Gestiona las ventas, pagos y reservas de tus clientes</p>
                </div>
                <button onClick={() => setShowCreateModal(true)} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "12px 20px",
                    borderRadius: 12, border: "none", background: "var(--accent)",
                    color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}>
                    <Plus size={18} /> Nueva Orden
                </button>
            </div>

            {/* KPI Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
                {[
                    { label: "Ingresos Totales (Pagado)", value: formatCurrency(data.totalRevenue), icon: DollarSign, color: "#2ecc71", sub: `${data.orders.filter(o => o.status === "paid").length} órdenes completadas` },
                    { label: "Cuentas por Cobrar", value: formatCurrency(data.pendingRevenue), icon: Clock, color: "#ffa502", sub: `${data.pendingCount} órdenes pendientes` },
                    { label: "Total Órdenes", value: data.orderCount, icon: ShoppingCart, color: "#6c5ce7", sub: "Histórico general" },
                    { label: "Ticket Promedio", value: formatCurrency(data.orderCount ? (data.totalRevenue + data.pendingRevenue) / data.orderCount : 0), icon: CreditCard, color: "#00b4d8", sub: "Por transacción" },
                ].map((kpi, i) => {
                    const Icon = kpi.icon;
                    return (
                        <div key={i} style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", padding: 20 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{kpi.label}</span>
                                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${kpi.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <Icon size={18} color={kpi.color} />
                                </div>
                            </div>
                            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>{kpi.value}</div>
                            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>{kpi.sub}</div>
                        </div>
                    );
                })}
            </div>

            {/* Filters & Search */}
            <div style={{ display: "flex", gap: 16, marginBottom: 20, justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => setStatusFilter(null)} style={{
                        padding: "8px 16px", borderRadius: 10, border: statusFilter === null ? "1px solid var(--accent)" : "1px solid var(--border)",
                        background: statusFilter === null ? "rgba(108,92,231,0.1)" : "transparent", color: statusFilter === null ? "var(--accent)" : "var(--text-secondary)",
                        fontWeight: 600, fontSize: 13, cursor: "pointer",
                    }}>Todas ({data.orderCount})</button>

                    {Object.entries(statusConfig).map(([key, config]) => (
                        <button key={key} onClick={() => setStatusFilter(key)} style={{
                            padding: "8px 16px", borderRadius: 10, border: statusFilter === key ? `1px solid ${config.color}` : "1px solid var(--border)",
                            background: statusFilter === key ? config.bg : "transparent", color: statusFilter === key ? config.color : "var(--text-secondary)",
                            fontWeight: 500, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                        }}>
                            <config.icon size={14} /> {config.label} ({data.orders.filter(o => o.status === key).length})
                        </button>
                    ))}
                </div>
                <div style={{ position: "relative", width: 280 }}>
                    <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-secondary)" }} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente u orden..."
                        style={{ width: "100%", padding: "10px 14px 10px 36px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                </div>
            </div>

            {/* Orders Table */}
            <div style={{ background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                    <thead>
                        <tr style={{ borderBottom: "1px solid var(--border)" }}>
                            {["Detalle de Orden", "Cliente", "Fecha", "Monto", "Estado", "Acción rápida"].map(h => (
                                <th key={h} style={{ padding: "14px 20px", textAlign: "left", fontWeight: 600, color: "var(--text-secondary)", fontSize: 12, textTransform: "uppercase" }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filteredOrders.map(order => {
                            const status = statusConfig[order.status];
                            const StatusIcon = status.icon;

                            return (
                                <tr key={order.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                    <td style={{ padding: "16px 20px" }}>
                                        <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
                                            #{order.id.split("-")[0].toUpperCase()}
                                        </div>
                                        <div style={{ fontSize: 13, fontWeight: 500 }}>
                                            {order.items.length} ítem(s)
                                        </div>
                                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                                            {order.items.slice(0, 2).map(i => `${i.quantity}x ${i.productName}`).join(", ")}
                                            {order.items.length > 2 ? ` (+${order.items.length - 2} más)` : ""}
                                        </div>
                                    </td>
                                    <td style={{ padding: "16px 20px" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--bg-tertiary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                <User size={16} color="var(--text-secondary)" />
                                            </div>
                                            <span style={{ fontWeight: 600 }}>{order.contactName}</span>
                                        </div>
                                    </td>
                                    <td style={{ padding: "16px 20px", color: "var(--text-secondary)", fontSize: 13 }}>
                                        {formatDate(order.createdAt)}
                                    </td>
                                    <td style={{ padding: "16px 20px" }}>
                                        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--accent)" }}>{formatCurrency(order.totalAmount)}</div>
                                        <div style={{ fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase" }}>{order.paymentMethod.replace("_", " ")}</div>
                                    </td>
                                    <td style={{ padding: "16px 20px" }}>
                                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, background: status.bg, color: status.color, fontSize: 12, fontWeight: 600 }}>
                                            <StatusIcon size={14} /> {status.label}
                                        </div>
                                    </td>
                                    <td style={{ padding: "16px 20px" }}>
                                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                            <select
                                                value={order.status}
                                                onChange={(e) => handleUpdateStatus(order.id, e.target.value)}
                                                style={{
                                                    padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)",
                                                    background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 13, cursor: "pointer", outline: "none",
                                                }}
                                            >
                                                <option value="pending">Pendiente</option>
                                                <option value="confirmed">Confirmada</option>
                                                <option value="paid">Pagada</option>
                                                <option value="cancelled">Cancelada</option>
                                            </select>

                                            <button
                                                onClick={() => handleOpenInvoice(order.id)}
                                                style={{
                                                    padding: "6px 12px", borderRadius: 8, border: "1px solid var(--accent)",
                                                    background: "rgba(108,92,231,0.1)", color: "var(--accent)", fontSize: 13, fontWeight: 600,
                                                    cursor: "pointer", display: "flex", alignItems: "center", gap: 6
                                                }}
                                            >
                                                <FileText size={14} /> Ver Recibo
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredOrders.length === 0 && (
                            <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)" }}>No se encontraron órdenes</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Create Order Modal */}
            {showCreateModal && <CreateOrderModal onClose={() => setShowCreateModal(false)} tenantId={activeTenantId || ""} products={products} contacts={contacts} onCreated={() => { setShowCreateModal(false); window.location.reload(); }} />}
        </div>
    );
}

// ---- Create Order Modal ----
function CreateOrderModal({ onClose, tenantId, products, contacts, onCreated }: { onClose: () => void; tenantId: string; products: Product[]; contacts: Contact[]; onCreated: () => void }) {
    const [status, setStatus] = useState("pending");
    const [paymentMethod, setPaymentMethod] = useState("transfer");
    const [notes, setNotes] = useState("");
    const [contactId, setContactId] = useState("");
    const [selectedItems, setSelectedItems] = useState<{ productId: string; productName: string; quantity: number; unitPrice: number; maxStock: number }[]>([]);
    const [saving, setSaving] = useState(false);

    const handleAddItem = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const id = e.target.value;
        if (!id) return;
        const prod = products.find(p => p.id === id);
        if (prod && !selectedItems.find(i => i.productId === id)) {
            setSelectedItems([...selectedItems, { productId: prod.id, productName: prod.name, quantity: 1, unitPrice: prod.price, maxStock: prod.stock }]);
        }
    };

    const updateQuantity = (id: string, q: string) => {
        const qty = parseInt(q);
        if (isNaN(qty) || qty < 1) return;
        setSelectedItems(items => items.map(i => i.productId === id ? { ...i, quantity: Math.min(qty, i.maxStock) } : i));
    };

    const removeItem = (id: string) => {
        setSelectedItems(items => items.filter(i => i.productId !== id));
    };

    const handleSubmit = async () => {
        if (selectedItems.length === 0) return;
        setSaving(true);
        await api.createOrder(tenantId, {
            contactId: contactId || undefined, status, paymentMethod, notes,
            items: selectedItems.map(i => ({ productId: i.productId, productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice }))
        });
        onCreated();
    };

    const total = selectedItems.reduce((acc, i) => acc + (i.quantity * i.unitPrice), 0);

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg-secondary)", borderRadius: 20, border: "1px solid var(--border)", padding: 28, width: 560, maxHeight: "90vh", overflowY: "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Nueva Orden</h2>
                    <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)" }}><X size={20} /></button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                    <div>
                        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Cliente</label>
                        <select value={contactId} onChange={e => setContactId(e.target.value)} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14, outline: "none", cursor: "pointer" }}>
                            <option value="">Consumidor final</option>
                            {contacts.map(c => (
                                <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ""}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Estado de la Orden</label>
                        <select value={status} onChange={e => setStatus(e.target.value)} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14, outline: "none", cursor: "pointer" }}>
                            <option value="pending">Pendiente de pago</option>
                            <option value="confirmed">Confirmada</option>
                            <option value="paid">Pagada / Completada</option>
                        </select>
                    </div>
                    <div style={{ gridColumn: "1 / span 2" }}>
                        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Método de pago</label>
                        <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14, outline: "none", cursor: "pointer" }}>
                            <option value="cash">Efectivo / Contraentrega</option>
                            <option value="transfer">Transferencia / Nequi</option>
                            <option value="credit_card">Tarjeta de Crédito</option>
                            <option value="link">Link de Pago</option>
                        </select>
                    </div>
                </div>

                <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Agregar Productos del Inventario</label>
                    <select onChange={handleAddItem} value="" style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14, outline: "none", cursor: "pointer" }}>
                        <option value="" disabled>Selecciona un producto...</option>
                        {products.filter(p => p.stock > 0).map(p => (
                            <option key={p.id} value={p.id}>{p.name} — {formatCurrency(p.price)} (Stock: {p.stock} {p.unit})</option>
                        ))}
                    </select>
                </div>

                {selectedItems.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Items agregados:</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {selectedItems.map(item => (
                                <div key={item.productId} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg-tertiary)", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)" }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, fontSize: 14 }}>{item.productName}</div>
                                        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{formatCurrency(item.unitPrice)} c/u</div>
                                    </div>
                                    <input
                                        type="number" value={item.quantity} min={1} max={item.maxStock}
                                        onChange={e => updateQuantity(item.productId, e.target.value)}
                                        style={{ width: 60, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", textAlign: "center" }}
                                    />
                                    <div style={{ fontWeight: 700, width: 90, textAlign: "right", color: "var(--accent)" }}>
                                        {formatCurrency(item.quantity * item.unitPrice)}
                                    </div>
                                    <button onClick={() => removeItem(item.productId)} style={{ background: "none", border: "none", cursor: "pointer", color: "#ff4757", padding: 4 }}>
                                        <X size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>Notas adicionales</label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Requisitos especiales, observaciones..."
                        style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box", resize: "none" }} />
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", background: "rgba(108,92,231,0.1)", borderRadius: 12, marginBottom: 20 }}>
                    <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>Total de la Orden:</span>
                    <span style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)" }}>{formatCurrency(total)}</span>
                </div>

                <button onClick={handleSubmit} disabled={saving || selectedItems.length === 0} style={{
                    width: "100%", padding: "14px", borderRadius: 12, border: "none",
                    background: "var(--accent)", color: "white", fontWeight: 600, fontSize: 15, cursor: "pointer",
                    opacity: saving || selectedItems.length === 0 ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8
                }}>
                    {saving ? "Creando..." : <><Check size={18} /> Crear Orden</>}
                </button>
            </div>
        </div>
    );
}
