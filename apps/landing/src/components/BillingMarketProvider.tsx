"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchBillingMarket, PRICING_COUNTRIES } from "../lib/api";
import { resolveBillingCountry, subscriptionProvider } from "../lib/billing-market";

const COUNTRY_KEY = "parallly:billing-country";
const BillingMarketContext = createContext({
  country: null as string | null,
  countries: [...PRICING_COUNTRIES] as string[],
  loading: true,
  setCountry: (_country: string) => {},
});

export function useBillingMarket() {
  const market = useContext(BillingMarketContext);
  return { ...market, provider: subscriptionProvider(market.country) };
}

export function BillingMarketProvider({ children }: { children: ReactNode }) {
  const [country, setCountryState] = useState<string | null>(null);
  const [countries, setCountries] = useState<string[]>([...PRICING_COUNTRIES]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchBillingMarket().then((market) => {
      if (cancelled) return;
      const supported = market?.supportedCountries ?? [...PRICING_COUNTRIES];
      let saved: string | null = null;
      try { saved = localStorage.getItem(COUNTRY_KEY); } catch { /* optional preference */ }
      setCountries(supported);
      setCountryState(resolveBillingCountry(
        new URLSearchParams(window.location.search).get("country"), saved, market?.country ?? null, supported,
      ));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const setCountry = useCallback((value: string) => {
    if (!countries.includes(value)) return;
    setCountryState(value);
    try { localStorage.setItem(COUNTRY_KEY, value); } catch { /* optional preference */ }
  }, [countries]);

  return <BillingMarketContext.Provider value={{ country, countries, loading, setCountry }}>{children}</BillingMarketContext.Provider>;
}
