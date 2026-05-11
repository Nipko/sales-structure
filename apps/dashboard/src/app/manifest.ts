import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        id: '/',
        name: 'Parallly — Admin Dashboard',
        short_name: 'Parallly',
        description: 'Plataforma de automatización de ventas con IA conversacional',
        start_url: '/admin',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        background_color: '#0a0a12',
        theme_color: '#6c5ce7',
        orientation: 'portrait-primary',
        categories: ['business', 'productivity'],
        icons: [
            { src: '/icon-192x192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
            { src: '/icon-512x512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
            { src: '/icon-maskable-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'maskable' },
            { src: '/icon-maskable-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
        ],
        shortcuts: [
            { name: 'Inbox', url: '/admin/inbox', icons: [{ src: '/icon-192x192.png', sizes: '192x192' }] },
            { name: 'Contactos', url: '/admin/contacts', icons: [{ src: '/icon-192x192.png', sizes: '192x192' }] },
        ],
    };
}
