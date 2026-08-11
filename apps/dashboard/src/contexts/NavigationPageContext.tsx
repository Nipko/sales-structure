"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";

interface RegisteredPageTitle {
  ownerId: string;
  title: string;
  pathname: string;
}

interface NavigationPageContextValue {
  pageTitle: string | null;
  registerPageTitle: (ownerId: string, title: string) => () => void;
}

const NavigationPageContext = createContext<NavigationPageContextValue | null>(null);

export function NavigationPageProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [registered, setRegistered] = useState<RegisteredPageTitle | null>(null);

  const registerPageTitle = useCallback((ownerId: string, title: string) => {
    const normalized = title.trim();
    if (normalized) {
      setRegistered((current) => (
        current?.ownerId === ownerId
        && current.title === normalized
        && current.pathname === pathname
          ? current
          : { ownerId, title: normalized, pathname }
      ));
    }
    return () => {
      setRegistered((current) => current?.ownerId === ownerId ? null : current);
    };
  }, [pathname]);

  const value = useMemo<NavigationPageContextValue>(() => ({
    pageTitle: registered?.pathname === pathname ? registered.title : null,
    registerPageTitle,
  }), [pathname, registerPageTitle, registered]);

  return (
    <NavigationPageContext.Provider value={value}>
      {children}
    </NavigationPageContext.Provider>
  );
}

export function useNavigationPageTitle(title?: string): void {
  const registerPageTitle = useContext(NavigationPageContext)?.registerPageTitle;
  const ownerId = useId();

  useEffect(() => {
    if (!registerPageTitle || !title) return;
    return registerPageTitle(ownerId, title);
  }, [registerPageTitle, ownerId, title]);
}

export function useCurrentNavigationPageTitle(): string | null {
  return useContext(NavigationPageContext)?.pageTitle ?? null;
}
