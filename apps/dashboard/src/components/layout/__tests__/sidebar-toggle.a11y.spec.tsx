import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import * as fs from 'node:fs';
import * as path from 'node:path';
import AppSidebar from '../AppSidebar';
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
jest.mock('next/image', () => ({ __esModule: true, default: ({ priority, unoptimized, ...props }: any) => <img {...props} /> }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, verticalConfig: null }) }));
jest.mock('@/hooks/useRole', () => ({ useRole: () => ({ isSuperAdmin: false, impersonating: false, role: 'tenant_admin' }) }));
jest.mock('@/hooks/useNavigationPreferences', () => ({ useNavigationPreferences: () => ({ favorites: [] }) }));
jest.mock('@/hooks/useCurrentNavigationLocation', () => ({ useCurrentNavigationLocation: () => '/admin/settings/notifications' }));
jest.mock('@/contexts/QualityHealthContext', () => ({ useQualityHealth: () => ({ summary: null }) }));
jest.mock('@/lib/navigation-telemetry', () => ({ recordNavigationEvent: jest.fn() }));
jest.mock('@/lib/api', () => ({ api: { getSystemUpdates: async () => ({ success: true, data: [] }) } }));
jest.mock('framer-motion', () => ({ AnimatePresence: ({ children }: any) => children, motion: { div: ({ children, initial, animate, transition, ...props }: any) => <div {...props}>{children}</div> } }));

it.each(['es', 'en', 'pt', 'fr'])('keeps the desktop toggle anchored while revealing the home link on hover (%s)', async locale => {
  const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../messages', locale + '.json'), 'utf8'));
  const host = document.createElement('div');document.body.appendChild(host);const root = createRoot(host);
  try {
    await React.act(async () => root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC"><AppSidebar /></NextIntlClientProvider>));
    const aside = host.querySelector('aside')!;
    const toggle = aside.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle).not.toBeNull();
    await React.act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(aside.querySelector('a[aria-label="Parallly"]')).toBeNull();
    if (process.env.PARALLLY_SIDEBAR_FIXTURE) {
      fs.mkdirSync(process.env.PARALLLY_SIDEBAR_FIXTURE, { recursive: true });
      fs.writeFileSync(path.join(process.env.PARALLLY_SIDEBAR_FIXTURE, locale + '-collapsed.html'), aside.outerHTML);
    }
    await React.act(async () => aside.firstElementChild!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })));
    expect(aside.querySelector('a[aria-label="Parallly"]')).not.toBeNull();
    expect(aside.querySelector('button[aria-expanded]')).toBe(toggle);
    if (process.env.PARALLLY_SIDEBAR_FIXTURE) fs.writeFileSync(path.join(process.env.PARALLLY_SIDEBAR_FIXTURE, locale + '-hovered.html'), aside.outerHTML);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await React.act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  } finally { React.act(() => root.unmount());host.remove(); }
});
