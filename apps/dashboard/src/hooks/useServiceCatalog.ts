"use client";

/**
 * El catálogo de servicios/paquetes, sin la agenda.
 *
 * Vivía adentro de la página de Agenda, que es la única pantalla que lo edita.
 * Las verticales que venden paquetes pero NO agendan franjas —fotografía,
 * guardería y hotel de mascotas— no tienen Agenda en su menú: el bootstrap les
 * siembra servicios y después no había ninguna ruta desde la que tocarlos. El
 * CTA de readiness apuntaba a `/admin/appointments/config`, una pantalla que
 * esos tenants no ven.
 *
 * Se extrajo tal cual, sin cambiar comportamiento: la Agenda sigue usando el
 * mismo estado y los mismos handlers, y ahora también los usa el catálogo
 * propio. Duplicarlo habría dejado dos formularios que divergen la primera vez
 * que alguien agrega un campo a uno solo.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { PriceStatus, Service } from "@/components/appointments/shared";
import { readPaymentPolicy } from "@/components/payments/payment-policy-fields";

/** Lo que el dueño puede elegir; `example` solo lo pone el bootstrap. */
/** What the owner can press: confirmed or quote. "example" is what a recipe wrote, never a choice. */
export type EditablePriceStatus = Exclude<PriceStatus, "example">;

export interface ServiceFormState {
    name: string;
    duration: number;
    durationMax: number | null;
    durationType: "fixed" | "flexible" | "open";
    buffer: number;
    price: number;
    /** Guardar siempre lo manda: `confirmed` salvo que el dueño elija `quote`. */
    /** The row's real state while editing: an example stays an example until the owner presses a choice. */
    priceStatus: PriceStatus;
    color: string;
    category: string;
    maxConcurrent: number;
    rebookAfterDays: number | null;
    requiredFields: string[];
    locationType: string;
    locationAddress: string;
    meetingLink: string;
    paymentPolicy: "none" | "full" | "deposit" | "any";
    depositPercent: number | null;
    depositAmount: number | null;
}

const EMPTY_FORM: ServiceFormState = {
    name: "",
    duration: 30,
    durationMax: null,
    durationType: "fixed",
    buffer: 0,
    price: 0,
    priceStatus: "confirmed",
    color: "#6c5ce7",
    category: "",
    maxConcurrent: 1,
    rebookAfterDays: null,
    requiredFields: [],
    locationType: "in_person",
    locationAddress: "",
    meetingLink: "",
    paymentPolicy: "none",
    depositPercent: null,
    depositAmount: null,
};

/** Una fila vieja sin la columna se trata como confirmada: nada cambia de aspecto. */
function readPriceStatus(raw: unknown): PriceStatus {
    return raw === "example" || raw === "quote" ? raw : "confirmed";
}

export interface ServiceCatalogMessages {
    saveError: string;
    deleteError: string;
    updateError: string;
    created: string;
    updated: string;
    deleted: string;
}

export function useServiceCatalog(
    activeTenantId: string | null,
    notify: (message: string) => void,
    messages: ServiceCatalogMessages,
) {
    const [services, setServices] = useState<Service[]>([]);
    const [loadingServices, setLoadingServices] = useState(false);
    const [showServiceModal, setShowServiceModal] = useState(false);
    const [editingService, setEditingService] = useState<Service | null>(null);
    const [serviceForm, setServiceForm] = useState<ServiceFormState>({ ...EMPTY_FORM });
    const [savingService, setSavingService] = useState(false);

    // Los textos y el toast llegan como literales nuevos en cada render. Si
    // entraran a las dependencias, cada handler cambiaría de identidad todo el
    // tiempo y cualquier efecto que dependa de uno se dispararía en bucle.
    const notifyRef = useRef(notify);
    const messagesRef = useRef(messages);
    useEffect(() => {
        notifyRef.current = notify;
        messagesRef.current = messages;
    }, [messages, notify]);

    const loadServices = useCallback(async () => {
        if (!activeTenantId) return;
        setLoadingServices(true);
        try {
            const res = await api.getServices(activeTenantId);
            if (res?.success) {
                // Map API field names to frontend interface
                const mapped = (res.data || []).map((s: any) => ({
                    id: s.id,
                    name: s.name,
                    duration: s.durationMinutes || s.duration || 30,
                    durationMax: s.durationMinutesMax || s.durationMax || null,
                    durationType: s.durationType || s.duration_type || "fixed",
                    buffer: s.bufferMinutes || s.buffer || 0,
                    price: parseFloat(s.price || 0),
                    priceStatus: readPriceStatus(s.priceStatus ?? s.price_status),
                    color: s.color || "#6c5ce7",
                    active: s.isActive ?? s.active ?? true,
                    category: s.category || null,
                    maxConcurrent: s.maxConcurrent || 1,
                    rebookAfterDays: s.rebookAfterDays ?? null,
                    requiredFields: s.requiredFields || [],
                }));
                setServices(mapped);
            }
        } catch {
            /* ignore */
        }
        setLoadingServices(false);
    }, [activeTenantId]);

    const openCreateServiceModal = useCallback(() => {
        setEditingService(null);
        setServiceForm({ ...EMPTY_FORM });
        setShowServiceModal(true);
    }, []);

    const openEditServiceModal = useCallback((svc: Service) => {
        setEditingService(svc);
        setServiceForm({
            name: svc.name,
            duration: svc.duration,
            durationMax: svc.durationMax || null,
            durationType: svc.durationType || "fixed",
            buffer: svc.buffer,
            price: svc.price,
            // "Usar así" nunca confirma un precio: un ejemplo sigue siendo un
            // ejemplo hasta que el dueño pulsa "Precio confirmado" o escribe
            // otro número. Guardar sin tocarlo no decide nada.
            priceStatus: readPriceStatus(svc.priceStatus),
            color: svc.color,
            category: svc.category || "",
            maxConcurrent: svc.maxConcurrent || 1,
            rebookAfterDays: (svc as any).rebookAfterDays ?? null,
            requiredFields: svc.requiredFields || [],
            locationType: (svc as any).locationType || (svc as any).location_type || "in_person",
            locationAddress: (svc as any).locationAddress || (svc as any).location_address || "",
            meetingLink: (svc as any).meetingLink || (svc as any).meeting_link || "",
            // Sin esto, editar un servicio con anticipo lo devolvia a "sin pago".
            ...readPaymentPolicy(svc),
        });
        setShowServiceModal(true);
    }, []);

    const handleSaveService = useCallback(async () => {
        if (!activeTenantId || !serviceForm.name) return;
        setSavingService(true);
        try {
            const payload = {
                ...serviceForm,
                durationMinutesMax: serviceForm.durationMax,
                // An untouched example is not a decision: the server keeps the
                // mark unless the owner pressed a choice or changed the number.
                priceStatus: serviceForm.priceStatus === "example" ? undefined : serviceForm.priceStatus,
            };
            const response: any = editingService
                ? await api.updateService(activeTenantId, editingService.id, payload)
                : await api.createService(activeTenantId, payload);
            if (!response?.success) {
                notifyRef.current(response?.error || messagesRef.current.saveError);
                setSavingService(false);
                return;
            }
            notifyRef.current(editingService ? messagesRef.current.updated : messagesRef.current.created);
            setShowServiceModal(false);
            loadServices();
        } catch {
            notifyRef.current(messagesRef.current.saveError);
        }
        setSavingService(false);
    }, [activeTenantId, editingService, loadServices, serviceForm]);

    const handleDeleteService = useCallback(async (serviceId: string) => {
        if (!activeTenantId) return;
        try {
            await api.deleteService(activeTenantId, serviceId);
            loadServices();
            notifyRef.current(messagesRef.current.deleted);
        } catch {
            notifyRef.current(messagesRef.current.deleteError);
        }
    }, [activeTenantId, loadServices]);

    const handleToggleServiceActive = useCallback(async (svc: Service) => {
        if (!activeTenantId) return;
        try {
            await api.updateService(activeTenantId, svc.id, { active: !svc.active });
            loadServices();
        } catch {
            notifyRef.current(messagesRef.current.updateError);
        }
    }, [activeTenantId, loadServices]);

    /**
     * Confirma el precio de ejemplo tal cual está, o lo pasa a "se cotiza",
     * sin abrir el editor. Se manda solo `priceStatus`: el servidor conserva el
     * número que ya tiene.
     */
    const handleSetServicePriceStatus = useCallback(async (svc: Service, priceStatus: EditablePriceStatus) => {
        if (!activeTenantId) return;
        try {
            const response: any = await api.updateService(activeTenantId, svc.id, { priceStatus });
            if (!response?.success) {
                notifyRef.current(response?.error || messagesRef.current.updateError);
                return;
            }
            notifyRef.current(messagesRef.current.updated);
            loadServices();
        } catch {
            notifyRef.current(messagesRef.current.updateError);
        }
    }, [activeTenantId, loadServices]);

    return {
        services,
        loadingServices,
        showServiceModal,
        setShowServiceModal,
        editingService,
        serviceForm,
        setServiceForm,
        savingService,
        loadServices,
        openCreateServiceModal,
        openEditServiceModal,
        handleSaveService,
        handleDeleteService,
        handleToggleServiceActive,
        handleSetServicePriceStatus,
    };
}
