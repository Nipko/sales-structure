"use client";

import { useLocale, useTranslations } from "next-intl";
import { CERTIFIED_SELF_SERVICE_CHANNELS } from "@parallext/shared";

/** Plan inclusion comes from the live catalog; certification comes from shared policy. */
export default function PlanChannels({ channels }: { channels: unknown }) {
    const t = useTranslations("onboarding.planChannels");
    const locale = useLocale();
    const included = Array.isArray(channels)
        ? CERTIFIED_SELF_SERVICE_CHANNELS.filter((channel) => channels.includes(channel))
        : null;
    const text = included === null ? t("unavailable")
        : included.length === 0 ? t("none")
        : t("included", {
            channels: new Intl.ListFormat(locale, { style: "long", type: "conjunction" })
                .format(included.map((channel) => t(`names.${channel}`))),
        });

    return <p className="mt-2 text-xs text-foreground">{text}</p>;
}
