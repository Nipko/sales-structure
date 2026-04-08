"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.parallly-chat.cloud/api/v1";

interface Article {
    id: string;
    title: string;
    slug: string;
    category: string;
    excerpt: string;
    content: string;
    published_at: string;
    updated_at: string;
}

export default function KBPublicPage() {
    const params = useParams();
    const tenantSlug = params?.tenantSlug as string;

    const [articles, setArticles] = useState<Article[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);

    useEffect(() => {
        if (!tenantSlug) return;
        setLoading(true);
        fetch(`${API_URL}/knowledge/public/${tenantSlug}/articles`)
            .then((r) => r.json())
            .then((data) => {
                setArticles(Array.isArray(data.data) ? data.data : []);
            })
            .catch((err) => {
                console.error("Error loading KB articles:", err);
                setArticles([]);
            })
            .finally(() => setLoading(false));
    }, [tenantSlug]);

    const categories = useMemo(() => {
        const cats = new Set<string>();
        articles.forEach((a) => {
            if (a.category) cats.add(a.category);
        });
        return Array.from(cats).sort();
    }, [articles]);

    const filtered = useMemo(() => {
        let list = articles;
        if (selectedCategory) {
            list = list.filter((a) => a.category === selectedCategory);
        }
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(
                (a) =>
                    a.title.toLowerCase().includes(q) ||
                    (a.excerpt && a.excerpt.toLowerCase().includes(q)) ||
                    (a.category && a.category.toLowerCase().includes(q))
            );
        }
        return list;
    }, [articles, selectedCategory, search]);

    const tenantName = tenantSlug
        ? tenantSlug.charAt(0).toUpperCase() + tenantSlug.slice(1).replace(/-/g, " ")
        : "Knowledge Base";

    if (selectedArticle) {
        return (
            <div style={{
                minHeight: "100vh", background: "#ffffff", color: "#1a1a2e",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            }}>
                {/* Header */}
                <header style={{
                    borderBottom: "1px solid #e5e7eb", padding: "16px 32px",
                    display: "flex", alignItems: "center", gap: 16,
                }}>
                    <button
                        onClick={() => setSelectedArticle(null)}
                        style={{
                            background: "none", border: "1px solid #d1d5db", borderRadius: 8,
                            padding: "6px 14px", cursor: "pointer", fontSize: 13, color: "#374151",
                        }}
                    >
                        Volver
                    </button>
                    <span style={{ fontSize: 14, color: "#6b7280" }}>{tenantName}</span>
                </header>
                {/* Article */}
                <main style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px" }}>
                    {selectedArticle.category && (
                        <span style={{
                            fontSize: 12, fontWeight: 600, color: "#6366f1", textTransform: "uppercase",
                            letterSpacing: 0.5, marginBottom: 8, display: "inline-block",
                        }}>
                            {selectedArticle.category}
                        </span>
                    )}
                    <h1 style={{ margin: "0 0 16px", fontSize: 28, fontWeight: 700, color: "#111827" }}>
                        {selectedArticle.title}
                    </h1>
                    {selectedArticle.published_at && (
                        <p style={{ margin: "0 0 24px", fontSize: 13, color: "#9ca3af" }}>
                            Publicado: {new Date(selectedArticle.published_at).toLocaleDateString("es-CO", { year: "numeric", month: "long", day: "numeric" })}
                        </p>
                    )}
                    <div style={{
                        fontSize: 15, lineHeight: 1.7, color: "#374151",
                        whiteSpace: "pre-wrap", wordBreak: "break-word",
                    }}>
                        {selectedArticle.content}
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div style={{
            minHeight: "100vh", background: "#ffffff", color: "#1a1a2e",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}>
            {/* Header */}
            <header style={{
                borderBottom: "1px solid #e5e7eb", padding: "20px 32px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#111827" }}>
                    {tenantName} - Centro de Ayuda
                </h1>
            </header>

            <div style={{ display: "flex", minHeight: "calc(100vh - 65px)" }}>
                {/* Sidebar */}
                <aside style={{
                    width: 240, borderRight: "1px solid #e5e7eb", padding: "24px 16px",
                    flexShrink: 0,
                }}>
                    <h3 style={{ margin: "0 0 16px", fontSize: 12, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>
                        Categorias
                    </h3>
                    <button
                        onClick={() => setSelectedCategory(null)}
                        style={{
                            display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                            borderRadius: 6, border: "none", cursor: "pointer", marginBottom: 4,
                            fontSize: 14, fontWeight: selectedCategory === null ? 600 : 400,
                            background: selectedCategory === null ? "#f3f4f6" : "transparent",
                            color: selectedCategory === null ? "#111827" : "#6b7280",
                        }}
                    >
                        Todos ({articles.length})
                    </button>
                    {categories.map((cat) => {
                        const count = articles.filter((a) => a.category === cat).length;
                        return (
                            <button
                                key={cat}
                                onClick={() => setSelectedCategory(cat)}
                                style={{
                                    display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                                    borderRadius: 6, border: "none", cursor: "pointer", marginBottom: 4,
                                    fontSize: 14, fontWeight: selectedCategory === cat ? 600 : 400,
                                    background: selectedCategory === cat ? "#f3f4f6" : "transparent",
                                    color: selectedCategory === cat ? "#111827" : "#6b7280",
                                }}
                            >
                                {cat} ({count})
                            </button>
                        );
                    })}
                </aside>

                {/* Main content */}
                <main style={{ flex: 1, padding: "24px 32px" }}>
                    {/* Search */}
                    <div style={{ marginBottom: 24 }}>
                        <input
                            type="text"
                            placeholder="Buscar articulos..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{
                                width: "100%", maxWidth: 480, padding: "10px 16px", borderRadius: 8,
                                border: "1px solid #d1d5db", fontSize: 14, color: "#374151",
                                background: "#f9fafb", outline: "none",
                            }}
                        />
                    </div>

                    {/* Article List */}
                    {loading ? (
                        <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>
                            Cargando articulos...
                        </div>
                    ) : filtered.length === 0 ? (
                        <div style={{ textAlign: "center", padding: 60, color: "#9ca3af" }}>
                            {search ? "No se encontraron articulos" : "No hay articulos publicados"}
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {filtered.map((article) => (
                                <div
                                    key={article.id}
                                    onClick={() => setSelectedArticle(article)}
                                    style={{
                                        padding: "16px 20px", borderRadius: 10, border: "1px solid #e5e7eb",
                                        cursor: "pointer", transition: "all 0.15s ease",
                                        background: "#ffffff",
                                    }}
                                    onMouseEnter={(e) => {
                                        (e.currentTarget as HTMLDivElement).style.borderColor = "#6366f1";
                                        (e.currentTarget as HTMLDivElement).style.background = "#fafaff";
                                    }}
                                    onMouseLeave={(e) => {
                                        (e.currentTarget as HTMLDivElement).style.borderColor = "#e5e7eb";
                                        (e.currentTarget as HTMLDivElement).style.background = "#ffffff";
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                        {article.category && (
                                            <span style={{
                                                fontSize: 11, fontWeight: 600, color: "#6366f1",
                                                background: "#eef2ff", padding: "2px 8px", borderRadius: 4,
                                            }}>
                                                {article.category}
                                            </span>
                                        )}
                                    </div>
                                    <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 600, color: "#111827" }}>
                                        {article.title}
                                    </h3>
                                    {article.excerpt && (
                                        <p style={{ margin: 0, fontSize: 14, color: "#6b7280", lineHeight: 1.5 }}>
                                            {article.excerpt}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
