"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchPlans,
  type ApiPlan,
} from "../lib/api";
import { useBillingMarket } from "../components/BillingMarketProvider";

export type PlanCatalogStatus = "loading" | "country_required" | "ready" | "empty" | "error";

export function usePlanCatalog() {
  const { country, countries, setCountry, loading: marketLoading } = useBillingMarket();
  const [plans, setPlans] = useState<ApiPlan[]>([]);
  const [status, setStatus] = useState<PlanCatalogStatus>("loading");
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    if (!country) {
      setPlans([]);
      setStatus(marketLoading ? "loading" : "country_required");
      return;
    }

    const controller = new AbortController();
    setPlans([]);
    setStatus("loading");

    fetchPlans(country, controller.signal)
      .then((catalog) => {
        if (!catalog) {
          setStatus("error");
          return;
        }
        setPlans(catalog);
        setStatus(catalog.length > 0 ? "ready" : "empty");
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setStatus("error");
        }
      });

    return () => controller.abort();
  }, [country, requestVersion, marketLoading]);

  const retry = useCallback(() => setRequestVersion((version) => version + 1), []);

  return { country, countries, setCountry, plans, status, retry };
}
