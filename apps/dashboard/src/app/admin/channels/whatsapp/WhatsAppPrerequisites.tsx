"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ShieldCheck } from "lucide-react";
import { guidedTourAnchorId } from "@/lib/guided-tours";

/**
 * Pre-check de prerrequisitos mostrado ANTES de lanzar el Embedded Signup de Meta.
 * El mayor cuello de botella del TTFV es el abandono DENTRO del popup de Meta cuando
 * el usuario descubre a mitad de camino que no tiene un número libre / acceso al OTP /
 * cuenta de Facebook. Confirmar estos puntos por adelantado reduce falsos inicios.
 * Es un gate suave (awareness), no validación dura.
 *
 * La nota que ofrecía "probá con un número de prueba" salió: esa ruta no existe
 * más en el producto, así que era una salida a ninguna parte.
 */
export default function WhatsAppPrerequisites({ onContinue }: { onContinue: () => void }) {
    const t = useTranslations("setupWizard.connect");
    const [checked, setChecked] = useState<boolean[]>([false, false, false]);
    const allChecked = checked.every(Boolean);
    const toggle = (i: number) => setChecked((c) => c.map((v, j) => (j === i ? !v : v)));
    const items = [t("prereqs.item1"), t("prereqs.item2"), t("prereqs.item3")];

    return (
        <div id={guidedTourAnchorId("whatsapp-prerequisites")}>
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-neutral-200 dark:border-white/10">
                <div className="w-11 h-11 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <ShieldCheck size={22} />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{t("prereqs.title")}</p>
                    <p className="text-[12px] text-muted-foreground">{t("prereqs.subtitle")}</p>
                </div>
            </div>
            <div className="space-y-2 mb-4">
                {items.map((label, i) => (
                    <button
                        key={i}
                        onClick={() => toggle(i)}
                        className="w-full flex items-start gap-3 p-3 rounded-lg border border-neutral-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-left hover:border-emerald-500/40 transition-colors cursor-pointer"
                    >
                        <span className={`mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${checked[i] ? "bg-emerald-500 text-white" : "border-2 border-neutral-300 dark:border-white/20"}`}>
                            {checked[i] && <Check size={13} />}
                        </span>
                        <span className="text-[13px] text-foreground leading-snug">{label}</span>
                    </button>
                ))}
            </div>
            <button
                onClick={onContinue}
                disabled={!allChecked}
                className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 transition-colors cursor-pointer"
            >
                {allChecked ? t("prereqs.continue") : t("prereqs.checkAll")}
            </button>
        </div>
    );
}
