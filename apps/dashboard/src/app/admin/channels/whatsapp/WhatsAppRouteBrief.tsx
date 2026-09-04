"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle, Shield, X, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { guidedTourAnchorId } from "@/lib/guided-tours";
import { whatsAppRouteKey, type WhatsAppConnectRoute } from "./whatsapp-connect-routes";

/**
 * What the chosen route actually involves — steps, requirements and the
 * warnings that only bite AFTER the Meta window closes (the 24 h window to
 * authorise history, the two-step PIN that must be off before migrating).
 *
 * This block used to exist only on `/admin/channels/whatsapp`. The wizard,
 * which is where a new owner actually connects, went straight from a one-line
 * route description to the blue button — so the person learned about the 24 h
 * window when it had already closed. Same component, both places, always before
 * the button.
 */
export default function WhatsAppRouteBrief({
    route,
    compact = false,
}: {
    route: WhatsAppConnectRoute;
    /** The wizard renders inside a narrow column; the page has a full card. */
    compact?: boolean;
}) {
    const tw = useTranslations("channels.whatsapp");
    const tb = useTranslations("channels.whatsapp.brief");
    const steps = Array.from({ length: route.stepCount }, (_, i) => i + 1);
    const requirements = Array.from({ length: route.requirementCount }, (_, i) => i + 1);
    const pad = compact ? "p-4" : "p-6";

    return (
        <div
            id={guidedTourAnchorId("whatsapp-brief")}
            className={cn(
                "rounded-xl border border-border bg-[var(--bg-secondary)] overflow-hidden",
                compact && "text-[13px]",
            )}
        >
            <div className={cn(pad, "border-b border-border")}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    {tb("title")}
                </p>
                <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                    {tw(whatsAppRouteKey(route, "Overview"))}
                </p>
            </div>

            {route.detail === "sync" && (
                <>
                    <div className={cn(pad, "border-b border-border")}>
                        <h3 className="text-sm font-semibold mb-4">{tw("routeCoexSyncTitle")}</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            <div>
                                <p className="text-[11px] font-semibold text-[#2ecc71] mb-2.5 uppercase tracking-wider">{tw("syncYes")}</p>
                                <div className="flex flex-col gap-2">
                                    {[1, 2, 3, 4].map((i) => (
                                        <div key={i} className="flex items-start gap-2 text-[12px] text-[var(--text-secondary)]">
                                            <CheckCircle size={13} className="text-[#2ecc71] shrink-0 mt-0.5" />
                                            <span>{tw(`routeCoexSyncYes${i}`)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <p className="text-[11px] font-semibold text-[#e74c3c] mb-2.5 uppercase tracking-wider">{tw("syncNo")}</p>
                                <div className="flex flex-col gap-2">
                                    {[1, 2, 3, 4].map((i) => (
                                        <div key={i} className="flex items-start gap-2 text-[12px] text-[var(--text-secondary)]">
                                            <X size={13} className="text-[#e74c3c] shrink-0 mt-0.5" />
                                            <span>{tw(`routeCoexSyncNo${i}`)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className={cn(pad, "border-b border-border")}>
                        <h3 className="text-sm font-semibold mb-3">{tw("routeCoexLimitTitle")}</h3>
                        <div className="flex flex-col gap-2.5">
                            {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="flex items-start gap-2.5 text-[12px] text-[var(--text-secondary)]">
                                    <Info size={13} className="text-amber-500 shrink-0 mt-0.5" />
                                    <span>{tw(`routeCoexLimit${i}`)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {route.detail === "preservedLost" && (
                <div className={cn(pad, "border-b border-border")}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div>
                            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                <CheckCircle size={14} className="text-[#2ecc71]" />
                                {tw("routeMigPreservedTitle")}
                            </h3>
                            <div className="flex flex-col gap-2">
                                {[1, 2, 3, 4, 5].map((i) => (
                                    <div key={i} className="flex items-start gap-2 text-[12px] text-[var(--text-secondary)]">
                                        <CheckCircle size={13} className="text-[#2ecc71] shrink-0 mt-0.5" />
                                        <span>{tw(`routeMigPreserved${i}`)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                <XCircle size={14} className="text-[#e74c3c]" />
                                {tw("routeMigLostTitle")}
                            </h3>
                            <div className="flex flex-col gap-2">
                                {[1, 2, 3, 4].map((i) => (
                                    <div key={i} className="flex items-start gap-2 text-[12px] text-[var(--text-secondary)]">
                                        <X size={13} className="text-[#e74c3c] shrink-0 mt-0.5" />
                                        <span>{tw(`routeMigLost${i}`)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className={cn(pad, "border-b border-border")}>
                <h3 className="text-sm font-semibold mb-3">{tw("stepsTitle")}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {steps.map((i) => (
                        <div key={i} className="flex items-start gap-2.5 rounded-lg border border-border bg-[var(--bg-tertiary)] p-3">
                            <span className="w-6 h-6 rounded-full bg-[#25D366] text-white text-xs font-bold flex items-center justify-center shrink-0">{i}</span>
                            <span className="text-[12px] text-[var(--text-secondary)] leading-relaxed mt-0.5">
                                {tw(whatsAppRouteKey(route, `Step${i}`))}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            <div className={cn(pad, route.warningKeys.length > 0 && "border-b border-border")}>
                <h3 className="text-sm font-semibold mb-3">{tw("reqsTitle")}</h3>
                <div className="flex flex-col gap-2">
                    {requirements.map((i) => (
                        <div key={i} className="flex items-start gap-2.5 text-[12px] text-[var(--text-secondary)]">
                            <Shield size={13} className="text-[#25D366] shrink-0 mt-0.5" />
                            <span>{tw(whatsAppRouteKey(route, `Req${i}`))}</span>
                        </div>
                    ))}
                </div>
            </div>

            {route.warningKeys.length > 0 && (
                <div className={cn(pad, "flex flex-col gap-2.5")}>
                    {route.warningKeys.map((key) => (
                        <div key={key} className="flex items-start gap-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 p-4">
                            <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <span className="text-[12px] text-amber-800 dark:text-amber-300 leading-relaxed">{tw(key)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
