export interface ChangelogItem {
    id: string; // Date identifier in YYYY-MM-DD
    version: string;
    date: string;
    title: string;
    description: string;
    features: { title: string; desc: string; type: 'new' | 'improved' | 'fixed' }[];
}

export const changelogData: ChangelogItem[] = [
    {
        id: "2026-05-25",
        version: "v1.4.0",
        date: "25 de Mayo, 2026",
        title: "¡Nuevas analíticas de IA y agentes en tiempo real!",
        description: "Hemos lanzado una importante actualización para nuestro módulo de estadísticas. Ahora puedes comparar el rendimiento de tus asistentes virtuales (IA) frente a tus agentes humanos en un panel de control interactivo.",
        features: [
            {
                type: 'new',
                title: 'Rendimiento de Agentes IA',
                desc: 'Tus agentes virtuales (IA) ahora se listan de forma nativa junto a tus agentes humanos en el panel de rendimiento, permitiendo medir de forma autónoma su volumen de conversaciones, tasa de resolución y efectividad.'
            },
            {
                type: 'new',
                title: 'Identificación Visual Premium',
                desc: 'Añadimos etiquetas estilizadas [IA] en color índigo y [Humano] en esmeralda para diferenciar visualmente a los miembros de tu equipo virtual y humano en todas las tablas.'
            },
            {
                type: 'improved',
                title: 'Tiempos de Respuesta Inteligentes',
                desc: 'Implementamos un fallback automático para calcular los tiempos de respuesta y resolución basados en el flujo real de mensajes de la IA, evitando métricas vacías.'
            },
            {
                type: 'fixed',
                title: 'Estabilidad en Base de Conocimiento',
                desc: 'Corregimos la carga de recursos de conocimientos específicos en cuentas con industrias y verticales personalizadas.'
            }
        ]
    }
];
