"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPreferences,
  normalizeNotificationPreferences,
} from "@/lib/notification-preferences";

const EVENT = "parallly:notification-preferences";

export function useNotificationPreferences() {
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let current = true;
    api.getNotificationPreferences().then((response) => {
      if (!current) return;
      if (response.success && response.data) {
        setPreferences(normalizeNotificationPreferences(response.data));
        setError(false);
      } else {
        setError(true);
      }
      setLoading(false);
    });
    const onChange = (event: Event) => {
      const value = (event as CustomEvent<NotificationPreferences>).detail;
      if (value) setPreferences(normalizeNotificationPreferences(value));
    };
    window.addEventListener(EVENT, onChange);
    return () => {
      current = false;
      window.removeEventListener(EVENT, onChange);
    };
  }, []);

  const updatePreferences = useCallback(async (next: NotificationPreferences) => {
    const normalized = normalizeNotificationPreferences(next);
    const previous = preferences;
    setPreferences(normalized);
    setSaving(true);
    setError(false);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: normalized }));
    const response = await api.updateNotificationPreferences(normalized);
    setSaving(false);
    if (response.success && response.data) {
      const stored = normalizeNotificationPreferences(response.data);
      setPreferences(stored);
      window.dispatchEvent(new CustomEvent(EVENT, { detail: stored }));
      return true;
    }
    setPreferences(previous);
    setError(true);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: previous }));
    return false;
  }, [preferences]);

  return { preferences, loading, saving, error, updatePreferences };
}
