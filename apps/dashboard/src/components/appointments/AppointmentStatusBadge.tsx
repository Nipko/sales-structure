"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { STATUS_CONFIG } from "./shared";

/**
 * The status of an appointment as words, never as colour alone.
 *
 * The calendar, the agenda and the detail view all show it, so they share one
 * badge: a status that is written differently on each screen is a status the
 * owner has to translate in their head.
 */
export default function AppointmentStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const t = useTranslations("appointments");
  const config = STATUS_CONFIG[status];
  if (!config) return null;
  return (
    <span
      data-appointment-status={status}
      className={cn(
        "inline-flex items-center text-[11px] px-2.5 py-1 rounded-full font-semibold",
        config.twBg,
        config.twText,
        className,
      )}
    >
      {t(config.i18nKey)}
    </span>
  );
}
