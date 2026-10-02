"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

const BUSINESS_MARKS = [
    { key: "name", targetId: "onboarding-name-field" },
    { key: "industry", targetId: "onboarding-industry-field" },
    { key: "subtype", targetId: "onboarding-subtype-field" },
    { key: "about", targetId: "onboarding-about-field" },
    { key: "orgSize", targetId: "onboarding-orgsize-field" },
    { key: "timezone", targetId: "onboarding-timezone-field" },
    { key: "submit", targetId: "onboarding-next-button" },
] as const;

type MarkKey = typeof BUSINESS_MARKS[number]["key"];

/**
 * The signup's first-visit help stays in the form's normal flow. Each field
 * declares a dedicated slot after its controls, so translated copy and browser
 * zoom can grow the card without covering a question or its answer.
 *
 * Keep this component mounted when changing wizard screens: returning to the
 * business screen should keep the current tip instead of restarting the guide.
 */
export default function OnboardingCoachMarks({
    storageKey,
    enabled,
    includeSubtype,
}: {
    storageKey: string;
    enabled: boolean;
    includeSubtype: boolean;
}) {
    const t = useTranslations("onboarding.coachMarks");
    const [visible, setVisible] = useState(false);
    const [activeKey, setActiveKey] = useState<MarkKey>("name");
    const [slot, setSlot] = useState<HTMLElement | null>(null);
    const pendingNavigation = useRef(false);
    const cardRef = useRef<HTMLElement>(null);
    const focusedAnchor = useRef<{ element: HTMLElement; top: number } | null>(null);
    const marks = useMemo(() => BUSINESS_MARKS.filter((mark) => includeSubtype || mark.key !== "subtype"), [includeSubtype]);
    const index = Math.max(0, marks.findIndex((mark) => mark.key === activeKey));
    const mark = marks[index];
    const slotId = `${mark.targetId}-guide-slot`;

    useEffect(() => {
        try {
            setVisible(!localStorage.getItem(storageKey));
        } catch { /* Unavailable storage should not repeatedly open the help. */ }
    }, [storageKey]);

    // Re-resolve slots when the first wizard screen is mounted again. Portals
    // are only placed in explicit help containers, never inside a control.
    useLayoutEffect(() => {
        setSlot(enabled && visible ? document.getElementById(slotId) : null);
    }, [enabled, visible, slotId]);

    useEffect(() => {
        if (!enabled || !visible) return;
        const followFocus = (event: FocusEvent) => {
            const target = event.target;
            if (!(target instanceof HTMLElement) || target.closest("[data-onboarding-coach-mark]")) return;
            const focusedMark = marks.find((candidate) => document.getElementById(candidate.targetId)?.contains(target));
            if (!focusedMark || focusedMark.key === mark.key) return;
            // Moving an inline card must not move a clicked control away from
            // the pointer, or scroll a field away while the person is typing.
            focusedAnchor.current = { element: target, top: target.getBoundingClientRect().top };
            setActiveKey(focusedMark.key);
        };
        document.addEventListener("focusin", followFocus);
        return () => document.removeEventListener("focusin", followFocus);
    }, [enabled, visible, marks, mark.key]);

    useLayoutEffect(() => {
        if (!enabled || !visible || slot?.id !== slotId) return;
        const target = document.getElementById(mark.targetId);
        if (pendingNavigation.current && target) {
            pendingNavigation.current = false;
            const control = target.matches("button, input, select, textarea")
                ? target
                : target.querySelector<HTMLElement>("input, select, textarea, button");
            control?.focus({ preventScroll: true });
            if (document.activeElement !== control) cardRef.current?.focus({ preventScroll: true });
            target.scrollIntoView({ block: "center", behavior: "auto" });
        } else if (focusedAnchor.current) {
            const { element, top } = focusedAnchor.current;
            if (element.isConnected) {
                const shift = element.getBoundingClientRect().top - top;
                if (shift !== 0) window.scrollBy({ top: shift, behavior: "instant" });
            }
        }
        focusedAnchor.current = null;
    }, [enabled, visible, slot, slotId, mark.targetId]);

    const dismiss = () => {
        setVisible(false);
        try { localStorage.setItem(storageKey, "1"); } catch { /* noop */ }
        // The close button is about to leave the DOM. Return keyboard users to
        // the field they were reading about, without moving their viewport.
        const target = document.getElementById(mark.targetId);
        const control = target?.matches("button, input, select, textarea")
            ? target
            : target?.querySelector<HTMLElement>("input, select, textarea, button");
        control?.focus({ preventScroll: true });
        if (document.activeElement !== control) document.getElementById("onboarding-step-heading")?.focus({ preventScroll: true });
    };

    const navigate = (nextIndex: number) => {
        pendingNavigation.current = true;
        focusedAnchor.current = null;
        setActiveKey(marks[nextIndex].key);
    };

    if (!enabled || !visible || !slot || slot.id !== slotId) return null;

    return createPortal(
        <aside
            ref={cardRef}
            role="region"
            tabIndex={-1}
            aria-label={t("label")}
            data-onboarding-coach-mark={mark.key}
            className="relative mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-left dark:border-indigo-500/30 dark:bg-indigo-500/10"
        >
            <button
                type="button"
                onClick={dismiss}
                aria-label={t("skip")}
                className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-indigo-500 cursor-pointer"
            >
                <X size={16} />
            </button>
            <p className="pr-7 text-sm font-semibold text-foreground">{t(`${mark.key}.title`)}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{t(`${mark.key}.body`)}</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{t("progress", { current: index + 1, total: marks.length })}</span>
                <div className="flex flex-wrap items-center gap-2">
                    {index > 0 && (
                        <button
                            type="button"
                            onClick={() => navigate(index - 1)}
                            className="rounded-lg px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-indigo-500 cursor-pointer"
                        >
                            {t("back")}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => index === marks.length - 1 ? dismiss() : navigate(index + 1)}
                        className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 cursor-pointer"
                    >
                        {index === marks.length - 1 ? t("done") : t("next")}
                    </button>
                </div>
            </div>
        </aside>,
        slot,
    );
}
