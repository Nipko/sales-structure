"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Full internal location for contextual navigation. Unlike usePathname alone,
 * this preserves filtered views expressed through query parameters and hashes.
 */
export function useCurrentNavigationLocation(): string {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [hash, setHash] = useState("");

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [pathname]);

  return useMemo(() => {
    const search = searchParams.toString();
    return `${pathname}${search ? `?${search}` : ""}${hash}`;
  }, [hash, pathname, searchParams]);
}
