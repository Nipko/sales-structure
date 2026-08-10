"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export interface PagedContact {
  id: string;
  name: string;
  phone?: string;
  email?: string;
}

const mergeById = (current: PagedContact[], incoming: PagedContact[]) => {
  const merged = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values());
};

export function usePaginatedContacts(tenantId?: string | null, enabled = true, pageSize = 50) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [contacts, setContacts] = useState<PagedContact[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (offset: number, replace: boolean) => {
    const id = ++requestId.current;
    if (!tenantId || !enabled) {
      setContacts([]);
      setHasMore(false);
      setError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const response = await api.getOrderContacts(tenantId, {
        search: debouncedSearch || undefined,
        limit: pageSize,
        offset,
      });
      if (id !== requestId.current) return;
      const page = response?.data;
      if (!response?.success || !page || !Array.isArray(page.items)) throw new Error("contacts_failed");
      const incoming = page.items
        .filter((contact) => typeof contact?.id === "string" && contact.id.length > 0)
        .map((contact) => ({
          id: contact.id,
          name: typeof contact.name === "string" && contact.name.trim() ? contact.name.trim() : contact.id,
          phone: typeof contact.phone === "string" ? contact.phone : "",
          email: typeof contact.email === "string" ? contact.email : "",
        }));
      setContacts((current) => replace ? incoming : mergeById(current, incoming));
      setHasMore(Boolean(page.hasMore));
    } catch {
      if (id === requestId.current) setError(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [debouncedSearch, enabled, pageSize, tenantId]);

  useEffect(() => {
    setContacts([]);
    setHasMore(false);
    void load(0, true);
    return () => { requestId.current += 1; };
  }, [load]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) void load(contacts.length, false);
  }, [contacts.length, hasMore, load, loading]);

  const retry = useCallback(() => void load(0, true), [load]);

  return { contacts, search, setSearch, hasMore, loading, error, loadMore, retry };
}
