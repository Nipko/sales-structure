"use client";

/**
 * Los paquetes y servicios que el negocio vende, sin la agenda.
 *
 * Fotografía, guardería y hotel de mascotas venden paquetes y NO agendan
 * franjas fijas: el bootstrap les siembra servicios y Agenda no aparece en su
 * menú, así que después del alta no había ninguna pantalla desde la que
 * tocarlos. El CTA de readiness —"sembrá tus paquetes"— apuntaba a
 * `/admin/appointments/config`, que esos tenants no ven. La capacidad existía
 * de punta a punta salvo la puerta.
 *
 * Es el MISMO editor de la Agenda (`ServicesTab` + `ServiceModal`) sobre el
 * mismo hook: un segundo formulario habría divergido la primera vez que
 * alguien agregara un campo a uno solo.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Tag } from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { PageHeader } from "@/components/ui/page-header";
import ServicesTab from "@/components/appointments/ServicesTab";
import ServiceModal from "@/components/appointments/ServiceModal";
import { useServiceCatalog } from "@/hooks/useServiceCatalog";

export default function ServiceCatalogPage() {
    const t = useTranslations("serviceCatalog");
    const ta = useTranslations("appointments");
    const { activeTenantId } = useTenant();
    const [toast, setToast] = useState<string | null>(null);

    const {
        services, loadingServices, showServiceModal, setShowServiceModal,
        editingService, serviceForm, setServiceForm, savingService,
        loadServices, openCreateServiceModal, openEditServiceModal,
        handleSaveService, handleDeleteService, handleToggleServiceActive,
    } = useServiceCatalog(
        activeTenantId,
        (message) => { setToast(message); setTimeout(() => setToast(null), 3000); },
        {
            saveError: ta("errors.saveService"),
            deleteError: ta("errors.deleteService"),
            updateError: ta("errors.updateService"),
            created: ta("toasts.serviceCreated"),
            updated: ta("toasts.serviceUpdated"),
            deleted: ta("toasts.serviceDeleted"),
        },
    );

    useEffect(() => { loadServices(); }, [loadServices]);

    return (
        <div className="max-w-[1400px] mx-auto space-y-6">
            <PageHeader
                title={t("title")}
                subtitle={t("subtitle")}
                icon={Tag}
            />

            {/* Un catálogo vacío no es un estado neutro: el agente queda sin
                nada que ofrecer y responde que no hay paquetes. */}
            {!loadingServices && services.length === 0 && (
                <div className="rounded-xl border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
                    <p className="text-sm text-amber-800 dark:text-amber-300">{t("emptyWarning")}</p>
                </div>
            )}

            <ServicesTab
                services={services}
                loading={loadingServices}
                activeTenantId={activeTenantId}
                onCreateService={openCreateServiceModal}
                onEditService={openEditServiceModal}
                onDeleteService={handleDeleteService}
                onToggleActive={handleToggleServiceActive}
            />

            {showServiceModal && (
                <ServiceModal
                    form={serviceForm}
                    onChange={setServiceForm}
                    editingService={editingService}
                    saving={savingService}
                    onSave={handleSaveService}
                    onClose={() => setShowServiceModal(false)}
                />
            )}

            {toast && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm shadow-lg z-50">
                    {toast}
                </div>
            )}
        </div>
    );
}
