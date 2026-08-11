"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { resolveNavigationRoute } from "@/lib/navigation-contract";
import {
  EMPTY_NAVIGATION_PREFERENCES,
  MAX_NAVIGATION_FAVORITES,
  MAX_NAVIGATION_RECENTS,
  type NavigationPreferences,
  sanitizeNavigationPreferences,
} from "@/lib/navigation-preferences";

const PREFERENCES_EVENT = "navigation:preferences-changed";
function readPreferences(key: string): NavigationPreferences {
  if (typeof window === "undefined") return EMPTY_NAVIGATION_PREFERENCES;
  try {
    return sanitizeNavigationPreferences(JSON.parse(localStorage.getItem(key) || "null"));
  } catch {
    return EMPTY_NAVIGATION_PREFERENCES;
  }
}

function writePreferences(key: string, value: NavigationPreferences): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: { key } }));
  } catch {
    // Navigation remains fully usable when storage is disabled.
  }
}

export function useNavigationPreferences() {
  const pathname = usePathname();
  const { user } = useAuth();
  const owner = user?.id || user?.email || user?.role || "anonymous";
  const storageKey = useMemo(() => `navigation:preferences:${owner}`, [owner]);
  const [preferences, setPreferences] = useState<NavigationPreferences>(() => readPreferences(storageKey));

  useEffect(() => {
    setPreferences(readPreferences(storageKey));
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (!detail?.key || detail.key === storageKey) setPreferences(readPreferences(storageKey));
    };
    window.addEventListener(PREFERENCES_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PREFERENCES_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [storageKey]);

  useEffect(() => {
    const resolved = resolveNavigationRoute(pathname);
    if (!resolved || resolved.definition.pattern.includes(":") || resolved.definition.discoverable === false) return;
    const next = readPreferences(storageKey);
    const recents = [
      { routeId: resolved.definition.id, href: resolved.pathname, visitedAt: Date.now() },
      ...next.recents.filter((entry) => entry.routeId !== resolved.definition.id),
    ].slice(0, MAX_NAVIGATION_RECENTS);
    const updated = { ...next, recents };
    writePreferences(storageKey, updated);
    setPreferences(updated);
  }, [pathname, storageKey]);

  const toggleFavorite = useCallback((routeId: string) => {
    const current = readPreferences(storageKey);
    const exists = current.favorites.includes(routeId);
    const favorites = exists
      ? current.favorites.filter((item) => item !== routeId)
      : [routeId, ...current.favorites].slice(0, MAX_NAVIGATION_FAVORITES);
    const updated = { ...current, favorites };
    writePreferences(storageKey, updated);
    setPreferences(updated);
  }, [storageKey]);

  return {
    favorites: preferences.favorites,
    recents: preferences.recents,
    toggleFavorite,
    isFavorite: (routeId: string) => preferences.favorites.includes(routeId),
  };
}
