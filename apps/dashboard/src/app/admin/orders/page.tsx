"use client";

import { PageHeader } from "@/components/ui/page-header";
import { HelpPanel } from "@/components/ui/help-panel";
import { SkeletonPage } from "@/components/ui/skeleton-loader";
import { useState, useEffect } from "react";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { DataSourceBadge } from "@/hooks/useApiData";
import { PaginatedContactSelect } from "@/components/ui/paginated-contact-select";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "next-intl";
import { useRole } from "@/hooks/useRole";
import { allowedOrderTransitions, type OrderLifecycleStatus } from "@/lib/order-status-contract";

import { OrderStockEvidenceReview } from '@/components/orders/OrderStockEvidenceReview';
import { currentCatalogReview, type CatalogQuoteReview } from '@/lib/catalog-order-review';
import { formatMoney } from "@/lib/format-money";
import {
    ShoppingCart, Search, Plus, Package, CheckCircle, Clock, XCircle, X, User, Check, FileText,
} from "lucide-react";

interface OrderItem { id: string; productId: string; productName: string; quantity: number; unitPrice: number; totalPrice: number; stockDeducted:number|null; }
interface Order { id: string; version:number; paymentStatus:string; contactId: string; contactName: string; status: "pending" | "confirmed" | "paid" | "cancelled"; totalAmount: number; currency: string; paymentMethod: string; notes: string; createdAt: string; updatedAt: string; items: OrderItem[]; }
interface OrdersOverview { totalRevenue: number; pendingRevenue: number; financialsVisible?: boolean; financialSummaries?:{currency:string;providerPaid:number;manuallyMarkedPaid:number;pending:number}[]; orderCount: number; pendingCount: number; orders: Order[]; }
interface Product { id: string; name: string; price: number; currency:string; stock: number|null; unit: string; isActive?:boolean; }

// El pedido TRAE su moneda y la pantalla la pisaba con COP: mostrar un
// pedido mexicano como pesos colombianos es convertir un importe sin tipo de
// cambio — justo lo que el contrato del agente prohíbe, hecho por la pantalla
// con la que el dueño le cobra al cliente.
const formatCurrency = (n: number, currency?: string | null) => formatMoney(n, currency,{maximumFractionDigits:2});
const formatDate = (s: string) => { try { return new Date(s).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return s; } };

const statusStyle = {
    pending: { color: "#ffa502", bg: "rgba(255,165,2,0.12)", icon: Clock },
    confirmed: { color: "#1f93ff", bg: "rgba(31,147,255,0.12)", icon: Package },
    paid: { color: "#2ecc71", bg: "rgba(46,204,113,0.12)", icon: CheckCircle },
    cancelled: { color: "#ff4757", bg: "rgba(255,71,87,0.12)", icon: XCircle },
} as const;
type OrderStatus = keyof typeof statusStyle;

export default function OrdersPage() {
    const locale=useLocale();
    const t = useTranslations('orders');
    const tHelp = useTranslations("help");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const { canSeeGlobalAnalytics, isAgentOnly,role } = useRole();
    const [data, setData] = useState<OrdersOverview | null>(null);
    const [isLive, setIsLive] = useState(false);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [loading, setLoading] = useState(true);
    const [products, setProducts] = useState<Product[]>([]);
    const [statusError, setStatusError] = useState("");
    const [loadError,setLoadError]=useState(false),[productsError,setProductsError]=useState(false),[reload,setReload]=useState(0);
    const [pendingChange,setPendingChange]=useState<{order:Order;status:string}|null>(null),[changing,setChanging]=useState(false);
    const [stockReview,setStockReview]=useState<Order|null>(null);

    useEffect(() => {
        let active=true;
        async function load() {
            setLoading(true);setLoadError(false);setProductsError(false);setIsLive(false);setPendingChange(null);setShowCreateModal(false);setStockReview(null);
            if (!activeTenantId) { setData(null);setLoadError(true);setLoading(false); return; }
            const [result,inventory]=await Promise.all([api.getOrdersOverview(activeTenantId).catch(()=>null),api.getInventoryProducts(activeTenantId).catch(()=>null)]);
            if(!active)return;
            if(result?.success&&result.data){setData(result.data);setIsLive(true);}else{setData(null);setLoadError(true);}
            if(inventory?.success&&inventory.data){setProducts(inventory.data);}else{setProducts([]);setProductsError(true);}
            setLoading(false);
        }
        void load();return()=>{active=false;};
    }, [activeTenantId,reload]);

    const handleUpdateStatus = async (orderId: string, status: string) => {
        if (!activeTenantId) return;
        const order=data?.orders.find(row=>row.id===orderId);if(!order)return;
        setStatusError("");setChanging(true);
        try {
            const res = await api.updateOrderStatus(activeTenantId, orderId, status,order.version);
            if (!res.success) throw new Error(res.error || "status_update_failed");
            setPendingChange(null);setReload(value=>value+1);
        } catch {
            setStatusError(t("integrity.statusReviewRequired"));setPendingChange(null);setReload(value=>value+1);
        } finally{setChanging(false);}
    };

    const handleOpenInvoice = async (orderId: string) => {
        if (!activeTenantId) return;
        const token = localStorage.getItem("accessToken");
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";
        const res = await fetch(`${baseUrl}/orders/${activeTenantId}/${orderId}/invoice?language=${encodeURIComponent(locale)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!res.ok) return;
        const html = await res.text();
        const blob = new Blob([html], { type: "text/html" });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    };

    if (loading) {
        return <SkeletonPage />;
    }
    if(loadError||!data)return <div role="alert" className="rounded-xl border border-border p-6"><p>{t("integrity.loadError")}</p><button onClick={()=>setReload(value=>value+1)} className="mt-4 rounded-lg bg-primary px-4 py-2 text-white">{t("integrity.retry")}</button></div>;

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
                    <button disabled={productsError} onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium text-sm cursor-pointer hover:opacity-90 press-effect disabled:opacity-50">
                        <Plus size={16} /> {tc("create")}
                    </button>
                }
            />
            {productsError&&<div role="alert" className="mb-4 rounded-lg border border-amber-400 p-4">{t("integrity.productsError")} <button className="underline" onClick={()=>setReload(value=>value+1)}>{t("integrity.retry")}</button></div>}
            <p className="mb-4 text-sm text-muted-foreground">{t("integrity.statusSeparation")}</p>
            <HelpPanel
                title={tHelp("orders.title")}
                description={tHelp("orders.description")}
                tips={tHelp.raw("orders.tips") as string[]}
                mediaKey="orders"
            />

            {statusError && (
                <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                    {statusError}
                </div>
            )}

            {canSeeGlobalAnalytics && data.financialsVisible !== false && <div className="mb-6 space-y-3">
                {(data.financialSummaries||[]).map(summary=><div key={summary.currency} className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-3">
                    <div><span className="text-sm text-muted-foreground">{t("integrity.providerPaid")}</span><p className="text-xl font-semibold">{formatCurrency(summary.providerPaid,summary.currency)}</p></div>
                    <div><span className="text-sm text-muted-foreground">{t("integrity.manualPaid")}</span><p className="text-xl font-semibold">{formatCurrency(summary.manuallyMarkedPaid,summary.currency)}</p></div>
                    <div><span className="text-sm text-muted-foreground">{t("integrity.pendingAmount")}</span><p className="text-xl font-semibold">{formatCurrency(summary.pending,summary.currency)}</p></div>
                </div>)}
                <p className="text-xs text-muted-foreground">{t("integrity.currencySeparation")}</p>
            </div>}

            <div className="flex gap-4 mb-5 justify-between">
                <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setStatusFilter(null)} className={cn("px-4 py-2 rounded-[10px] font-semibold text-[13px] cursor-pointer", statusFilter === null ? "border border-primary bg-primary/10 text-primary" : "border border-border bg-transparent text-muted-foreground")}>{t("all")} ({data.orderCount})</button>
                    {(Object.entries(statusStyle) as [OrderStatus, typeof statusStyle[OrderStatus]][]).map(([key, style]) => {
                        const Icon = style.icon;
                        return (
                            <button key={key} onClick={() => setStatusFilter(key)} className="px-4 py-2 rounded-[10px] font-medium text-[13px] cursor-pointer flex items-center gap-1.5" style={{ border: statusFilter === key ? `1px solid ${style.color}` : "1px solid var(--border)", background: statusFilter === key ? style.bg : "transparent", color: statusFilter === key ? style.color : undefined }}>
                                <Icon size={14} /> {t(`status.${key}`)} ({data.orders.filter(o => o.status === key).length})
                            </button>
                        );
                    })}
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
                            {(["detail", "client", "date", "amount", "status", "quickAction"] as const).map(k => (
                                <th key={k} className="px-5 py-3.5 text-left font-semibold text-muted-foreground text-xs uppercase">{t(`headers.${k}`)}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filteredOrders.map(order => {
                            const style = statusStyle[order.status] || statusStyle.pending;
                            const StatusIcon = style.icon;
                            const transitions = allowedOrderTransitions(order.status as OrderLifecycleStatus, !isAgentOnly);
                            return (
                                <tr key={order.id} className="border-b border-border">
                                    <td className="px-5 py-4">
                                        <div className="font-mono text-xs text-muted-foreground mb-1">#{order.id.split("-")[0].toUpperCase()}</div>
                                        <div className="text-[13px] font-medium">{t("itemCount", { count: order.items.length })}</div>
                                        <div className="text-xs text-muted-foreground mt-0.5">{order.items.slice(0, 2).map(i => `${i.quantity}x ${i.productName}`).join(", ")}{order.items.length > 2 ? ` (+${order.items.length - 2} ${t("moreItems")})` : ""}</div>
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center"><User size={16} className="text-muted-foreground" /></div>
                                            <span className="font-semibold">{order.contactName}</span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-4 text-muted-foreground text-[13px]">{formatDate(order.createdAt)}</td>
                                    <td className="px-5 py-4">
                                        <div className="font-semibold text-[15px] text-primary">{formatCurrency(order.totalAmount, order.currency)}</div>
                                        <div className="text-[11px] text-muted-foreground uppercase">{order.paymentMethod.replace("_", " ")}</div>
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold" style={{ background: style.bg, color: style.color }}>
                                            <StatusIcon size={14} /> {t(Object.hasOwn(statusStyle,order.status)?`status.${order.status}`:"integrity.payment.unknown")}
                                        </div>
                                        <div className="mt-2 text-xs text-muted-foreground">{t("integrity.providerStatus")}: {t(`integrity.payment.${['pending','paid','failed','refunded'].includes(order.paymentStatus)?order.paymentStatus:'unknown'}`)}</div>
                                    </td>
                                    <td className="px-5 py-4">
                                        <div className="flex gap-2 items-center">
                                            {transitions.length > 0 ? (
                                                <select
                                                    key={`${order.id}:${order.status}`}
                                                    defaultValue=""
                                                    aria-label={t("changeStatus", { order: order.id.slice(0, 8) })}
                                                    onChange={(event) => {
                                                        const next = event.currentTarget.value;
                                                        event.currentTarget.value = "";
                                                        if (next) setPendingChange({order,status:next});
                                                    }}
                                                    className="px-3 py-1.5 rounded-lg border border-border bg-muted text-foreground text-[13px] cursor-pointer outline-none"
                                                >
                                                    <option value="" disabled>{t("changeStatusShort")}</option>
                                                    {transitions.map((next) => (
                                                        <option key={next} value={next}>{t(`status.${next}`)}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <span className="px-2 text-xs text-muted-foreground">{t("terminalStatus")}</span>
                                            )}
                                            <button onClick={() => handleOpenInvoice(order.id)} className="px-3 py-1.5 rounded-lg border border-primary bg-primary/10 text-primary text-[13px] font-semibold cursor-pointer flex items-center gap-1.5">
                                                <FileText size={14} /> {t("viewReceipt")}
                                            </button>
                                            {['tenant_admin','tenant_supervisor','super_admin'].includes(role||'')&&['pending','confirmed'].includes(order.status)&&order.items.some(item=>item.stockDeducted===null)&&<button onClick={()=>setStockReview(order)} className="rounded-lg border px-3 py-1.5 text-sm">{t('integrity.stockReview')}</button>}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                        {filteredOrders.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">{t("noOrders")}</td></tr>}
                    </tbody>
                </table>
            </div>

            {stockReview&&<OrderStockEvidenceReview key={`${stockReview.id}:${stockReview.version}`} tenantId={activeTenantId||''} order={stockReview} onClose={()=>setStockReview(null)} onSaved={()=>{setStockReview(null);setReload(value=>value+1);}}/>}
            {pendingChange&&<div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4"><div role="dialog" aria-modal="true" aria-label={t("integrity.reviewChange")} data-tour-form="order-status" className="w-full max-w-lg rounded-xl bg-card p-6">
                <h2 className="text-lg font-semibold">{t("integrity.reviewChange")}</h2><p className="my-3">{pendingChange.order.contactName} · {formatCurrency(pendingChange.order.totalAmount,pendingChange.order.currency)}</p>
                <p>{t(`status.${pendingChange.order.status}`)} → {t(`status.${pendingChange.status}`)}</p><p className="my-4 text-sm text-muted-foreground">{t("integrity.statusSeparation")}</p>
                <div className="flex gap-3"><button disabled={changing} onClick={()=>setPendingChange(null)} className="rounded-lg border px-4 py-2">{tc("cancel")}</button><button disabled={changing} onClick={()=>void handleUpdateStatus(pendingChange.order.id,pendingChange.status)} className="rounded-lg bg-primary px-4 py-2 text-white">{t("integrity.confirmChange")}</button></div>
            </div></div>}
            {showCreateModal && <CreateOrderModal onClose={() => setShowCreateModal(false)} tenantId={activeTenantId || ""} products={products} onCreated={() => { setShowCreateModal(false);setReload(value=>value+1); }} />}
        </div>
    );
}

function CreateOrderModal({ onClose, tenantId, products, onCreated }: { onClose: () => void; tenantId: string; products: Product[]; onCreated: () => void }) {

    const tc = useTranslations("common");
    const t = useTranslations("orders");
    const [status, setStatus] = useState("pending");
    const [paymentMethod, setPaymentMethod] = useState("transfer");
    const [notes, setNotes] = useState("");
    const [contactId, setContactId] = useState("");
    const [selectedItems, setSelectedItems] = useState<{ productId: string; productName: string; quantity: number; unitPrice: number; currency:string; maxStock: number|null }[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [review,setReview]=useState<CatalogQuoteReview|null>(null);
    const [requestKey,setRequestKey]=useState(()=>crypto.randomUUID());
    const payload={contactId:contactId||null,status,paymentMethod,notes,items:selectedItems.map(item=>({productId:item.productId,quantity:item.quantity}))};
    const fingerprint=JSON.stringify(payload),currentReview=currentCatalogReview(review,fingerprint);
    useEffect(()=>{setRequestKey(crypto.randomUUID());},[fingerprint]);

    const handleAddItem = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const id = e.target.value; if (!id) return;
        const prod = products.find(p => p.id === id);
        if (prod && !selectedItems.find(i => i.productId === id)) setSelectedItems([...selectedItems, { productId: prod.id, productName: prod.name, quantity: 1, unitPrice: prod.price,currency:prod.currency, maxStock: prod.stock }]);
    };

    const updateQuantity = (id: string, q: string) => { const qty = Number(q); if (!Number.isInteger(qty) || qty < 1) return; setSelectedItems(items => items.map(i => i.productId === id ? { ...i, quantity: Math.min(qty, i.maxStock??10000) } : i)); };
    const removeItem = (id: string) => setSelectedItems(items => items.filter(i => i.productId !== id));

    const handleSubmit = async () => {
        if (!contactId) {
            setError(t("createModal.contactRequired"));
            return;
        }
        if (selectedItems.length === 0) return;
        setSaving(true);
        setError("");
        if(!currentReview){
            const quoted=await api.quoteOrder(tenantId,payload).catch(()=>null);
            const verified=quoted?.success?currentCatalogReview({...quoted.data,fingerprint},fingerprint):null;
            if(verified)setReview(verified);
            else setError(t("integrity.quoteError"));
            setSaving(false);return;
        }
        const res = await api.createOrder(tenantId, {...payload,idempotencyKey:requestKey,expectedTermsHash:currentReview.termsHash})
            .catch(() => null);
        if (!res?.success) {
            setSaving(false);
            setError(t("createModal.createError"));
            if(res?.error?.includes('catalog_terms_changed')){setReview(null);setError(t("integrity.quoteChanged"));}
            return;
        }
        onCreated();
    };

    const total = selectedItems.reduce((acc, i) => acc + (i.quantity * i.unitPrice), 0);
    // El pedido TRAE su moneda y la pantalla la pisaba con COP: mostrar un
// pedido mexicano como pesos colombianos es convertir un importe sin tipo de
// cambio — justo lo que el contrato del agente prohíbe, hecho por la pantalla
// con la que el dueño le cobra al cliente.
const formatCurrency = (n: number, currency?: string | null) => formatMoney(n, currency,{maximumFractionDigits:2});

    return (
        <div className="fixed inset-0 bg-black/60 z-[1000] flex items-center justify-center p-4" onClick={saving?undefined:onClose}>
            <div role="dialog" aria-modal="true" aria-label={t("createModal.title")} data-tour-form="catalog-order" onClick={e => e.stopPropagation()} className="bg-card rounded-[20px] border border-border p-5 sm:p-7 w-full max-w-[560px] max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-5">
                    <h2 className="text-xl font-semibold m-0">{t("createModal.title")}</h2>
                    <button disabled={saving} aria-label={tc("cancel")} onClick={onClose} className="bg-transparent border-none cursor-pointer text-muted-foreground"><X size={20} /></button>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-5">
                    <div>
                        <label className="text-[13px] font-semibold block mb-1">{t("createModal.client")}</label>
                        <PaginatedContactSelect
                            tenantId={tenantId}
                            value={contactId}
                            onChange={setContactId}
                            required
                            placeholder={t("createModal.selectContact")}
                            className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none"
                        />
                    </div>
                    <div>
                        <label className="text-[13px] font-semibold block mb-1">{t("createModal.status")}</label>
                        <select value={status} onChange={e => setStatus(e.target.value)} className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none cursor-pointer">
                            <option value="pending">{t("createModal.pendingPayment")}</option>
                            <option value="confirmed">{t("status.confirmed")}</option>
                            <option value="paid">{t("integrity.manualPaid")}</option>
                        </select>
                    </div>
                    <div className="col-span-2">
                        <label className="text-[13px] font-semibold block mb-1">{t("createModal.paymentMethod")}</label>
                        <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none cursor-pointer">
                            <option value="cash">{t("paymentMethods.cash")}</option>
                            <option value="transfer">{t("paymentMethods.transfer")}</option>
                            <option value="credit_card">{t("paymentMethods.creditCard")}</option>
                            <option value="link">{t("paymentMethods.link")}</option>
                        </select>
                    </div>
                </div>
                {error && <p className="-mt-3 mb-4 text-xs text-destructive">{error}</p>}
                <div className="mb-5">
                    <label className="text-[13px] font-semibold block mb-1">{t("createModal.addProducts")}</label>
                    <select onChange={handleAddItem} value="" className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none cursor-pointer">
                        <option value="" disabled>{t("createModal.selectProduct")}</option>
                        {products.filter(p => p.isActive!==false&&(p.stock===null||p.stock>0)).map(p => <option key={p.id} value={p.id}>{p.name} — {formatCurrency(p.price, p.currency)} ({t("createModal.stock")}: {p.stock===null?t("integrity.untracked"):p.stock} {p.unit})</option>)}
                    </select>
                </div>
                {selectedItems.length > 0 && (
                    <div className="mb-5">
                        <div className="text-[13px] font-semibold mb-2">{t("createModal.addedItems")}</div>
                        <div className="flex flex-col gap-2">
                            {selectedItems.map(item => (
                                <div key={item.productId} className="flex items-center gap-3 bg-muted px-3.5 py-2.5 rounded-[10px] border border-border">
                                    <div className="flex-1"><div className="font-semibold text-sm">{item.productName}</div><div className="text-xs text-muted-foreground">{formatCurrency(item.unitPrice, item.currency)} {t("createModal.each")}</div></div>
                                    <input aria-label={`${t("integrity.quantity")}: ${item.productName}`} type="number" value={item.quantity} min={1} max={item.maxStock??10000} step={1} onChange={e => updateQuantity(item.productId, e.target.value)} className="w-[60px] px-2 py-1.5 rounded-lg border border-border bg-card text-foreground text-center" />
                                    <div className="font-semibold w-[90px] text-right text-primary">{formatCurrency(item.quantity * item.unitPrice, item.currency)}</div>
                                    <button onClick={() => removeItem(item.productId)} className="bg-transparent border-none cursor-pointer text-destructive p-1"><X size={16} /></button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <div className="mb-5">
                    <label className="text-[13px] font-semibold block mb-1">{t("createModal.additionalNotes")}</label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder={t("createModal.notesPlaceholder")} className="w-full px-3.5 py-2.5 rounded-[10px] border border-border bg-muted text-foreground text-sm outline-none box-border resize-none" />
                </div>
                <div className="flex items-center justify-between px-5 py-4 bg-primary/10 rounded-xl mb-5">
                    <span className="font-semibold text-muted-foreground">{t("createModal.orderTotal")}:</span>
                    <span className="text-xl font-semibold text-primary">{currentReview?formatCurrency(Number(currentReview.terms.totalAmountCents)/100,currentReview.terms.currency):t("integrity.priceNeedsReview")}</span>
                </div>
                {currentReview&&<div role="status" className="mb-4 rounded-lg border border-primary/40 p-4"><h3 className="font-semibold">{t("integrity.currentQuote")}</h3>{currentReview.terms.items.map((item:any)=><p key={item.productId} className="mt-2 text-sm">{item.productName} × {item.quantity} · {formatCurrency(Number(item.unitAmountCents)/100,currentReview.terms.currency)} {t("createModal.each")}</p>)}<p className="mt-3 text-sm text-muted-foreground">{t("integrity.statusSeparation")}</p></div>}
                <button onClick={handleSubmit} disabled={saving || selectedItems.length === 0} className={cn("w-full py-3.5 rounded-xl border-none bg-primary text-white font-semibold text-[15px] cursor-pointer flex items-center justify-center gap-2", (saving || selectedItems.length === 0) && "opacity-50")}>
                    {saving ? tc("saving") : <><Check size={18} /> {t(currentReview?"integrity.confirmCreate":"integrity.reviewPrice")}</>}
                </button>
            </div>
        </div>
    );
}
