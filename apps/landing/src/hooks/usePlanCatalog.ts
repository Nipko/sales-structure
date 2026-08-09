"use client";

import { useCallback, useEffect, useState } from "react";
import {
  detectPricingCountry,
  fetchPlans,
  type ApiPlan,
  type PricingCountry,
} from "../lib/api";

export type PlanCatalogStatus = "loading" | "ready" | "empty" | "error";

export function usePlanCatalog() {
  const [country, setCountry] = useState<PricingCountry | null>(null);
  const [plans, setPlans] = useState<ApiPlan[]>([]);
  const [status, setStatus] = useState<PlanCatalogStatus>("loading");
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    setCountry(detectPricingCountry());
  }, []);

  useEffect(() => {
    if (!country) return;

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
  }, [country, requestVersion]);

  const retry = useCallback(() => setRequestVersion((version) => version + 1), []);

  return { country, setCountry, plans, status, retry };
}
