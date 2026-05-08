"use client";

/**
 * Food orders kanban for restaurant tenants. Columns map to the order
 * lifecycle: received → preparing → ready → delivered. Each card shows
 * customer + items + total and lets the operator advance to the next
 * state with one click. Auto-refreshes every 15s so the kitchen can
 * leave the screen open during service.
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    ChefHat, RefreshCw, Loader2, Clock, MapPin, Phone, ChevronRight,
    UtensilsCrossed, Bike, Store, X, AlertCircle, Truck, Check,
} from "lucide-react";

interface OrderItem {
    id: string;
    name_snapshot: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    special_instructions?: string;
    modifiers?: any[];
}

interface FoodOrder {
    id: string;
    order_type: "delivery" | "pickup" | "dine_in";
    customer_name?: string;
    customer_phone?: string;
    delivery_address?: string;
    delivery_notes?: string;
    table_number?: string;
    subtotal: number;
    delivery_fee: number;
    discount: number;
    total: number;
    currency: string;
    payment_method?: string;
    payment_status: string;
    status: "received" | "preparing" | "ready" | "delivered" | "cancelled";
    notes?: string;
    created_at: string;
    items?: OrderItem[];
}

const STATUS_FLOW = ["received", "preparing", "ready", "delivered"] as const;
const STATUS_STYLE: Record<string, { bg: string; text: string; ring: string }> = {
    received:  { bg: "bg-blue-500/10",    text: "text-blue-700 dark:text-blue-300",       ring: "ring-blue-500/30" },
    preparing: { bg: "bg-amber-500/10",   text: "text-amber-700 dark:text-amber-300",     ring: "ring-amber-500/30" },
    ready:     { bg: "bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-300", ring: "ring-emerald-500/30" },
    delivered: { bg: "bg-neutral-500/10", text: "text-neutral-600 dark:text-neutral-400", ring: "ring-neutral-500/30" },
    cancelled: { bg: "bg-red-500/10",     text: "text-red-700 dark:text-red-300",         ring: "ring-red-500/30" },
};

const ORDER_TYPE_ICON: Record<string, any> = {
    delivery: Bike,
    pickup: Store,
    dine_in: UtensilsCrossed,
};

export default function FoodOrdersPage() {
    const t = useTranslations("foodOrders");
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();

    const [orders, setOrders] = useState<FoodOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<FoodOrder | null>(null);
    const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!activeTenantId) return;
        try {
            // Limit to last 200 to keep the kanban responsive during peak hours
            const res = await api.listFoodOrders(activeTenantId, { limit: 200 });
            if (res.success) {
                setOrders(res.data || []);
                setError(null);
            }
        } catch (e: any) {
            setError(e?.message || tc("connectionError"));
        } finally {
            setLoading(false);
        }
    }, [activeTenantId, tc]);

    useEffect(() => {
        load();
        const id = setInterval(load, 15000);
        return () => clearInterval(id);
    }, [load]);

    async function handleAdvance(order: FoodOrder) {
        if (!activeTenantId) return;
        const idx = STATUS_FLOW.indexOf(order.status as any);
        if (idx === -1 || idx === STATUS_FLOW.length - 1) return;
        const nextStatus = STATUS_FLOW[idx + 1];
        setBusyOrderId(order.id);
        try {
            await api.updateFoodOrderStatus(activeTenantId, order.id, nextStatus);
            load();
        } finally {
            setBusyOrderId(null);
        }
    }

    async function handleCancel(order: FoodOrder) {
        if (!activeTenantId) return;
        if (!confirm(t("cancelConfirm"))) return;
        setBusyOrderId(order.id);
        try {
            await api.updateFoodOrderStatus(activeTenantId, order.id, "cancelled");
            load();
        } finally {
            setBusyOrderId(null);
        }
    }

    async function openDetail(order: FoodOrder) {
        if (!activeTenantId) return;
        const res = await api.getFoodOrder(activeTenantId, order.id);
        if (res.success) setSelectedOrder(res.data);
    }

    const ordersByStatus: Record<string, FoodOrder[]> = {
        received: [], preparing: [], ready: [], delivered: [],
    };
    for (const o of orders) {
        if (ordersByStatus[o.status]) ordersByStatus[o.status].push(o);
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold flex items-center gap-2">
                        <ChefHat className="h-6 w-6 text-orange-500" />
                        {t("title")}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground rounded-lg text-sm transition disabled:opacity-50"
                >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    {tc("refresh")}
                </button>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {STATUS_FLOW.map(status => (
                    <div key={status} className="bg-card border border-border rounded-xl flex flex-col min-h-[400px]">
                        <div className={cn(
                            "p-3 border-b border-border flex items-center justify-between",
                            STATUS_STYLE[status].bg,
                        )}>
                            <span className={cn("text-sm font-semibold", STATUS_STYLE[status].text)}>
                                {t(`status.${status}` as any)}
                            </span>
                            <span className={cn("text-xs font-mono", STATUS_STYLE[status].text)}>
                                {ordersByStatus[status]?.length || 0}
                            </span>
                        </div>
                        <div className="p-2 flex-1 space-y-2 overflow-y-auto max-h-[600px]">
                            {ordersByStatus[status]?.length === 0 ? (
                                <div className="p-4 text-center text-xs text-muted-foreground italic">
                                    {t("emptyColumn")}
                                </div>
                            ) : ordersByStatus[status]?.map(order => {
                                const TypeIcon = ORDER_TYPE_ICON[order.order_type] || UtensilsCrossed;
                                const ageMin = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
                                const stale = status !== "delivered" && ageMin > 30;
                                return (
                                    <div
                                        key={order.id}
                                        onClick={() => openDetail(order)}
                                        className={cn(
                                            "bg-background border border-border rounded-lg p-3 cursor-pointer hover:border-orange-300 transition",
                                            stale && "ring-1 ring-amber-500/40",
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <TypeIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                                <span className="font-mono text-xs text-muted-foreground truncate">#{order.id.slice(0, 8)}</span>
                                            </div>
                                            <span className={cn(
                                                "text-[10px] font-mono",
                                                stale ? "text-amber-600 font-semibold" : "text-muted-foreground",
                                            )}>
                                                {ageMin}m
                                            </span>
                                        </div>
                                        <div className="text-sm font-medium truncate">{order.customer_name || t("noName")}</div>
                                        <div className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                                            {order.order_type === "delivery" && order.delivery_address && (
                                                <><MapPin className="h-3 w-3" />{order.delivery_address}</>
                                            )}
                                            {order.order_type === "dine_in" && order.table_number && (
                                                <>{t("table")} {order.table_number}</>
                                            )}
                                        </div>
                                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                                            <span className="text-sm font-bold font-mono">
                                                {Number(order.total).toLocaleString()} {order.currency}
                                            </span>
                                            {status !== "delivered" && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleAdvance(order); }}
                                                    disabled={busyOrderId === order.id}
                                                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-orange-600 hover:bg-orange-700 text-white rounded font-medium disabled:opacity-50"
                                                    title={t(`advanceTo.${STATUS_FLOW[STATUS_FLOW.indexOf(status as any) + 1]}` as any)}
                                                >
                                                    {busyOrderId === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronRight className="h-3 w-3" />}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {selectedOrder && (
                <OrderDetailModal
                    order={selectedOrder}
                    onClose={() => setSelectedOrder(null)}
                    onCancel={async () => {
                        await handleCancel(selectedOrder);
                        setSelectedOrder(null);
                    }}
                />
            )}
        </div>
    );
}

function OrderDetailModal({
    order, onClose, onCancel,
}: { order: FoodOrder; onClose: () => void; onCancel: () => void }) {
    const t = useTranslations("foodOrders");
    const tc = useTranslations("common");

    return (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-5 border-b border-border">
                    <div>
                        <h3 className="text-base font-semibold">
                            <span className="font-mono text-xs text-muted-foreground">#{order.id.slice(0, 8)}</span> · {t(`status.${order.status}` as any)}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{new Date(order.created_at).toLocaleString()}</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="h-4 w-4" /></button>
                </div>

                <div className="p-5 space-y-4">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        {order.customer_name && (
                            <div>
                                <div className="text-xs text-muted-foreground">{t("customer")}</div>
                                <div className="font-medium">{order.customer_name}</div>
                            </div>
                        )}
                        {order.customer_phone && (
                            <div>
                                <div className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" />{tc("phone") || "Phone"}</div>
                                <div className="font-mono">{order.customer_phone}</div>
                            </div>
                        )}
                    </div>

                    {order.order_type === "delivery" && order.delivery_address && (
                        <div className="bg-muted/30 rounded-lg p-3 text-sm">
                            <div className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                                <Truck className="h-3 w-3" />
                                {t("deliveryAddress")}
                            </div>
                            <div>{order.delivery_address}</div>
                            {order.delivery_notes && (
                                <div className="text-xs text-muted-foreground mt-1 italic">{order.delivery_notes}</div>
                            )}
                        </div>
                    )}

                    {order.order_type === "dine_in" && order.table_number && (
                        <div className="bg-muted/30 rounded-lg p-3 text-sm">
                            {t("table")}: <strong>{order.table_number}</strong>
                        </div>
                    )}

                    <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{t("items")}</div>
                        <div className="space-y-1.5">
                            {(order.items || []).map(item => (
                                <div key={item.id} className="flex items-start justify-between gap-3 text-sm border-b border-border/50 pb-1.5 last:border-0">
                                    <div className="flex-1 min-w-0">
                                        <div>
                                            <span className="font-medium">{item.quantity}×</span> {item.name_snapshot}
                                        </div>
                                        {item.special_instructions && (
                                            <div className="text-xs text-amber-600 italic flex items-center gap-1 mt-0.5">
                                                <AlertCircle className="h-3 w-3" />
                                                {item.special_instructions}
                                            </div>
                                        )}
                                    </div>
                                    <div className="font-mono text-sm">
                                        {Number(item.subtotal).toLocaleString()} {order.currency}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="border-t border-border pt-3 space-y-1 text-sm font-mono">
                        <div className="flex justify-between text-muted-foreground">
                            <span>{t("subtotal")}</span><span>{Number(order.subtotal).toLocaleString()}</span>
                        </div>
                        {Number(order.delivery_fee) > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                                <span>{t("deliveryFee")}</span><span>+ {Number(order.delivery_fee).toLocaleString()}</span>
                            </div>
                        )}
                        {Number(order.discount) > 0 && (
                            <div className="flex justify-between text-emerald-600">
                                <span>{t("discount")}</span><span>- {Number(order.discount).toLocaleString()}</span>
                            </div>
                        )}
                        <div className="flex justify-between font-bold text-base border-t border-border pt-1">
                            <span>{t("total")}</span><span>{Number(order.total).toLocaleString()} {order.currency}</span>
                        </div>
                    </div>

                    {order.payment_method && (
                        <div className="text-xs text-muted-foreground">
                            {t("payment")}: <span className="font-mono">{order.payment_method}</span> · {order.payment_status}
                        </div>
                    )}
                </div>

                {order.status !== "delivered" && order.status !== "cancelled" && (
                    <div className="flex justify-end gap-2 p-4 border-t border-border">
                        <button
                            onClick={onCancel}
                            className="px-3 py-1.5 hover:bg-red-500/10 text-red-600 rounded-lg text-sm font-medium"
                        >
                            {t("cancelOrder")}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
