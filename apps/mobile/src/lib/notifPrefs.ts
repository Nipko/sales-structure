/**
 * Preferencias de notificación por agente — almacenadas localmente en SecureStore.
 * No requiere backend: son ajustes del dispositivo, no de la cuenta.
 *
 * DND (Do Not Disturb): suprime notificaciones locales en el rango horario indicado.
 * Categorías: activa/desactiva cada tipo de notificación local.
 */
import * as SecureStore from 'expo-secure-store';

export interface NotifPrefs {
    dndEnabled: boolean;
    dndStart: string; // "HH:MM" 24h, e.g. "22:00"
    dndEnd: string;   // "HH:MM" 24h, e.g. "08:00"
    categories: {
        handoff: boolean;      // Conversación escalada / asignada a ti
        messages: boolean;     // Nuevo mensaje cuando ya eres el agente asignado
        sla: boolean;          // Escalación SLA
        appointments: boolean; // Nueva cita agendada
    };
}

const KEY = 'parallly_notif_prefs';

export const NOTIF_DEFAULTS: NotifPrefs = {
    dndEnabled: false,
    dndStart: '22:00',
    dndEnd: '08:00',
    categories: { handoff: true, messages: true, sla: true, appointments: true },
};

export async function getNotifPrefs(): Promise<NotifPrefs> {
    try {
        const raw = await SecureStore.getItemAsync(KEY);
        if (!raw) return { ...NOTIF_DEFAULTS, categories: { ...NOTIF_DEFAULTS.categories } };
        const saved = JSON.parse(raw);
        return {
            ...NOTIF_DEFAULTS,
            ...saved,
            categories: { ...NOTIF_DEFAULTS.categories, ...(saved.categories || {}) },
        };
    } catch {
        return { ...NOTIF_DEFAULTS, categories: { ...NOTIF_DEFAULTS.categories } };
    }
}

export async function setNotifPrefs(patch: Partial<NotifPrefs>): Promise<void> {
    const current = await getNotifPrefs();
    const next: NotifPrefs = {
        ...current,
        ...patch,
        categories: { ...current.categories, ...(patch.categories || {}) },
    };
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
}

/** Devuelve true si el DND está activo AHORA (suprimir notificación local). */
export async function isDndActive(category?: keyof NotifPrefs['categories']): Promise<boolean> {
    const prefs = await getNotifPrefs();
    // Categoría desactivada → suprimir aunque no sea DND
    if (category && !prefs.categories[category]) return true;
    if (!prefs.dndEnabled) return false;

    const now = new Date();
    const [sh, sm] = prefs.dndStart.split(':').map(Number);
    const [eh, em] = prefs.dndEnd.split(':').map(Number);
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const startMins = (sh || 0) * 60 + (sm || 0);
    const endMins = (eh || 0) * 60 + (em || 0);

    // Overnight (ej. 22:00 → 08:00)
    if (startMins > endMins) {
        return nowMins >= startMins || nowMins < endMins;
    }
    return nowMins >= startMins && nowMins < endMins;
}
