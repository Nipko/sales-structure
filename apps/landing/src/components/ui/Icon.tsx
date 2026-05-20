"use client";

const s = (cls = "w-5 h-5") => cls;

export const Icon = {
  bot: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 2a1 1 0 011 1v2h-2V3a1 1 0 011-1z" />
      <rect x="3" y="7" width="18" height="13" rx="3" />
      <circle cx="9" cy="13" r="1.5" fill="currentColor" />
      <circle cx="15" cy="13" r="1.5" fill="currentColor" />
      <path d="M9 17h6" strokeLinecap="round" />
    </svg>
  ),
  inbox: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M22 12h-6l-2 3H10l-2-3H2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </svg>
  ),
  users: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" />
    </svg>
  ),
  calendar: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
    </svg>
  ),
  zap: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chart: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M18 20V10M12 20V4M6 20v-6" strokeLinecap="round" />
    </svg>
  ),
  book: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20M4 4.5A2.5 2.5 0 016.5 2H20v20H6.5a2.5 2.5 0 01-2.5-2.5v-15z" strokeLinecap="round" />
    </svg>
  ),
  layers: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="2 17 12 22 22 17" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="2 12 12 17 22 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  fingerprint: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 018 4M5 19.5C5.5 18 6 15 6 12a6 6 0 0112 0c0 3.5-1 5-2.5 7.5M12 12a3 3 0 00-3 3c0 2 .5 4 2 6M15 9.3a4 4 0 00-6 3.4c0 2.5 1 4.5 2.5 7.3M19.5 8a8.4 8.4 0 01.5 4c0 3-1 5-2.5 7" strokeLinecap="round" />
    </svg>
  ),
  mail: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-10 7L2 7" strokeLinecap="round" />
    </svg>
  ),
  shield: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  lock: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" />
    </svg>
  ),
  check: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  x: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  ),
  arrow: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  plus: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  ),
  minus: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M5 12h14" strokeLinecap="round" />
    </svg>
  ),
  chevronDown: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  menu: (cls?: string) => (
    <svg className={s(cls)} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  ),
  close: (cls?: string) => (
    <svg className={s(cls)} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  telegram: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.05-.2-.07-.05-.18-.04-.25-.02-.11.03-1.77 1.12-4.99 3.27-.47.32-.9.48-1.28.47-.42-.01-1.23-.24-1.83-.44-.74-.24-1.32-.37-1.27-.78.03-.21.32-.43.86-.65 3.36-1.46 5.6-2.42 6.72-2.89 3.21-1.35 3.87-1.59 4.31-1.59.09 0 .31.02.45.13.12.09.16.21.18.3.02.09.04.31.02.48z" />
    </svg>
  ),
  externalLink: (cls?: string) => (
    <svg className={s(cls)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};
