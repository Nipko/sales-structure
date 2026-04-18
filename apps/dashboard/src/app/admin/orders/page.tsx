"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { DataSourceBadge } from "@/hooks/useApiData";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import {
    ShoppingCart, Search, Plus, CreditCard, DollarSign, Package, CheckCircle, Clock, XCircle, X, User, Check, FileText,
} from "lucide-react";

interface OrderItem { id: string; productId: string; productName: string; quantity: number; unitPrice: number; totalPrice: number; }
interface Order { id: string; contactId: string; contactName: string; status: "pending" | "confirmed" | "paid" | "cancelled"; totalAmount: number; currency: string; paymentMethod: string; notes: string; createdAt: string; updatedAt: string; items: OrderItem[]; }
interface OrdersOverview { totalRevenue: number; pendingRevenue: number; orderCount: number; pendingCount: number; orders: Order[]; }
interface Contact { id: string; name: string; phone: string; }
interface Product { id: string; name: string; price: number; stock: number; unit: string; }

const formatCurrency = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "COP", minimumFractionDigits: 0 }).format(n);
const formatDate = (s: string) => { try { return new Date(s).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return s; } };

const statusConfig = {
    pending: { label: "Pending", color: "#ffa502", bg: "rgba(255,165,2,0.12)", icon: Clock },
    confirmed: { label: "Confirmed", color: "#1f93ff", bg: "rgba(31,147,255,0.12)", icon: Package },
    paid: { label: "Paid", color: "#2ecc71", bg: "rgba(46,204,113,0.12)", icon: CheckCircle },
    cancelled: { label: "Cancelled", color: "#ff4757", bg: "rgba(255,71,87,0.12)", icon: XCircle },
};

export default function OrdersPage() {
    const t = useTranslations('orders');
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const [data, setData] = useState<OrdersOverview | null>(null);
    const [isLive, setIsLive] = useState(false);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [loading, setLoading] = useState(true);
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [products, setProducts] = useState<Product[]>([]);

    useEffect(() => {
        async function load() {
            setLoading(true);
            if (!activeTenantId) { setLoading(false); return; }
            const result = await api.getOrdersOverview(activeTenantId);
            if (result.success && result.data) { setData(result.data); setIsLive(true); }
            else { setData({ totalRevenue: 0, pendingRevenue: 0, orderCount: 0, pendingCount: 0, orders: [] }); }
            Promise.all([api.getOrderContacts(activeTenantId), api.getInventoryProducts(activeTenantId)]).then(([c, p]) => {
                if (c?.success) setContacts(c.data || []);
                if (p?.success) setProducts(p.data || []);
            }).catch(console.error);
            setLoading(false);
        }
        load();
    }, [activeTenantId]);

    const handleUpdateStatus = async (orderId: string, status: string) => {
        if (!activeTenantId) return;
        const res = await api.updateOrderStatus(activeTenantId, orderId, status);
        if (res.success) { setData(prev => prev ? { ...prev, orders: prev.orders.map(o => o.id === orderId ? { ...o, status: status as any } : o) } : prev); }
    };

    const handleOpenInvoice = async (orderId: string) => {
        if (!activeTenantId) return;
        const token = localStorage.getItem("accessToken");
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";
        const res = await fetch(`${baseUrl}/orders/${activeTenantId}/${orderId}/invoice`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!res.ok) return;
        const html = await res.text();
        const blob = new Blob([html], { type: "text/html" });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    };

    if (loading || !data) {
        return <div className="flex justify-center items-center h-[400px]"><div className="w-10 h-10 border-[3px] border-border border-t-primary rounded-full animate-spin" /></div>;
    }

    const filteredOrders = data.orders.filter(o => {
        const matchSearch = !search || o.contactName.toLowerCase().includes(search.toLowerCase()) || o.id.toLowerCase().includes(search.toLowerCase());
        const matchStatus = !statusFilter || o.status === statusFilter;
        return matchSearch && matchStatus;
    });

    return (
        <div>
            <PageHeader
                title={t('title')}
                subtitle={t('subtitle')}
                badge={<DataSourceBadge isLive={isLive} />}
                action={
                    <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-sm cursor-pointer hover:opacity-90 press-effect">
                        <Plus size={16} /> {tc("create")}
                    </button>
                }
            />

            <div className="grid grid-cols-4 gap-4 mb-6">
                {[
                    { label: "Total Revenue (Paid)", value: formatCurrency(data.totalRevenue), icon: DollarSign, color: "#2ecc71", sub: `${data.orders.filter(o => o.status === "paid").length} completed orders` },
                    { label: "Accounts Receivable", value: formatCurrency(data.pendingRevenue), icon: Clock, color: "#ffa502", sub: `${data.pendingCount} pending orders` },
                    { label: "Total Orders", value: data.orderCount, icon: ShoppingCart, color: "#6c5ce7", sub: "Overall history" },
                    { label: "Average Ticket", value: formatCurrency(data.orderCount ? (data.totalRevenue + data.pendingRevenue) / data.orderCount : 0), icon: CreditCard, color: "#00b4d8", sub: "Per transaction" },
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
                            <div className="text-2xl font-semibold">{kpi.value}</div>
                            <div className="text-xs text-muted-foreground mt-1">{kpi.sub}</div>
                        </div>
                    );
                })}
            </div>

            <div className="flex gap-4 mb-5 justify-between">
                <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setStatusFilter(null)} className={cn("px-4 py-2 rounded-[10px] font-semibold text-[13px] cursor-pointer", statusFilter === null ? "border border-primary bg-primary/10 text-primary" : "border border-border bg-transparent text-muted-foreground")}>All ({data.orderCount})</button>
                    {Object.entries(statusConfig).map(([key, config]) => (
                        <button key={key} onClick={() => setStatusFilter(key)} className="px-4 py-2 rounded-[10px] font-medium text-[13px] cursor-pointer flex items-center gap-1.5" style={{ border: statusFilter === key ? `1px solid ${config.color}` : "1px solid var(--border)", background: statusFilter === key ? config.bg : "transparent", color: statusFilter === key ? config.color : undefined }}>
                            <config.icon size={14} /> {config.label} ({data.orders.filter(o => o.status === key).length})
                        </button>
                    ))}
                </div>
                <div className="relative w-[280px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder={tc("search") + "..."} className="w-full py-2.5 pl-9 pr-3.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none box-border" />
                </div>
            </div>

            <div className="bg-card rounded-xl border border-border overflow-hidden">
                <table className="w-full border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-border">
                            {["Order Detail", "Client", "Date", "Amount", "Status", "Quick action"].map(h => (
                                <th key={h} className="px-5 py-3.5 text-left font-semibold text-muted-foreground text-xs uppercase">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filteredOrders.map(order => {
                            const status = statusConfig[order.status];
                            const StatusIcon = status.icon;
                            return (
                                <tr key={order.id} className="border-b border-border">
                                    <td className="px-5 py-4">
                                        <div className="font-mono text-xs text-muted-foreground mb-1">#{order.id.split("-")[0].toUpperCase()}</div>
                                        <div className="text-[13px] font-medium">{order.items.length} item(s)</div>
                                        <div className="text-xs text-muted-foreground mt-0.5">{order.items.slice(0, 2).map(i => `${i.quantity}x ${i.productName}`).join(", ")}{order.items.length > 2 ? ` (+${order.items.length - 2} mas)` : ""}</div>
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center"><User size={16} className="text-muted-foreground" /></div>
                                            <span className="font-semibold">{order.contactName}</span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-4 text-muted-foreground text-[13px]">{formatDate(order.createdAt)}</td>
                                    <td className="px-5 py-4">
                                        <div className="font-semibold text-[15px] text-primary">{formatCurrency(order.totalAmount)}</div>
                                        <div className="text-[11px] text-muted-foreground uppercase">{order.paymentMethod.replace("_", " ")}</div>
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold" style={{ background: status.bg, color: status.color }}>
                                            <StatusIcon size={14} /> {status.label}
                                        </div>
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="flex gap-2 items-center">
                                            <select value={order.status} onChange={(e) => handleUpdateStatus(order.id, e.target.value)} className="px-3 py-1.5 rounded-lg border border-border bg-muted text-foreground text-[13px] cursor-pointer outline-none">
                                                <option value="pending">Pending</option>
                                                <option value="confirmed">Confirmed</option>
                                                <option value="paid">Paid</option>
                                                <option value="cancelled">Cancelled</option>
                                            </select>
                                            <button onClick={() => handleOpenInvoice(order.id)} className="px-3 py-1.5 rounded-lg border border-primary bg-primary/10 text-primary text-[13px] font-semibold cursor-pointer flex items-center gap-1.5">
                                                <FileText size={14} /> View Receipt
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredOrders.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">No orders found</td></tr>}
                    </tbody>
                </table>
            </div>

            {showCreateModal && <CreateOrderModal onClose={() => setShowCreateModal(false)} tenantId={activeTenantId || ""} products={products} contacts={contacts} onCreated={() => { setShowCreateModal(false); window.location.reload(); }} />}
        </div>
    );
}

function CreateOrderModal({ onClose, tenantId, products, contacts, onCreated }: { onClose: () => void; tenantId: string; products: Product[]; contacts: Contact[]; onCreated: () => void }) {
    const tc = useTranslations("common");
    const [status, setStatus] = useState("pending");
    const [paymentMethod, setPaymentMethod] = useState("transfer");
    const [notes, setNotes] = useState("");
    const [contactId, setContactId] = useState("");
    const [selectedItems, setSelectedItems] = useState<{ productId: string; productName: string; quantity: number; unitPrice: number; maxStock: number }[]>([]);
    const [saving, setSaving] = useState(false);

    const handleAddItem = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const id = e.target.value; if (!id) return;
        const prod = products.find(p => p.id === id);
        if (prod && !selectedItems.find(i => i.productId === id)) setSelectedItems([...selectedItems, { productId: prod.id, productName: prod.name, quantity: 1, unitPrice: prod.price, maxStock: prod.stock }]);
    };

    const updateQuantity = (id: string, q: string) => { const qty = parseInt(q); if (isNaN(qty) || qty < 1) return; setSelectedItems(items => items.map(i => i.productId === id ? { ...i, quantity: Math.min(qty, i.maxStock) } : i)); };
    const removeItem = (id: string) => setSelectedItems(items => items.filter(i => i.productId !== id));

    const handleSubmit = async () => {
        if (selectedItems.length === 0) return;
        setSaving(true);
        await api.createOrder(tenantId, { contactId: contactId || undefined, status, paymentMethod, notes, items: selectedItems.map(i => ({ productId: i.productId, productName: i.productName, quantity: i.quantity, unitPrice: i.unitPrice })) });
        onCreated();
    };

    const total = selectedItems.reduce((acc, i) => acc + (i.quantity * i.unitPrice), 0);
    const formatCurrency = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "COP", minimumFractionDigits: 0 }).format(n);

    return (
        <div className="fixed inset-0 bg-black/60 z-[1000] flex items-center justify-center" onClick={onClose}>
            <div onClick={e => e.stopPropagation()} className="bg-card rounded-[20px] border border-border p-7 w-[560px] max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-5">
                    <h2 className="text-xl font-semibold m-0">New Order</h2>
                    <button onClick={onClose} className="bg-transparent border-none cursor-pointer text-muted-foreground"><X size={20} /></button>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-5">
                    <div>
                        <label className="text-[13px] font-semibold block mb-1">Client</label>
                        <select value={contactId} onChange={e => setContactId(e.target.value)} className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none cursor-pointer">
                            <option value="">End consumer</option>
                            {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ""}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-[13px] font-semibold block mb-1">Status</label>
                        <select value={status} onChange={e => setStatus(e.target.value)} className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none cursor-pointer">
                            <option value="pending">Pending payment</option>
                            <option value="confirmed">Confirmed</option>
                            <option value="paid">Paid / Completed</option>
                        </select>
                    </div>
                    <div className="col-span-2">
                        <label className="text-[13px] font-semibold block mb-1">Payment method</label>
                        <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none cursor-pointer">
                            <option value="cash">Cash / COD</option>
                            <option value="transfer">Bank transfer</option>
                            <option value="credit_card">Credit Card</option>
                            <option value="link">Payment Link</option>
                        </select>
                    </div>
                </div>
                <div className="mb-5">
                    <label className="text-[13px] font-semibold block mb-1">Add Products from Inventory</label>
                    <select onChange={handleAddItem} value="" className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none cursor-pointer">
                        <option value="" disabled>Select a product...</option>
                        {products.filter(p => p.stock > 0).map(p => <option key={p.id} value={p.id}>{p.name} — {formatCurrency(p.price)} (Stock: {p.stock} {p.unit})</option>)}
                    </select>
                </div>
                {selectedItems.length > 0 && (
                    <div className="mb-5">
                        <div className="text-[13px] font-semibold mb-2">Added items:</div>
                        <div className="flex flex-col gap-2">
                            {selectedItems.map(item => (
                                <div key={item.productId} className="flex items-center gap-3 bg-muted px-3.5 py-2.5 rounded-[10px] border border-border">
                                    <div className="flex-1"><div className="font-semibold text-sm">{item.productName}</div><div className="text-xs text-muted-foreground">{formatCurrency(item.unitPrice)} ea.</div></div>
                                    <input type="number" value={item.quantity} min={1} max={item.maxStock} onChange={e => updateQuantity(item.productId, e.target.value)} className="w-[60px] px-2 py-1.5 rounded-lg border border-border bg-card text-foreground text-center" />
                                    <div className="font-semibold w-[90px] text-right text-primary">{formatCurrency(item.quantity * item.unitPrice)}</div>
                                    <button onClick={() => removeItem(item.productId)} className="bg-transparent border-none cursor-pointer text-destructive p-1"><X size={16} /></button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <div className="mb-5">
                    <label className="text-[13px] font-semibold block mb-1">Additional notes</label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Special requirements, notes..." className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none box-border resize-none" />
                </div>
                <div className="flex items-center justify-between px-5 py-4 bg-primary/10 rounded-xl mb-5">
                    <span className="font-semibold text-muted-foreground">Order Total:</span>
                    <span className="text-2xl font-semibold text-primary">{formatCurrency(total)}</span>
                </div>
                <button onClick={handleSubmit} disabled={saving || selectedItems.length === 0} className={cn("w-full py-3.5 rounded-xl border-none bg-primary text-white font-semibold text-[15px] cursor-pointer flex items-center justify-center gap-2", (saving || selectedItems.length === 0) && "opacity-50")}>
                    {saving ? tc("saving") : <><Check size={18} /> Create Order</>}
                </button>
            </div>
        </div>
    );
}
