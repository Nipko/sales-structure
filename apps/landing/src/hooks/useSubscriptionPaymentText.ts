"use client";

import { useTranslations } from "next-intl";
import { useBillingMarket } from "../components/BillingMarketProvider";

export function useSubscriptionPaymentText() {
  const t = useTranslations("subscriptionPayment");
  const { provider } = useBillingMarket();
  const market = provider ?? "unknown";
  const values = { provider: provider === "wompi" ? "Wompi" : provider === "stripe" ? "Stripe" : t("providerUnknown") };
  return {
    footer: t("footer", values),
    body: t("body", values),
    security: t("security", values),
    metaSeparation: t("metaSeparation", values),
    countryHint: t(`countryHint.${market}`),
    chooseCountry: t("chooseCountry"),
  };
}
