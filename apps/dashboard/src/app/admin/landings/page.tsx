"use client";

import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTenant } from "@/contexts/TenantContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    Search, Plus, Globe, ExternalLink, MoreVertical, FileText, Settings, LayoutTemplate
} from "lucide-react";

export default function LandingsPage() {
    const tc = useTranslations("common");
    const { activeTenantId } = useTenant();
    const router = useRouter();

    const [landings, setLandings] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [showCreateModal, setShowCreateModal] = useState(false);

    const [newTitle, setNewTitle] = useState("");
    const [newSlug, setNewSlug] = useState("");
    const [newCourseId, setNewCourseId] = useState("");
    const [newCampaignId, setNewCampaignId] = useState("");

    useEffect(() => {
        async function load() {
            if (!activeTenantId) return;
            setLoading(true);
            try {
                const data = await api.fetch(`/intake/admin/landings/${activeTenantId}`);
                if (Array.isArray(data)) setLandings(data);
            } catch (err) { console.error("Error fetching landings:", err); }
            finally { setLoading(false); }
        }
        load();
    }, [activeTenantId]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const created = await api.fetch(`/intake/admin/landings/${activeTenantId}`, {
                method: "POST",
                body: JSON.stringify({
                    title: newTitle,
                    slug: newSlug || newTitle.toLowerCase().replace(/\s+/g, '-'),
                    courseId: newCourseId || null,
                    campaignId: newCampaignId || null,
                    status: 'draft'
                }),
            });
            if (created && created.id) {
                setLandings([created, ...landings]);
                setShowCreateModal(false);
                setNewTitle(""); setNewSlug(""); setNewCourseId(""); setNewCampaignId("");
            }
        } catch (error) {
            console.error("Error creating landing:", error);
            alert("Error al crear la landing");
        }
    };

    const filteredLandings = landings.filter(l =>
        l.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.slug?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="flex-1 overflow-y-auto bg-background p-8">
            <div className="mx-auto max-w-7xl">
                {/* Header */}
                <div className="mb-8 flex items-end justify-between">
                    <div>
                        <h1 className="text-3xl font-light text-foreground">Landing Pages</h1>
                        <p className="mt-2 text-muted-foreground font-light">
                            Gestiona las paginas publicas de captura de leads e inscripciones.
                        </p>
                    </div>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 shadow-md"
                    >
                        <Plus size={16} /> Nueva Landing
                    </button>
                </div>

                {/* Filters */}
                <div className="mb-6 flex gap-4">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar por titulo o slug..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full rounded-xl border border-border bg-card py-2.5 pl-10 pr-4 text-sm text-foreground focus:border-primary focus:outline-none transition-colors"
                        />
                    </div>
                </div>

                {/* Grid */}
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
                        {[1, 2, 3, 4].map(i => (
                            <div key={i} className="h-48 rounded-xl bg-card border border-border opacity-50" />
                        ))}
                    </div>
                ) : filteredLandings.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 bg-card rounded-xl border border-border border-dashed">
                        <div className="h-16 w-16 mb-4 rounded-full bg-background flex items-center justify-center">
                            <LayoutTemplate className="text-muted-foreground" size={32} />
                        </div>
                        <h3 className="text-lg text-foreground font-medium mb-1">No hay paginas creadas</h3>
                        <p className="text-muted-foreground text-sm">Crea tu primera landing page para empezar a capturar leads.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredLandings.map((landing) => (
                            <div key={landing.id} className="group rounded-xl border border-border bg-card overflow-hidden hover:border-primary hover:shadow-lg transition-all duration-300">
                                <div className="p-6 relative">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                                <Globe size={20} className="text-primary" />
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-medium text-foreground">{landing.title}</h3>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full border border-border">
                                                        /{landing.slug}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <button className="text-muted-foreground hover:text-foreground transition-colors">
                                            <MoreVertical size={18} />
                                        </button>
                                    </div>

                                    <div className="space-y-3 mt-6">
                                        <div className="flex items-center text-sm text-muted-foreground">
                                            <FileText size={14} className="mr-2" />
                                            Curso: {landing.course_name || "Ninguno"}
                                        </div>
                                        <div className="flex items-center text-sm text-muted-foreground">
                                            <Settings size={14} className="mr-2" />
                                            Campana: {landing.campaign_name || "Ninguna"}
                                        </div>
                                    </div>

                                    <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                                        <div className="flex items-center gap-2">
                                            <span className={cn("h-2 w-2 rounded-full", landing.status === 'published' ? 'bg-green-500' : 'bg-yellow-500')} />
                                            <span className="text-xs uppercase font-medium text-muted-foreground tracking-wider">{landing.status}</span>
                                        </div>
                                        <a href={`/l/${landing.slug}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                                            Ver Landing <ExternalLink size={12} />
                                        </a>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-2xl">
                        <h2 className="mb-1 text-xl font-medium text-foreground">Nueva Landing Page</h2>
                        <p className="mb-6 text-sm text-muted-foreground">Define los datos base de la landing.</p>

                        <form onSubmit={handleCreate} className="space-y-4">
                            <div>
                                <label className="mb-1 block text-sm text-muted-foreground">Titulo de la Pagina</label>
                                <input required type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="w-full rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="Ej: Masterclass Ventas B2B" />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm text-muted-foreground">Slug (URL)</label>
                                <input type="text" value={newSlug} onChange={(e) => setNewSlug(e.target.value)} className="w-full rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none" placeholder="ej: masterclass-ventas-b2b" />
                                <p className="text-xs text-muted-foreground mt-1">Se generara automaticamente si se deja vacio.</p>
                            </div>

                            <div className="mt-6 flex justify-end gap-3 border-t border-border pt-6">
                                <button type="button" onClick={() => setShowCreateModal(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-card">
                                    Cancelar
                                </button>
                                <button type="submit" className="rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground shadow-md hover:opacity-90">
                                    Crear Pagina
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
