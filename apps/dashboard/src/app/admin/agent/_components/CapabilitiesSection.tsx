"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Calendar, AlertTriangle, CheckCircle, ShoppingBag, HelpCircle,
  Scale, BookOpen, Sliders, Tag, Package, UserCircle,
  Home, Compass, HeartPulse, Building2, Stethoscope,
  UtensilsCrossed, Dumbbell, GraduationCap, ShieldCheck,
  Wrench, Scissors, Camera, Car, Star, Sparkles, Store, Headset, Handshake, Briefcase, CreditCard, ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { api, type TenantPaymentsConfig } from "@/lib/api";
import { resolveAgentToolAvailability } from "@/lib/agent-tool-availability";
import { agentReviewModeCopyKey, withinNamespace, type AgentReviewModeReading } from "@/lib/agent-review-mode";
import type { PersonaConfig } from "../_types";

interface CapabilitiesSectionProps {
  config: PersonaConfig;
  onChange: (updates: Partial<PersonaConfig>) => void;
  apptReadiness: { services: number; slots: number; loaded: boolean };
  /**
   * How a save reaches this agent. The line above the switches said "changes
   * apply when published" to every tenant; in the default mode they apply on
   * Save. Absent reads as unknown, whose sentence is true in both modes.
   */
  reviewMode?: AgentReviewModeReading;
}

type ToolKey = keyof NonNullable<PersonaConfig["tools"]>;

const VERTICAL_TOOLS: { key: ToolKey; icon: any }[] = [
  { key: "properties", icon: Home },
  { key: "tours", icon: Compass },
  { key: "treatments", icon: HeartPulse },
  { key: "realEstate", icon: Building2 },
  { key: "pets", icon: Stethoscope },
  { key: "restaurants", icon: UtensilsCrossed },
  { key: "gyms", icon: Dumbbell },
  { key: "education", icon: GraduationCap },
  { key: "insurance", icon: ShieldCheck },
  { key: "homeServices", icon: Wrench },
  { key: "petServices", icon: Scissors },
  { key: "photography", icon: Camera },
  { key: "professionalServices", icon: Briefcase },
  { key: "vehicles", icon: Car },
  { key: "vehicleRentals", icon: Car },
  { key: "repairOrders", icon: Wrench },
  { key: "petBoarding", icon: Home },
];

/**
 * The toggle below turns green on its own, so an owner whose payment rail is
 * connected-but-not-activated concludes charging works. It does not: the tool
 * stops before reaching the provider whenever no provider is active.
 */
type PaymentRailStatus = "unknown" | "missing" | "pending" | "live";

function paymentRailStatus(cfg: TenantPaymentsConfig | null): PaymentRailStatus {
  if (!cfg) return "unknown";
  const active = cfg.activeProvider || cfg.provider;
  const activeState = active ? cfg.providers?.[active] : undefined;
  // V1 payloads projected the active provider flat, without the providers map.
  const live = !!active && (activeState
    ? activeState.connected === true && activeState.ready === true
    : cfg.connected === true && cfg.ready !== false);
  if (live) return "live";
  // 'pending' has to mean "only the final confirmation is left", because that is
  // literally what its copy promises the owner. Keying it on `connected` alone
  // also caught merchants still missing verification or a callback token, and
  // told them one step remained when several did — the exact miscommunication
  // this warning exists to fix.
  const oneStepLeft = cfg.activationReady === true
    || Object.values(cfg.providers ?? {}).some((item) => item?.activationReady === true);
  return oneStepLeft ? "pending" : "missing";
}

export function CapabilitiesSection({ config, onChange, apptReadiness, reviewMode = "unknown" }: CapabilitiesSectionProps) {
  const tNavigation = useTranslations('agentToolNavigation');
  const tSetup = useTranslations("qualityHealth.setup");
  const t = useTranslations("agent.capabilities");
  const { verticalConfig, isVerticalConfigLoading } = useAuth();
  const { activeTenantId } = useTenant();
  const [planSnapshot, setPlanSnapshot] = useState<{
    tenantId: string;
    features: Record<string, unknown>;
  } | null>(null);
  const planFeatures = planSnapshot?.tenantId === activeTenantId ? planSnapshot.features : null;
  const tools = config.tools || { appointments: { enabled: false, canBook: true, canCancel: true } };
  const apt = tools.appointments || { enabled: false, canBook: true, canCancel: true };
  const payments = tools.payments || { enabled: false, canCreateLinks: true };
  const availability = resolveAgentToolAvailability(
    isVerticalConfigLoading ? null : verticalConfig, tools, planFeatures,
  );
  const customerPaymentsAllowed = availability.payments.canEnable;
  const planLoading = availability.payments.reason === "plan_unknown";
  const [railStatus, setRailStatus] = useState<PaymentRailStatus>("unknown");

  useEffect(() => {
    // Editing requires a fresh entitlement lookup. The navigation snapshot can
    // predate a plan change, and no answer may grant another tenant's tools.
    setPlanSnapshot(null);
    if (!activeTenantId) return;
    let cancelled = false;
    void api.getPlanFeatures(activeTenantId)
      .then((res) => {
        if (cancelled) return;
        if (res?.success && res.data && typeof res.data === "object") {
          setPlanSnapshot({ tenantId: activeTenantId, features: res.data });
        }
      })
      .catch(() => { /* Unknown remains visible; it never grants activation. */ });
    return () => { cancelled = true; };
  }, [activeTenantId]);

  useEffect(() => {
    if (!activeTenantId || !customerPaymentsAllowed) return;
    // Drop the previous tenant's answer before asking about this one: leaving it
    // would show one tenant's rail warning while looking at another's agent.
    setRailStatus("unknown");
    let cancelled = false;
    void api.getTenantPaymentsConfig(activeTenantId)
      .then((res) => {
        if (cancelled) return;
        setRailStatus(paymentRailStatus(res?.success ? (res.data ?? null) : null));
      })
      // Only tenant_admin may read the rail; a supervisor editing the agent must
      // not be shown a warning we could not verify.
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeTenantId, customerPaymentsAllowed]);

  const canEnableAppointments = apptReadiness.loaded && apptReadiness.services > 0 && apptReadiness.slots > 0;
  const missingItems: string[] = [];
  if (apptReadiness.loaded && apptReadiness.services === 0) missingItems.push(t("servicesLabel"));
  if (apptReadiness.loaded && apptReadiness.slots === 0) missingItems.push(t("availabilityScheduleLabel"));
  const toggleBlocked = (!canEnableAppointments || !availability.appointments.canEnable) && !apt.enabled;

  function updateTools(updates: Partial<typeof apt>) {
    onChange({ tools: { ...tools, appointments: { ...apt, ...updates } } });
  }

  function toggleTool(key: ToolKey, value: boolean) {
    if (value && !availability[key]?.canEnable) return;
    onChange({ tools: { ...tools, [key]: { ...(tools[key] as any ?? { enabled: false }), enabled: value } } });
  }

  const sortedVerticalTools = VERTICAL_TOOLS.filter(({ key }) => availability[key]?.visible);

  let statusBadge: React.ReactNode;
  if (apt.enabled && canEnableAppointments && availability.appointments.canEnable) {
    statusBadge = (
      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 text-[11px]">
        {t("ready")}
      </Badge>
    );
  } else if (apt.enabled) {
    statusBadge = (
      <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 text-[11px]">
        {t("setupNeeded")}
      </Badge>
    );
  } else {
    statusBadge = (
      <Badge variant="secondary" className="text-[11px]">{t("disabled")}</Badge>
    );
  }

  const skillset = config.skillset || "both";
  const upsell = config.upsell || { enabled: false, intensity: "subtle" as const };

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">{tNavigation(withinNamespace(agentReviewModeCopyKey('toolEditorScope', reviewMode), 'agentToolNavigation'))}</p>
      {(!verticalConfig || isVerticalConfigLoading || availability.faqs.reason === "profile_unknown") && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{t("toolAvailabilityState.profile_unknown")}</p>
      )}
      {/* ── Skillset (T2.17) ── */}
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center">
            <Sparkles size={18} className="text-indigo-500" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("skillsetTitle")}</h4>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t("skillsetDesc")}</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {([
            { key: "sales", icon: Handshake },
            { key: "support", icon: Headset },
            { key: "both", icon: Sparkles },
          ] as const).map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onChange({ skillset: key })}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                skillset === key
                  ? "border-indigo-400 dark:border-indigo-500/50 bg-indigo-500/[0.05]"
                  : "border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
              )}
            >
              <Icon size={16} className={skillset === key ? "text-indigo-500" : "text-neutral-400"} />
              <div className="text-sm font-medium text-neutral-800 dark:text-neutral-200 mt-1.5">{t(`skillset_${key}`)}</div>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 leading-tight">{t(`skillset_${key}_desc`)}</p>
            </button>
          ))}
        </div>

        {(skillset === "sales" || skillset === "both") && (
          <div className="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-800 space-y-3">
            <label className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-indigo-500" />
                <div>
                  <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{t("upsellTitle")}</span>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("upsellDesc")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onChange({ upsell: { ...upsell, enabled: !upsell.enabled } })}
                className={cn(
                  "relative w-11 h-6 rounded-full transition-colors shrink-0",
                  upsell.enabled ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-600"
                )}
              >
                <div className={cn("absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform", upsell.enabled ? "translate-x-[22px]" : "translate-x-0.5")} />
              </button>
            </label>

            {upsell.enabled && (
              <div className="space-y-3 pl-1">
                <div>
                  <label className="text-xs text-neutral-600 dark:text-neutral-400">{t("upsellIntensity")}</label>
                  <div className="grid grid-cols-3 gap-2 mt-1.5">
                    {(["subtle", "moderate", "aggressive"] as const).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => onChange({ upsell: { ...upsell, intensity: lvl } })}
                        className={cn(
                          "rounded-lg border px-2 py-1.5 text-xs transition-colors",
                          (upsell.intensity || "subtle") === lvl
                            ? "border-indigo-400 dark:border-indigo-500/50 bg-indigo-500/[0.05] text-neutral-800 dark:text-neutral-200"
                            : "border-neutral-200 dark:border-neutral-700 text-neutral-500"
                        )}
                      >
                        {t(`upsell_${lvl}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-neutral-600 dark:text-neutral-400">{t("upsellMaxDiscount")}</label>
                  <input
                    type="number" min={0} max={30}
                    value={upsell.maxDiscountPercent ?? 0}
                    onChange={(e) => onChange({ upsell: { ...upsell, maxDiscountPercent: Math.min(30, Math.max(0, parseInt(e.target.value) || 0)) } })}
                    className="mt-1.5 w-28 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-transparent px-3 py-1.5 text-sm text-neutral-800 dark:text-neutral-200"
                  />
                  <p className="text-[10px] text-neutral-500 mt-1">{t("upsellMaxDiscountHint")}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Appointments ── */}
      {availability.appointments.visible && (
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <Calendar size={18} className="text-indigo-500" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {t("appointmentScheduling")}
                </h4>
                {statusBadge}
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                {t("appointmentDesc")}
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={apt.enabled}
            aria-label={t("appointmentScheduling")}
            data-tool-family="appointments"
            onClick={() => { if (!toggleBlocked) updateTools({ enabled: !apt.enabled }); }}
            disabled={toggleBlocked}
            title={toggleBlocked ? t("configureBeforeActivating", { items: missingItems.join(t("andSeparator")) }) : undefined}
            className={cn(
              "relative w-11 h-6 rounded-full transition-colors shrink-0",
              apt.enabled ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-600",
              toggleBlocked && "opacity-40 cursor-not-allowed"
            )}
          >
            <div className={cn(
              "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
              apt.enabled ? "translate-x-[22px]" : "translate-x-0.5"
            )} />
          </button>
        </div>

        {availability.appointments.reason && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{t(`toolAvailabilityState.${availability.appointments.reason}`)}</p>}
        {availability.appointments.canEnable && !apptReadiness.loaded && <p className="mt-3 text-xs text-neutral-500" role="status">{tSetup("verificationUnavailable")}</p>}
        {availability.appointments.canEnable && apptReadiness.loaded && (
          <div className="flex gap-3 mt-3 text-xs">
            <span className={cn("flex items-center gap-1", apptReadiness.services > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400")}>
              {apptReadiness.services > 0 ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
              {t("services")} ({apptReadiness.services})
            </span>
            <span className={cn("flex items-center gap-1", apptReadiness.slots > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-400")}>
              {apptReadiness.slots > 0 ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
              {t("availability")} ({apptReadiness.slots})
            </span>
          </div>
        )}

        {availability.appointments.canEnable && apptReadiness.loaded && !canEnableAppointments && (
          <div className={cn(
            "flex items-start gap-2 p-3 rounded-lg border mt-3",
            apt.enabled
              ? "bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30"
              : "bg-neutral-50 dark:bg-neutral-800/50 border-neutral-200 dark:border-neutral-700"
          )}>
            <AlertTriangle size={14} className={cn("shrink-0 mt-0.5", apt.enabled ? "text-red-500" : "text-neutral-400")} />
            <div className="flex-1">
              <p className={cn("text-xs font-medium", apt.enabled ? "text-red-700 dark:text-red-300" : "text-neutral-600 dark:text-neutral-300")}>
                {apt.enabled
                  ? t("activeButMissing", { items: missingItems.join(t("andSeparator")) })
                  : t("configureBefore", { items: missingItems.join(t("andSeparator")) })}
              </p>
              <Link href="/admin/appointments" className="inline-block mt-1.5 text-xs font-semibold text-indigo-500 hover:underline">
                {t("goToAppointments")} →
              </Link>
            </div>
          </div>
        )}

        {apt.enabled && availability.appointments.canEnable && (
          <div className="space-y-2.5 border-t border-neutral-100 dark:border-neutral-800 pt-3 mt-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={apt.canBook !== false} onChange={e => updateTools({ canBook: e.target.checked })} className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 text-indigo-500 accent-indigo-500" />
              <div>
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{t("createAppointments")}</span>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("createAppointmentsDesc")}</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={apt.canCancel !== false} onChange={e => updateTools({ canCancel: e.target.checked })} className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 text-indigo-500 accent-indigo-500" />
              <div>
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{t("cancelAppointments")}</span>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("cancelAppointmentsDesc")}</p>
              </div>
            </label>
            <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-neutral-800">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={apt.emailConfirmations !== false}
                  onChange={(e) => updateTools({ emailConfirmations: e.target.checked })}
                  className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 text-indigo-500 accent-indigo-500"
                />
                <div>
                  <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                    {t("sendEmailConfirmation")}
                  </span>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {t("sendEmailConfirmationDesc")}
                  </p>
                </div>
              </label>
              <Link
                href="/admin/settings/email-templates?template=appointment_confirmation_email"
                className="text-xs font-semibold text-indigo-500 hover:underline shrink-0 ml-3"
              >
                {t("editTemplate")}
              </Link>
            </div>
          </div>
        )}
      </div>
      )}

      {/* ── Specialized tools from the tenant subtype contract ── */}
      {sortedVerticalTools.length > 0 && <>
      <div className="pt-1">
        <p className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wide mb-3">
          {t("specializedToolsTitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {sortedVerticalTools.map(({ key, icon }) => {
          const toolAvailability = availability[key];
          // Let's get the email template slug mapping for each key
          const slugMap: Record<ToolKey, string> = {
            properties: "property_booking_confirmation",
            tours: "tour_booking_confirmation",
            treatments: "treatment_booking_confirmation",
            // ── THE EMAIL THAT ACTUALLY GOES, NOT THE ONE THAT WAS SEEDED ──
            //
            // A property visit and a veterinary visit ARE appointments: the
            // consumer resolves the switch through `[family, "appointments"]`
            // and gates the appointment confirmation — which is real, i18n'd
            // and carries the calendar attachment. `realestate_visit_
            // confirmation` and `veterinary_appointment_confirmation` are
            // seeded into every tenant and rendered zero times.
            //
            // Naming them here told the owner their switch governed an email
            // nothing sends. The switch is real; the template named was not.
            realEstate: "appointment_confirmation_email",
            pets: "appointment_confirmation_email",
            restaurants: "restaurant_reservation_confirmation",
            gyms: "gym_class_confirmation",
            education: "education_enrollment_confirmation",
            insurance: "insurance_quote_confirmation",
            homeServices: "homeservice_booking_confirmation",
            // This family only reads the pet-service catalogue and availability.
            // It owns no committing operation, so it has no confirmation policy.
            petServices: "",
            photography: "photography_session_confirmation",
            appointments: "appointment_confirmation_email",
            // Fallbacks if any key doesn't have one
            // professionalServices solo CONSULTA el estado del caso: no crea
            // nada que confirmar por correo.
            professionalServices: "",
            catalog: "",
            faqs: "",
            policies: "",
            knowledge: "",
            offers: "",
            crm: "",
            ecommerce: "",
            payments: "",
            // ── A CONTROL WITH A CONSUMER AND NO WAY TO REACH IT ──────────
            //
            // `""` hid this toggle, and `vehicles.emailConfirmations` is one
            // of the few that genuinely changes behaviour: a test drive is an
            // appointment the `vehicles` family asked for, so the
            // notification resolves through `["vehicles", "appointments"]`,
            // most specific first. The owner could not switch it.
            //
            // That is the mirror of the defect the audit counted — a control
            // with no consumer — and it is the worse one to leave: the code
            // honours a setting the screen never offers.
            vehicles: "appointment_confirmation_email",
            vehicleRentals: "vehicle_rental_confirmation",
            petBoarding: "pet_boarding_confirmation",
            repairOrders: "repair_order_confirmation",
            orders: "order_confirmation"
          };
          const templateSlug = slugMap[key];
          const hasEmailConfirmation = !!templateSlug;

          return (
            <ToolToggleCard
              key={key}
              icon={icon}
              title={t(`vt_${key}_title`)}
              description={t(`vt_${key}_desc`)}
              family={key}
              canEnable={toolAvailability.canEnable}
              blockedReason={toolAvailability.reason ? t(`toolAvailabilityState.${toolAvailability.reason}`) : undefined}
              enabled={(tools[key] as any)?.enabled === true}
              onToggle={(v) => toggleTool(key, v)}
              recommended={toolAvailability.canEnable}
              recommendedLabel={t("recommended")}
              emailConfirmations={hasEmailConfirmation ? (tools[key] as any)?.emailConfirmations : undefined}
              onEmailConfirmationsChange={hasEmailConfirmation && toolAvailability.canEnable ? (v) => {
                onChange({
                  tools: {
                    ...tools,
                    [key]: {
                      ...(tools[key] as any ?? { enabled: false }),
                      emailConfirmations: v
                    }
                  }
                });
              } : undefined}
              templateSlug={templateSlug}
              t={t}
            />
          );
        })}
      </div>
      </>}

      {/* ── Universal tools ── */}
      <div className="pt-3">
        <p className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wide mb-3">
          {t("universalToolsTitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {availability.catalog.visible && <ToolToggleCard icon={ShoppingBag} family="catalog" title={t("catalogTitle")} description={t("catalogDesc")} enabled={tools.catalog?.enabled === true} canEnable={availability.catalog.canEnable} blockedReason={availability.catalog.reason ? t(`toolAvailabilityState.${availability.catalog.reason}`) : undefined} onToggle={(v) => toggleTool("catalog", v)} t={t} />}
        {availability.faqs.visible && <ToolToggleCard icon={HelpCircle} family="faqs" title={t("faqsTitle")} description={t("faqsDesc")} enabled={tools.faqs?.enabled === true} canEnable={availability.faqs.canEnable} blockedReason={availability.faqs.reason ? t(`toolAvailabilityState.${availability.faqs.reason}`) : undefined} onToggle={(v) => toggleTool("faqs", v)} t={t} />}
        <ToolToggleCard icon={Scale} family="policies" title={t("policiesTitle")} description={t("policiesDesc")} enabled={tools.policies?.enabled === true} onToggle={(v) => onChange({ tools: { ...tools, policies: { enabled: v } } })} t={t} />
        <ToolToggleCard icon={Tag} family="offers" title={t("offersTitle")} description={t("offersDesc")} enabled={tools.offers?.enabled === true} onToggle={(v) => onChange({ tools: { ...tools, offers: { enabled: v } } })} t={t} />
        
        {/* Orders supports confirmation emails! */}
        <ToolToggleCard
          icon={Package}
          family="orders"
          title={t("ordersTitle")}
          description={t("ordersDesc")}
          enabled={tools.orders?.enabled === true}
          onToggle={(v) => onChange({ tools: { ...tools, orders: { ...(tools.orders ?? { enabled: false }), enabled: v } } })}
          emailConfirmations={tools.orders?.emailConfirmations}
          onEmailConfirmationsChange={(v) => onChange({ tools: { ...tools, orders: { ...(tools.orders ?? { enabled: false }), emailConfirmations: v } } })}
          templateSlug="order_confirmation"
          t={t}
        />

        <ToolToggleCard icon={UserCircle} family="crm" title={t("crmTitle")} description={t("crmDesc")} enabled={tools.crm?.enabled === true} onToggle={(v) => onChange({ tools: { ...tools, crm: { enabled: v } } })} t={t} />
      </div>

      {/* ── E-commerce sales tools (T2.17) ── */}
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-4 mt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", tools.ecommerce?.enabled ? "bg-indigo-500/15" : "bg-neutral-100 dark:bg-neutral-800")}>
              <Store size={18} className={tools.ecommerce?.enabled ? "text-indigo-500" : "text-neutral-500 dark:text-neutral-400"} />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("ecommerceTitle")}</h4>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t("ecommerceDesc")}</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-label={t("ecommerceTitle")}
            aria-checked={tools.ecommerce?.enabled === true}
            data-tool-family="ecommerce"
            onClick={() => onChange({ tools: { ...tools, ecommerce: { ...(tools.ecommerce ?? { enabled: false }), enabled: !(tools.ecommerce?.enabled) } } })}
            className={cn("relative w-11 h-6 rounded-full transition-colors shrink-0 ml-3", tools.ecommerce?.enabled ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-600")}
          >
            <div className={cn("absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform", tools.ecommerce?.enabled ? "translate-x-[22px]" : "translate-x-0.5")} />
          </button>
        </div>

        {tools.ecommerce?.enabled && (
          <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={tools.ecommerce?.canRecommend !== false}
                onChange={(e) => onChange({ tools: { ...tools, ecommerce: { ...(tools.ecommerce ?? { enabled: true }), canRecommend: e.target.checked } } })}
                className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 text-indigo-500 accent-indigo-500"
              />
              <div>
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{t("ecommerceRecommendations")}</span>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("ecommerceRecommendationsDesc")}</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={tools.ecommerce?.canApplyDiscount === true}
                onChange={(e) => onChange({ tools: { ...tools, ecommerce: { ...(tools.ecommerce ?? { enabled: true }), canApplyDiscount: e.target.checked } } })}
                className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 text-indigo-500 accent-indigo-500"
              />
              <div>
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{t("ecommerceDiscounts")}</span>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("ecommerceDiscountsDesc")}</p>
              </div>
            </label>
          </div>
        )}
      </div>

      {/* Customer payments are independent from a store/catalog. A tenant may
          collect a tour deposit or an enrollment without running e-commerce. */}
      <div className={cn(
        "rounded-lg border p-4 mt-3",
        payments.enabled && customerPaymentsAllowed
          ? "border-indigo-300 dark:border-indigo-500/40 bg-indigo-500/[0.03] dark:bg-indigo-500/5"
          : "border-neutral-200 dark:border-neutral-700"
      )}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
              payments.enabled && customerPaymentsAllowed ? "bg-indigo-500/15" : "bg-neutral-100 dark:bg-neutral-800"
            )}>
              <CreditCard size={18} className={payments.enabled && customerPaymentsAllowed ? "text-indigo-500" : "text-neutral-500 dark:text-neutral-400"} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("paymentsTitle")}</h4>
                {!planLoading && !customerPaymentsAllowed && (
                  <Badge variant="secondary" className="text-[10px]">{t("paymentsPlanBadge")}</Badge>
                )}
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t("paymentsDesc")}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("paymentsTitle")}
            role="switch"
            aria-checked={payments.enabled}
            data-tool-family="payments"
            disabled={!customerPaymentsAllowed && !payments.enabled}
            onClick={() => onChange({
              tools: {
                ...tools,
                payments: {
                  ...payments,
                  enabled: payments.enabled ? false : true,
                  canCreateLinks: payments.canCreateLinks !== false,
                },
              },
            })}
            className={cn(
              "relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed",
              payments.enabled && customerPaymentsAllowed ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-600"
            )}
          >
            <div className={cn(
              "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
              payments.enabled && customerPaymentsAllowed ? "translate-x-[22px]" : "translate-x-0.5"
            )} />
          </button>
        </div>

        {planLoading && <p role="status" className="mt-3 text-xs text-amber-700 dark:text-amber-300">{t("toolAvailabilityState.plan_unknown")}</p>}
        {!planLoading && !customerPaymentsAllowed && (
          <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800 text-xs text-amber-700 dark:text-amber-300">
            <span>{t("paymentsPlanRequired")}</span>{" "}
            <Link href="/admin/settings/billing" className="font-semibold underline underline-offset-2">
              {t("paymentsUpgrade")}
            </Link>
          </div>
        )}

        {payments.enabled && customerPaymentsAllowed && railStatus !== "unknown" && railStatus !== "live" && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {railStatus === "pending" ? t("paymentsRailPending") : t("paymentsRailMissing")}
              </p>
              <Link
                href="/admin/settings/integrations/payments"
                className="inline-block mt-1.5 text-xs font-semibold text-indigo-500 hover:underline"
              >
                {t("paymentsConfigure")} →
              </Link>
            </div>
          </div>
        )}

        {payments.enabled && customerPaymentsAllowed && (
          <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={payments.canCreateLinks === true}
                onChange={(e) => onChange({
                  tools: {
                    ...tools,
                    payments: { ...payments, enabled: true, canCreateLinks: e.target.checked },
                  },
                })}
                className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 text-indigo-500 accent-indigo-500"
              />
              <div>
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{t("paymentsCreateLinks")}</span>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("paymentsCreateLinksDesc")}</p>
              </div>
            </label>
            <Link
              href="/admin/settings/integrations/payments"
              className="inline-flex text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {t("paymentsConfigure")}
            </Link>
          </div>
        )}
      </div>

      {/* ── Knowledge base ── */}
      <div className="pt-3">
        <p className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wide mb-3">
          {t("knowledgeTitle")}
        </p>
      </div>

      <KnowledgeSection config={config} onChange={onChange} t={t} />
    </div>
  );
}

function ToolToggleCard({
  icon: Icon,
  title,
  description,
  enabled,
  onToggle,
  family,
  canEnable = true,
  blockedReason,
  recommended,
  recommendedLabel,
  emailConfirmations,
  onEmailConfirmationsChange,
  templateSlug,
  t,
}: {
  icon: any;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  family?: string;
  canEnable?: boolean;
  blockedReason?: string;
  recommended?: boolean;
  recommendedLabel?: string;
  emailConfirmations?: boolean;
  onEmailConfirmationsChange?: (v: boolean) => void;
  templateSlug?: string;
  t: any;
}) {
  return (
    <div className={cn(
      "rounded-lg border p-4 transition-colors flex flex-col justify-between",
      enabled && canEnable
        ? "border-indigo-300 dark:border-indigo-500/40 bg-indigo-500/[0.03] dark:bg-indigo-500/5"
        : "border-neutral-200 dark:border-neutral-700",
      recommended && !enabled && "border-indigo-200 dark:border-indigo-500/20"
    )}>
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
              enabled ? "bg-indigo-500/15" : "bg-neutral-100 dark:bg-neutral-800"
            )}>
              <Icon size={18} className={enabled ? "text-indigo-500" : "text-neutral-500 dark:text-neutral-400"} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">{title}</h4>
                {recommended && (
                  <Badge className="bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400 text-[10px] shrink-0">
                    <Star size={9} className="mr-0.5" /> {recommendedLabel}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-1">{description}</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-label={title}
            aria-checked={enabled}
            data-tool-family={family}
            disabled={!enabled && !canEnable}
            onClick={() => { if (enabled || canEnable) onToggle(!enabled); }}
            className={cn(
              "relative w-11 h-6 rounded-full transition-colors shrink-0 ml-3",
              enabled ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-600",
            )}
          >
            <div className={cn(
              "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
              enabled ? "translate-x-[22px]" : "translate-x-0.5",
            )} />
          </button>
        </div>
        {blockedReason && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{blockedReason}</p>}
      </div>

      {enabled && onEmailConfirmationsChange && (
        <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={emailConfirmations !== false}
              onChange={(e) => onEmailConfirmationsChange(e.target.checked)}
              className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 text-indigo-500 accent-indigo-500"
            />
            <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
              {t("sendEmailConfirmation")}
            </span>
          </label>
          {templateSlug && (
            <Link
              href={`/admin/settings/email-templates?template=${templateSlug}`}
              className="text-[11px] font-semibold text-indigo-500 hover:underline"
            >
              {t("editTemplate")}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function KnowledgeSection({ config, onChange, t }: { config: PersonaConfig; onChange: (updates: Partial<PersonaConfig>) => void; t: any }) {
  // topK / relevance threshold / "search tool" are tuning knobs, not setup.
  // They live under "Avanzado" so the owner meets the on/off switch first.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const rag = config.rag ?? { enabled: false, chunkSize: 512, chunkOverlap: 50, topK: 5, similarityThreshold: 0.75 };
  const tools: NonNullable<PersonaConfig["tools"]> = config.tools ?? { appointments: { enabled: false, canBook: true, canCancel: true } };
  const kbToolEnabled = tools.knowledge?.enabled === true;

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center">
            <BookOpen size={18} className="text-indigo-500" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t("knowledgeToggleTitle")}</h4>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t("knowledgeToggleDesc")}</p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={rag.enabled}
          aria-label={t("knowledgeToggleTitle")}
          data-rag-control="automatic-retrieval"
          onClick={() => onChange({ rag: { ...rag, enabled: !rag.enabled } })}
          className={cn(
            "relative w-11 h-6 rounded-full transition-colors shrink-0",
            rag.enabled ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-600",
          )}
        >
          <div className={cn(
            "absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
            rag.enabled ? "translate-x-[22px]" : "translate-x-0.5",
          )} />
        </button>
      </div>

      <div className="border-t border-neutral-100 dark:border-neutral-800 pt-3">
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            aria-expanded={advancedOpen}
            className="flex items-center gap-2 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 cursor-pointer bg-transparent border-none p-0 transition-colors"
          >
            <ChevronDown size={14} className={cn("transition-transform", advancedOpen && "rotate-180")} />
            <Sliders size={12} />
            {t("advancedSearch")}
          </button>

          {advancedOpen && (
          <div className="space-y-3 mt-3">
          {rag.enabled && <>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-neutral-600 dark:text-neutral-400">{t("topK")}</label>
              <span className="text-xs font-mono text-neutral-900 dark:text-neutral-100">{rag.topK ?? 5}</span>
            </div>
            <input type="range" min={1} max={10} step={1} value={rag.topK ?? 5} onChange={e => onChange({ rag: { ...rag, topK: parseInt(e.target.value) } })} className="w-full accent-indigo-500" />
            <p className="text-[10px] text-neutral-500 mt-1">{t("topKHint")}</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-neutral-600 dark:text-neutral-400">{t("similarityThreshold")}</label>
              <span className="text-xs font-mono text-neutral-900 dark:text-neutral-100">{(rag.similarityThreshold ?? 0.75).toFixed(2)}</span>
            </div>
            <input type="range" min={0} max={1} step={0.05} value={rag.similarityThreshold ?? 0.75} onChange={e => onChange({ rag: { ...rag, similarityThreshold: parseFloat(e.target.value) } })} className="w-full accent-indigo-500" />
            <p className="text-[10px] text-neutral-500 mt-1">{t("similarityHint")}</p>
          </div>
          </>}

          <label className="flex items-center gap-3 cursor-pointer pt-2 border-t border-neutral-100 dark:border-neutral-800">
            <input type="checkbox" data-tool-family="knowledge" checked={kbToolEnabled} onChange={e => onChange({ tools: { ...tools, knowledge: { enabled: e.target.checked } } })} className="w-4 h-4 rounded border-neutral-300 dark:border-neutral-600 accent-indigo-500" />
            <div>
              <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{t("kbTool")}</span>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{t("kbToolDesc")}</p>
            </div>
          </label>
          </div>
          )}
      </div>
    </div>
  );
}
