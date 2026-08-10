"use client";

import { useTranslations } from "next-intl";
import { usePaginatedContacts, type PagedContact } from "@/hooks/usePaginatedContacts";

interface PaginatedContactSelectProps {
  tenantId?: string | null;
  value: string;
  onChange: (contactId: string, contact?: PagedContact) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  placeholder?: string;
}

export function PaginatedContactSelect({
  tenantId,
  value,
  onChange,
  disabled,
  required,
  className = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm",
  placeholder,
}: PaginatedContactSelectProps) {
  const t = useTranslations("common");
  const { contacts, search, setSearch, hasMore, loading, error, loadMore, retry } = usePaginatedContacts(tenantId);
  const selectedIsMissing = Boolean(value) && !contacts.some((contact) => contact.id === value);

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t("searchContacts")}
        aria-label={t("searchContacts")}
        disabled={disabled}
        className={className}
      />
      <select
        required={required}
        value={value}
        onChange={(event) => {
          const contact = contacts.find((item) => item.id === event.target.value);
          onChange(event.target.value, contact);
        }}
        disabled={disabled || loading && contacts.length === 0}
        className={className}
      >
        <option value="">{loading && contacts.length === 0 ? t("loading") : placeholder || t("select")}</option>
        {selectedIsMissing && <option value={value}>{value}</option>}
        {contacts.map((contact) => (
          <option key={contact.id} value={contact.id}>
            {contact.name}{[contact.phone, contact.email].filter(Boolean).length
              ? ` — ${[contact.phone, contact.email].filter(Boolean).join(" · ")}`
              : ""}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {t("contactsLoadError")}{" "}
          <button type="button" onClick={retry} className="font-medium underline">{t("retry")}</button>
        </p>
      )}
      {hasMore && !error && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="text-xs font-medium text-violet-600 underline disabled:opacity-50"
        >
          {loading ? t("loading") : t("loadMore")}
        </button>
      )}
    </div>
  );
}
