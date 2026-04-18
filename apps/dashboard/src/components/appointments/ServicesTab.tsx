"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
    Plus, Pencil, Trash2, Timer, DollarSign, Clock, Search,
    CheckCircle2, XCircle, Tag, Users, ChevronDown, X, UserPlus,
} from "lucide-react";

interface Service {
    id: string;
    name: string;
    duration: number;
    buffer: number;
    price: number;
    color: string;
    active: boolean;
}

interface StaffMember {
    id: string;
    userId: string;
    isPrimary: boolean;
    firstName: string;
    lastName: string;
    email: string;
}

interface ServicesTabProps {
    services: Service[];
    loading: boolean;
    activeTenantId: string | null;
    onCreateService: () => void;
    onEditService: (svc: Service) => void;
    onDeleteService: (id: string) => void;
    onToggleActive: (svc: Service) => void;
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
    return (
        <button onClick={(e) => { e.stopPropagation(); onChange(); }}
            className={cn("w-10 h-[22px] rounded-full relative transition-colors cursor-pointer border-none flex-shrink-0",
                enabled ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-600")}>
            <span className={cn("absolute top-[3px] w-4 h-4 rounded-full bg-white transition-transform shadow-sm",
                enabled ? "left-[22px]" : "left-[3px]")} />
        </button>
    );
}

export default function ServicesTab({
    services, loading, activeTenantId, onCreateService, onEditService, onDeleteService, onToggleActive,
}: ServicesTabProps) {
    const t = useTranslations("appointments");
    const locale = useLocale();
    const numLocale = locale === "pt" ? "pt-BR" : locale === "fr" ? "fr-FR" : locale === "en" ? "en-US" : undefined;
    const [searchQuery, setSearchQuery] = useState("");
    const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("all");
    const [expandedStaff, setExpandedStaff] = useState<string | null>(null);
    const [staffMap, setStaffMap] = useState<Record<string, StaffMember[]>>({});
    const [allUsers, setAllUsers] = useState<any[]>([]);
    const [loadingStaff, setLoadingStaff] = useState(false);

    // Load all users once for assignment dropdown
    useEffect(() => {
        api.getUsers().then(res => {
            if (res.success && Array.isArray(res.data)) {
                setAllUsers(res.data.filter((u: any) => u.isActive));
            }
        }).catch(() => {});
    }, []);

    const loadStaff = useCallback(async (serviceId: string) => {
        if (!activeTenantId) return;
        setLoadingStaff(true);
        try {
            const res = await api.getServiceStaff(activeTenantId, serviceId);
            if (res.success) {
                setStaffMap(prev => ({ ...prev, [serviceId]: res.data || [] }));
            }
        } catch {}
        setLoadingStaff(false);
    }, [activeTenantId]);

    const handleToggleStaff = (serviceId: string) => {
        if (expandedStaff === serviceId) {
            setExpandedStaff(null);
        } else {
            setExpandedStaff(serviceId);
            if (!staffMap[serviceId]) loadStaff(serviceId);
        }
    };

    const handleAssignStaff = async (serviceId: string, userId: string) => {
        if (!activeTenantId) return;
        await api.assignServiceStaff(activeTenantId, serviceId, userId);
        await loadStaff(serviceId);
    };

    const handleRemoveStaff = async (serviceId: string, userId: string) => {
        if (!activeTenantId) return;
        await api.removeServiceStaff(activeTenantId, serviceId, userId);
        await loadStaff(serviceId);
    };

    const filtered = useMemo(() => {
        let list = [...services];
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            list = list.filter(s => s.name.toLowerCase().includes(q));
        }
        if (filterActive === "active") list = list.filter(s => s.active);
        if (filterActive === "inactive") list = list.filter(s => !s.active);
        return list;
    }, [services, searchQuery, filterActive]);

    const activeCount = services.filter(s => s.active).length;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-lg font-semibold text-foreground">{t("servicesSection.title")}</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {t("servicesSection.subtitle")}
                        {services.length > 0 && (
                            <span className="ml-2 text-xs">
                                ({activeCount} {t("servicesSection.active").toLowerCase()} / {services.length} total)
                            </span>
                        )}
                    </p>
                </div>
                <button onClick={onCreateService}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-500 text-white font-semibold text-sm cursor-pointer hover:bg-indigo-600 transition-colors border-none shadow-sm">
                    <Plus size={16} /> {t("servicesSection.newService")}
                </button>
            </div>

            {/* Search + Filter (only when services exist) */}
            {services.length > 0 && (
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder={t("searchAppointments")}
                            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        />
                    </div>
                    <div className="flex gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl">
                        {(["all", "active", "inactive"] as const).map(f => (
                            <button key={f} onClick={() => setFilterActive(f)}
                                className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer border-none",
                                    filterActive === f
                                        ? "bg-white dark:bg-neutral-900 text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground bg-transparent")}>
                                {f === "all" ? t("servicesSection.all") : f === "active" ? t("servicesSection.active") : t("servicesSection.inactive")}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Empty state */}
            {services.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                    <div className="w-16 h-16 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
                        <Tag size={28} className="text-neutral-400" />
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">{t("servicesSection.noServices")}</p>
                    <button onClick={onCreateService}
                        className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-500 text-white text-sm font-medium cursor-pointer border-none hover:bg-indigo-600">
                        <Plus size={16} /> {t("servicesSection.newService")}
                    </button>
                </div>
            )}

            {/* Service cards */}
            {filtered.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filtered.map(svc => (
                        <div key={svc.id}
                            className={cn(
                                "relative rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 overflow-hidden hover:shadow-lg transition-all group",
                                !svc.active && "opacity-60"
                            )}>
                            {/* Color top bar */}
                            <div className="h-1.5" style={{ backgroundColor: svc.color }} />

                            <div className="p-5">
                                {/* Header: name + toggle */}
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: svc.color }} />
                                        <h3 className="font-semibold text-foreground text-base truncate">{svc.name}</h3>
                                    </div>
                                    <Toggle enabled={svc.active} onChange={() => onToggleActive(svc)} />
                                </div>

                                {/* Status badge */}
                                <div className="mb-3">
                                    {svc.active ? (
                                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                            <CheckCircle2 size={12} /> {t("servicesSection.active")}
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-400">
                                            <XCircle size={12} /> {t("servicesSection.inactive")}
                                        </span>
                                    )}
                                </div>

                                {/* Info badges */}
                                <div className="flex flex-wrap gap-2 mb-4">
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-800 text-muted-foreground text-xs font-medium">
                                        <Timer size={12} /> {svc.duration} {t("minutes")}
                                    </span>
                                    {svc.buffer > 0 && (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-800 text-muted-foreground text-xs font-medium">
                                            <Clock size={12} /> +{svc.buffer} min
                                        </span>
                                    )}
                                    {svc.price > 0 && (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-800 text-muted-foreground text-xs font-medium">
                                            <DollarSign size={12} /> ${svc.price.toLocaleString(numLocale)}
                                        </span>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 pt-3 border-t border-neutral-100 dark:border-neutral-800">
                                    <button onClick={() => onEditService(svc)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer border-none bg-transparent">
                                        <Pencil size={13} /> {t("editAppointment").split(" ")[0]}
                                    </button>
                                    <button onClick={() => handleToggleStaff(svc.id)}
                                        className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer border-none bg-transparent",
                                            expandedStaff === svc.id
                                                ? "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10"
                                                : "text-muted-foreground hover:text-foreground hover:bg-neutral-100 dark:hover:bg-neutral-800"
                                        )}>
                                        <Users size={13} /> Staff
                                        <ChevronDown size={12} className={cn("transition-transform", expandedStaff === svc.id && "rotate-180")} />
                                    </button>
                                    <button onClick={() => { if (confirm(t('servicesSection.confirmDelete'))) onDeleteService(svc.id); }}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer border-none bg-transparent ml-auto">
                                        <Trash2 size={13} />
                                    </button>
                                </div>

                                {/* Staff panel */}
                                {expandedStaff === svc.id && (
                                    <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800 space-y-2">
                                        {loadingStaff ? (
                                            <div className="text-xs text-muted-foreground text-center py-2">Loading...</div>
                                        ) : (
                                            <>
                                                {(staffMap[svc.id] || []).map(staff => (
                                                    <div key={staff.userId} className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-800">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                                                                {(staff.firstName?.[0] || '').toUpperCase()}
                                                            </div>
                                                            <span className="text-xs font-medium text-foreground">
                                                                {staff.firstName} {staff.lastName}
                                                            </span>
                                                            {staff.isPrimary && (
                                                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-semibold">
                                                                    Primary
                                                                </span>
                                                            )}
                                                        </div>
                                                        <button
                                                            onClick={() => handleRemoveStaff(svc.id, staff.userId)}
                                                            className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-500/10 text-red-400 hover:text-red-500 cursor-pointer border-none bg-transparent"
                                                        >
                                                            <X size={12} />
                                                        </button>
                                                    </div>
                                                ))}

                                                {/* Add staff dropdown */}
                                                {(() => {
                                                    const assignedIds = new Set((staffMap[svc.id] || []).map(s => s.userId));
                                                    const available = allUsers.filter(u => !assignedIds.has(u.id));
                                                    if (available.length === 0) return null;
                                                    return (
                                                        <select
                                                            onChange={e => { if (e.target.value) { handleAssignStaff(svc.id, e.target.value); e.target.value = ''; } }}
                                                            defaultValue=""
                                                            className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-neutral-900 border border-dashed border-neutral-300 dark:border-neutral-700 text-xs text-muted-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
                                                        >
                                                            <option value="">
                                                                + Add staff member...
                                                            </option>
                                                            {available.map(u => (
                                                                <option key={u.id} value={u.id}>
                                                                    {u.firstName || u.email} {u.lastName || ''}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    );
                                                })()}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* No results from filter */}
            {services.length > 0 && filtered.length === 0 && (
                <div className="text-center py-10">
                    <p className="text-sm text-muted-foreground">{t("noAppointments")}</p>
                </div>
            )}
        </div>
    );
}
