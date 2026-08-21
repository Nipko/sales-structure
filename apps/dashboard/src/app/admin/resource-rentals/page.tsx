"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertCircle,
  CalendarDays,
  Car,
  Check,
  KeyRound,
  Loader2,
  PawPrint,
  Plus,
  RefreshCw,
  Settings2,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useRole } from "@/hooks/useRole";
import {
  api,
  type CreateResourceRentalInput,
  type ResourceRental,
  type ResourceRentalStatus,
  type ResourceRentalType,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { resolveVerticalDashboard } from "@/lib/vertical-dashboard-resolver";
import { OccupancyStrip } from "./_components/OccupancyStrip";
import { RentalDetailsDialog } from "./_components/RentalDetailsDialog";

const ALL_STATUSES: readonly ResourceRentalStatus[] = [
  "reserved",
  "picked_up",
  "returned",
  "checked_in",
  "checked_out",
  "cancelled",
];

const TERMINAL_STATUSES = new Set<ResourceRentalStatus>([
  "returned",
  "checked_out",
  "cancelled",
]);

const STATUS_STYLES: Record<ResourceRentalStatus, string> = {
  reserved: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  picked_up: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  returned: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  checked_in: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  checked_out: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cancelled: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
};

const NEXT_STATUSES: Record<ResourceRentalType, Partial<Record<ResourceRentalStatus, readonly ResourceRentalStatus[]>>> = {
  vehicle_rental: {
    reserved: ["picked_up", "cancelled"],
    picked_up: ["returned", "cancelled"],
  },
  pet_boarding: {
    reserved: ["checked_in", "cancelled"],
    checked_in: ["checked_out", "cancelled"],
  },
};

interface SelectorOption {
  id: string;
  label: string;
  contactId?: string;
  contactName?: string;
  contactPhone?: string;
}

function dateInputValue(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizedCategory(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export default function ResourceRentalsPage() {
  const t = useTranslations("resourceRentals");
  const locale = useLocale();
  const { activeTenantId } = useTenant();
  const { verticalConfig } = useAuth();
  const { canHandleConversations, canEditPipeline, canManageSettings, isSupervisor } = useRole();
  const [rentalResult, setRentalResult] = useState<{
    tenantId: string | null;
    items: ResourceRental[];
  }>({ tenantId: null, items: [] });
  const [typeFilter, setTypeFilter] = useState<"all" | ResourceRentalType>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ResourceRentalStatus>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [detailsFor, setDetailsFor] = useState<ResourceRental | null>(null);
  const loadRequestId = useRef(0);

  // Never render records fetched for a tenant that is no longer active. The
  // request sequence below also prevents an older filter request from winning
  // a race against the latest selection.
  const rentals = rentalResult.tenantId === (activeTenantId || null)
    ? rentalResult.items
    : [];

  const capabilities = useMemo(
    () => new Set(resolveVerticalDashboard(verticalConfig).capabilities),
    [verticalConfig],
  );
  const supportedTypes = useMemo(() => {
    const types: ResourceRentalType[] = [];
    if (capabilities.has("vehicle_rentals")) types.push("vehicle_rental");
    if (capabilities.has("pet_boarding")) types.push("pet_boarding");
    return types;
  }, [capabilities]);

  const showVehicleConfig = capabilities.has("vehicle_rentals")
    || rentals.some((rental) => rental.rental_type === "vehicle_rental");
  const showPetConfig = capabilities.has("pet_boarding")
    || rentals.some((rental) => rental.rental_type === "pet_boarding");

  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    const tenantId = activeTenantId;
    if (!tenantId) {
      setRentalResult({ tenantId: null, items: [] });
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const response = await api.listResourceRentals(tenantId, {
      type: typeFilter === "all" ? undefined : typeFilter,
      status: statusFilter === "all" ? undefined : statusFilter,
      limit: 500,
    });
    if (requestId !== loadRequestId.current) return;
    if (response.success) {
      setRentalResult({ tenantId, items: response.data || [] });
      setError(null);
    } else {
      setError(response.error || t("errorLoading"));
    }
    setLoading(false);
  }, [activeTenantId, statusFilter, t, typeFilter]);

  useEffect(() => {
    void load();
    return () => {
      loadRequestId.current += 1;
    };
  }, [load]);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );

  function formatDate(value: string): string {
    const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
    if (!year || !month || !day) return t("notAvailable");
    return dateFormatter.format(new Date(year, month - 1, day));
  }

  function availableTransitions(rental: ResourceRental): readonly ResourceRentalStatus[] {
    if (!canHandleConversations) return [];
    const candidates = NEXT_STATUSES[rental.rental_type][rental.status] || [];
    return candidates.filter((status) => isSupervisor || !TERMINAL_STATUSES.has(status));
  }

  async function transition(rental: ResourceRental, status: ResourceRentalStatus) {
    if (!activeTenantId) return;
    if (status === "cancelled" && !window.confirm(t("cancelConfirm"))) return;
    setBusyId(rental.id);
    const response = await api.transitionResourceRental(activeTenantId, rental.id, status);
    if (response.success) {
      setToast(t("transitionSuccess"));
      window.setTimeout(() => setToast(null), 2500);
      await load();
    } else {
      setError(response.error || t("transitionError"));
    }
    setBusyId(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <KeyRound className="h-6 w-6 text-violet-600" />
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("refresh")}
          </button>
          {canHandleConversations && supportedTypes.length > 0 && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-violet-700"
            >
              <Plus className="h-4 w-4" />
              {t("newReservation")}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">{t("filterType")}</span>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
          >
            <option value="all">{t("allTypes")}</option>
            <option value="vehicle_rental">{t("type.vehicle_rental")}</option>
            <option value="pet_boarding">{t("type.pet_boarding")}</option>
          </select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">{t("filterStatus")}</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
          >
            <option value="all">{t("allStatuses")}</option>
            {ALL_STATUSES.map((status) => (
              <option key={status} value={status}>{t(`status.${status}`)}</option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loading && rentals.length === 0 ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : rentals.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <CalendarDays className="mx-auto h-10 w-10 text-muted-foreground/60" />
            <h2 className="mt-3 font-semibold">{t("emptyTitle")}</h2>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">{t("emptyDescription")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("columnType")}</th>
                  <th className="px-4 py-3 font-medium">{t("columnResource")}</th>
                  <th className="px-4 py-3 font-medium">{t("columnContact")}</th>
                  <th className="px-4 py-3 font-medium">{t("columnDates")}</th>
                  <th className="px-4 py-3 font-medium">{t("columnStatus")}</th>
                  <th className="px-4 py-3 text-right font-medium">{t("columnActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rentals.map((rental) => {
                  const RentalIcon = rental.rental_type === "vehicle_rental" ? Car : PawPrint;
                  const transitions = availableTransitions(rental);
                  const contactName = rental.contact_name || rental.customer_name || t("notAvailable");
                  const contactPhone = rental.contact_phone || rental.customer_phone;
                  return (
                    <tr key={rental.id} className="align-top transition hover:bg-muted/20">
                      <td className="px-4 py-4">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          <RentalIcon className="h-4 w-4 text-violet-600" />
                          {t(`type.${rental.rental_type}`)}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-medium">{rental.resource_name || t("notAvailable")}</div>
                        {rental.service_name && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {t("serviceLabel", { service: rental.service_name })}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div>{contactName}</div>
                        {contactPhone && <div className="mt-0.5 text-xs text-muted-foreground">{contactPhone}</div>}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div>{formatDate(rental.start_date)}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {t("until", { date: formatDate(rental.end_date) })}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={cn("inline-flex rounded-full border px-2 py-1 text-xs font-medium", STATUS_STYLES[rental.status])}>
                          {t(`status.${rental.status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap justify-end gap-2">
                          {transitions.map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() => void transition(rental, status)}
                              disabled={busyId === rental.id}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50",
                                status === "cancelled"
                                  ? "border-red-500/30 text-red-700 hover:bg-red-500/10 dark:text-red-300"
                                  : "border-border hover:bg-muted",
                              )}
                            >
                              {busyId === rental.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              {t(`action.${status}`)}
                            </button>
                          ))}
                          {/* Los datos operativos no son una transición de
                              estado: registrar el kilometraje de entrada no
                              cierra el alquiler, y anotar con quién sale al
                              patio el perro no lo cierra tampoco. */}
                          <button
                            type="button"
                            onClick={() => setDetailsFor(rental)}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted"
                          >
                            {t("action.details")}
                          </button>
                          {transitions.length === 0 && (
                            <span className="py-1.5 text-xs text-muted-foreground">{t("noActionsOnlyDetails")}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Una fila por recurso: para saber si el auto 3 está libre el jueves
          había que leer la lista entera y cruzar fechas a mano, y quien arma
          los patios por la mañana necesita exactamente lo contrario de una
          lista. Es la misma vista para los dos rubros porque es el mismo dato. */}
      {rentals.length > 0 && (
        <OccupancyStrip rentals={rentals} onSelect={setDetailsFor} />
      )}

      {detailsFor && activeTenantId && (
        <RentalDetailsDialog
          tenantId={activeTenantId}
          rental={detailsFor}
          onClose={() => setDetailsFor(null)}
          onSaved={() => { void load(); }}
        />
      )}

      {(showVehicleConfig || showPetConfig) && (
        <section className="space-y-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <Settings2 className="h-4 w-4" /> {t("configuration.title")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("configuration.description")}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {showVehicleConfig && (
              <ConfigurationCard
                icon={Car}
                title={t("configuration.vehiclesTitle")}
                description={t("configuration.vehiclesDescription")}
                href={canEditPipeline ? "/admin/vehicles" : undefined}
                action={t("configuration.configureVehicles")}
                restricted={t("configuration.restricted")}
              />
            )}
            {showPetConfig && (
              <ConfigurationCard
                icon={PawPrint}
                title={t("configuration.petsTitle")}
                description={t("configuration.petsDescription")}
                href="/admin/pets"
                action={t("configuration.configurePets")}
                restricted={t("configuration.restricted")}
              />
            )}
            {showPetConfig && (
              <ConfigurationCard
                icon={CalendarDays}
                title={t("configuration.servicesTitle")}
                description={t("configuration.servicesDescription")}
                href={canManageSettings ? "/admin/appointments" : undefined}
                action={t("configuration.configureServices")}
                restricted={t("configuration.restricted")}
              />
            )}
          </div>
        </section>
      )}

      {showCreate && activeTenantId && (
        <CreateRentalDialog
          tenantId={activeTenantId}
          supportedTypes={supportedTypes}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setToast(t("created"));
            window.setTimeout(() => setToast(null), 2500);
            void load();
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[1100] rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function ConfigurationCard({
  icon: Icon,
  title,
  description,
  href,
  action,
  restricted,
}: {
  icon: typeof Car;
  title: string;
  description: string;
  href?: string;
  action: string;
  restricted: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <Icon className="h-5 w-5 text-violet-600" />
      <h3 className="mt-3 font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {href ? (
        <Link href={href} className="mt-3 inline-flex text-sm font-medium text-violet-600 hover:underline">
          {action}
        </Link>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{restricted}</p>
      )}
    </div>
  );
}

function CreateRentalDialog({
  tenantId,
  supportedTypes,
  onClose,
  onCreated,
}: {
  tenantId: string;
  supportedTypes: readonly ResourceRentalType[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations("resourceRentals");
  const tc = useTranslations("common");
  const [type, setType] = useState<ResourceRentalType>(supportedTypes[0] || "vehicle_rental");
  const [vehicles, setVehicles] = useState<SelectorOption[]>([]);
  const [pets, setPets] = useState<SelectorOption[]>([]);
  const [services, setServices] = useState<SelectorOption[]>([]);
  const [contacts, setContacts] = useState<SelectorOption[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [contactId, setContactId] = useState("");
  const [startDate, setStartDate] = useState(dateInputValue(0));
  const [endDate, setEndDate] = useState(dateInputValue(1));
  const [notes, setNotes] = useState("");
  const [resourceSearch, setResourceSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [resourcesHasMore, setResourcesHasMore] = useState(false);
  const [contactsHasMore, setContactsHasMore] = useState(false);
  const [loadingResources, setLoadingResources] = useState(true);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingServices, setLoadingServices] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsReloadKey, setOptionsReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resourceRequestId = useRef(0);
  const contactRequestId = useRef(0);

  const mergeOptions = useCallback((current: SelectorOption[], incoming: SelectorOption[]) => {
    const merged = new Map(current.map((item) => [item.id, item]));
    incoming.forEach((item) => merged.set(item.id, item));
    return Array.from(merged.values());
  }, []);

  const loadContacts = useCallback(async (offset = 0, append = false) => {
    if (!supportedTypes.includes("vehicle_rental")) return;
    const requestId = ++contactRequestId.current;
    setLoadingContacts(true);
    setOptionsError(null);
    try {
      const response = await api.getOrderContacts(tenantId, {
        search: contactSearch.trim() || undefined,
        limit: 50,
        offset,
      });
      if (requestId !== contactRequestId.current) return;
      const page = response.data;
      if (!response.success || !page || !Array.isArray(page.items)) throw new Error("contacts_failed");
      const incoming = page.items.map((contact: Record<string, unknown>) => ({
        id: String(contact.id),
        label: [contact.name, contact.phone].filter(Boolean).join(" · ") || String(contact.id),
        contactName: contact.name ? String(contact.name) : undefined,
        contactPhone: contact.phone ? String(contact.phone) : undefined,
      }));
      setContacts((current) => append ? mergeOptions(current, incoming) : incoming);
      setContactsHasMore(Boolean(page.hasMore));
    } catch {
      if (requestId === contactRequestId.current) setOptionsError(t("create.optionsError"));
    } finally {
      if (requestId === contactRequestId.current) setLoadingContacts(false);
    }
  }, [contactSearch, mergeOptions, supportedTypes, t, tenantId]);

  const loadResources = useCallback(async (offset = 0, append = false) => {
    const requestId = ++resourceRequestId.current;
    setLoadingResources(true);
    setOptionsError(null);
    try {
      const response = type === "vehicle_rental"
        ? await api.listVehicles(tenantId, { status: "available", search: resourceSearch.trim() || undefined, limit: 50, offset })
        : await api.listAllPets(tenantId, { search: resourceSearch.trim() || undefined, limit: 50, offset });
      if (requestId !== resourceRequestId.current) return;
      const page = response.data as { items?: Array<Record<string, unknown>>; hasMore?: boolean; total?: number } | undefined;
      if (!response.success || !page || !Array.isArray(page.items)) throw new Error("resources_failed");
      const incoming = type === "vehicle_rental"
        ? page.items.map((vehicle) => ({
            id: String(vehicle.id),
            label: [vehicle.make, vehicle.model, vehicle.year, vehicle.license_plate].filter(Boolean).join(" · "),
          }))
        : page.items.map((pet) => ({
            id: String(pet.id),
            label: [pet.name, pet.species, pet.contact_name].filter(Boolean).join(" · "),
            contactId: pet.contact_id ? String(pet.contact_id) : undefined,
            contactName: pet.contact_name ? String(pet.contact_name) : undefined,
            contactPhone: pet.contact_phone ? String(pet.contact_phone) : undefined,
          }));
      if (type === "vehicle_rental") setVehicles((current) => append ? mergeOptions(current, incoming) : incoming);
      else setPets((current) => append ? mergeOptions(current, incoming) : incoming);
      const loadedCount = offset + incoming.length;
      setResourcesHasMore(page.hasMore ?? loadedCount < Number(page.total || 0));
    } catch {
      if (requestId === resourceRequestId.current) setOptionsError(t("create.optionsError"));
    } finally {
      if (requestId === resourceRequestId.current) setLoadingResources(false);
    }
  }, [mergeOptions, resourceSearch, t, tenantId, type]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadResources(0, false), 250);
    return () => window.clearTimeout(timer);
  }, [loadResources, optionsReloadKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadContacts(0, false), 250);
    return () => window.clearTimeout(timer);
  }, [loadContacts, optionsReloadKey]);

  useEffect(() => {
    if (!supportedTypes.includes("pet_boarding")) return;
    let active = true;
    setLoadingServices(true);
    api.getServices(tenantId).then((response) => {
      if (!active) return;
      if (!response.success || !Array.isArray(response.data)) throw new Error("services_failed");
      setServices((response.data as Array<Record<string, unknown>>)
        .filter((service) => service.isActive !== false
          && ["hotel", "guarderia"].includes(normalizedCategory(service.category))
          && Number(service.maxConcurrent) >= 1)
        .map((service) => ({
          id: String(service.id),
          label: `${String(service.name)} · ${t("capacity", { count: Number(service.maxConcurrent) })}`,
        })));
    }).catch(() => {
      if (active) setOptionsError(t("create.optionsError"));
    }).finally(() => {
      if (active) setLoadingServices(false);
    });
    return () => { active = false; };
  }, [optionsReloadKey, supportedTypes, t, tenantId]);

  const loadingOptions = loadingResources || loadingContacts || loadingServices;

  function changeType(nextType: ResourceRentalType) {
    setType(nextType);
    setResourceId("");
    setServiceId("");
    setContactId("");
    setResourceSearch("");
    setContactSearch("");
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resourceId || !startDate || !endDate || endDate <= startDate) {
      setError(t("validationError"));
      return;
    }
    if (type === "pet_boarding" && !serviceId) {
      setError(t("serviceRequired"));
      return;
    }
    if (type === "vehicle_rental" && !contactId) {
      setError(t("create.contactRequired"));
      return;
    }
    if (optionsError) return;
    setSaving(true);
    setError(null);
    const selectedPet = pets.find((pet) => pet.id === resourceId);
    const selectedContact = type === "pet_boarding"
      ? selectedPet
      : contacts.find((contact) => contact.id === contactId);
    const payload: CreateResourceRentalInput = {
      type,
      resourceId,
      serviceId: type === "pet_boarding" ? serviceId : undefined,
      contactId: type === "pet_boarding" ? selectedPet?.contactId : contactId,
      customerName: selectedContact?.contactName,
      customerPhone: selectedContact?.contactPhone,
      startDate,
      endDate,
      notes: notes.trim() || undefined,
    };
    const response = await api.createResourceRental(tenantId, payload);
    setSaving(false);
    if (response.success) onCreated();
    else setError(response.error || t("creationError"));
  }

  const resources = type === "vehicle_rental" ? vehicles : pets;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/55 p-4" role="presentation" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-rental-title"
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-background shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 id="create-rental-title" className="font-semibold">{t("create.title")}</h2>
          <button type="button" onClick={onClose} aria-label={t("create.close")} className="rounded-md p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-4">
          {supportedTypes.length > 1 && (
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">{t("create.type")}</span>
              <select value={type} onChange={(event) => changeType(event.target.value as ResourceRentalType)} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                {supportedTypes.map((supportedType) => (
                  <option key={supportedType} value={supportedType}>{t(`type.${supportedType}`)}</option>
                ))}
              </select>
            </label>
          )}

          {loadingOptions && vehicles.length === 0 && pets.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("create.loadingOptions")}
            </div>
          ) : optionsError ? (
            <div role="alert" className="space-y-3 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{optionsError}</span>
              </div>
              <button
                type="button"
                onClick={() => setOptionsReloadKey((current) => current + 1)}
                className="inline-flex items-center gap-2 rounded-md border border-red-500/30 px-3 py-1.5 font-medium hover:bg-red-500/10"
              >
                <RefreshCw className="h-4 w-4" />
                {t("create.retryOptions")}
              </button>
            </div>
          ) : (
            <>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">{type === "vehicle_rental" ? t("create.vehicle") : t("create.pet")}</span>
                <input
                  type="search"
                  value={resourceSearch}
                  onChange={(event) => { setResourceId(""); setResourceSearch(event.target.value); }}
                  placeholder={t("create.searchResources")}
                  aria-label={t("create.searchResources")}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2"
                />
                <select required value={resourceId} onChange={(event) => setResourceId(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                  <option value="">{t("create.selectResource")}</option>
                  {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.label}</option>)}
                </select>
                {resourcesHasMore && (
                  <button type="button" disabled={loadingResources} onClick={() => void loadResources(resources.length, true)} className="text-xs font-medium text-violet-600 underline disabled:opacity-50">
                    {loadingResources ? tc("loading") : tc("loadMore")}
                  </button>
                )}
                {resources.length === 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {type === "vehicle_rental" ? t("create.noVehicles") : t("create.noPets")}
                  </p>
                )}
              </label>

              {type === "pet_boarding" && (
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">{t("create.service")}</span>
                  <select required value={serviceId} onChange={(event) => setServiceId(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                    <option value="">{t("create.selectService")}</option>
                    {services.map((service) => <option key={service.id} value={service.id}>{service.label}</option>)}
                  </select>
                  {services.length === 0 && <p className="text-xs text-amber-700 dark:text-amber-300">{t("create.noServices")}</p>}
                </label>
              )}

              {type === "vehicle_rental" && (
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">{t("create.contact")}</span>
                  <input
                    type="search"
                    value={contactSearch}
                    onChange={(event) => { setContactId(""); setContactSearch(event.target.value); }}
                    placeholder={tc("searchContacts")}
                    aria-label={tc("searchContacts")}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                  />
                  <select required value={contactId} onChange={(event) => setContactId(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                    <option value="">{t("create.selectContact")}</option>
                    {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.label}</option>)}
                  </select>
                  {contactsHasMore && (
                    <button type="button" disabled={loadingContacts} onClick={() => void loadContacts(contacts.length, true)} className="text-xs font-medium text-violet-600 underline disabled:opacity-50">
                      {loadingContacts ? tc("loading") : tc("loadMore")}
                    </button>
                  )}
                  {contacts.length === 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">{t("create.noContacts")}</p>
                  )}
                </label>
              )}
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">{t("create.startDate")}</span>
              <input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">{t("create.endDate")}</span>
              <input required type="date" min={startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>
          </div>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">{t("create.notes")}</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2" />
          </label>
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
              {t("create.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving
                || loadingOptions
                || !!optionsError
                || resources.length === 0
                || (type === "vehicle_rental" && (!contactId || contacts.length === 0))
                || (type === "pet_boarding" && services.length === 0)}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("create.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
