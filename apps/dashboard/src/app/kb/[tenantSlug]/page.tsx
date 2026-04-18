"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Search, BookOpen, ChevronRight, Folder } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

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

  useEffect(() => {
    if (!tenantSlug) return;
    setLoading(true);
    fetch(`${API_URL}/knowledge/public/${tenantSlug}/articles`)
      .then((r) => r.json())
      .then((data) => setArticles(Array.isArray(data.data) ? data.data : []))
      .catch(() => setArticles([]))
      .finally(() => setLoading(false));
  }, [tenantSlug]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    articles.forEach((a) => { if (a.category) cats.add(a.category); });
    return Array.from(cats).sort();
  }, [articles]);

  const filtered = useMemo(() => {
    let list = articles;
    if (selectedCategory) list = list.filter((a) => a.category === selectedCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) =>
        a.title.toLowerCase().includes(q) ||
        (a.excerpt && a.excerpt.toLowerCase().includes(q)) ||
        (a.category && a.category.toLowerCase().includes(q))
      );
    }
    return list;
  }, [articles, selectedCategory, search]);

  const tenantName = tenantSlug
    ? tenantSlug.charAt(0).toUpperCase() + tenantSlug.slice(1).replace(/-/g, " ")
    : "Help Center";

  return (
    <div style={{
      minHeight: "100vh", background: "#fafbfc",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      {/* Hero header */}
      <header style={{
        background: "linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #818cf8 100%)",
        padding: "48px 32px 56px", textAlign: "center", color: "#fff",
      }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 800 }}>
          {tenantName} Help Center
        </h1>
        <p style={{ margin: "0 0 28px", fontSize: 15, opacity: 0.85 }}>
          Find answers to your questions
        </p>

        {/* Search */}
        <div style={{ maxWidth: 520, margin: "0 auto", position: "relative" }}>
          <Search size={18} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} />
          <input
            type="text"
            placeholder="Search articles..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%", padding: "14px 20px 14px 44px", borderRadius: 12,
              border: "none", fontSize: 15, color: "#374151",
              background: "#ffffff", outline: "none",
              boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
            }}
          />
        </div>
      </header>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px 80px" }}>
        {/* Category pills */}
        {categories.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
            <button
              onClick={() => setSelectedCategory(null)}
              style={{
                padding: "8px 16px", borderRadius: 20, border: "1px solid #e5e7eb",
                cursor: "pointer", fontSize: 13, fontWeight: 500,
                background: selectedCategory === null ? "#4f46e5" : "#ffffff",
                color: selectedCategory === null ? "#ffffff" : "#6b7280",
              }}
            >
              All ({articles.length})
            </button>
            {categories.map((cat) => {
              const count = articles.filter((a) => a.category === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                  style={{
                    padding: "8px 16px", borderRadius: 20, border: "1px solid #e5e7eb",
                    cursor: "pointer", fontSize: 13, fontWeight: 500,
                    background: selectedCategory === cat ? "#4f46e5" : "#ffffff",
                    color: selectedCategory === cat ? "#ffffff" : "#6b7280",
                    display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  <Folder size={13} /> {cat} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Articles */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 80, color: "#9ca3af" }}>
            <div style={{ width: 32, height: 32, border: "3px solid #e5e7eb", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            Loading articles...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 80, color: "#9ca3af" }}>
            <BookOpen size={40} style={{ margin: "0 auto 12px", display: "block", color: "#d1d5db" }} />
            {search ? "No articles found" : "No published articles yet"}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {filtered.map((article) => (
              <Link
                key={article.id}
                href={`/kb/${tenantSlug}/${article.slug}`}
                style={{
                  padding: "20px 24px", borderRadius: 12, border: "1px solid #e5e7eb",
                  cursor: "pointer", transition: "all 0.15s ease",
                  background: "#ffffff", textDecoration: "none", color: "inherit",
                  display: "flex", flexDirection: "column",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = "#6366f1";
                  (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 4px 16px rgba(99,102,241,0.1)";
                  (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = "#e5e7eb";
                  (e.currentTarget as HTMLAnchorElement).style.boxShadow = "none";
                  (e.currentTarget as HTMLAnchorElement).style.transform = "none";
                }}
              >
                {article.category && (
                  <span style={{
                    fontSize: 11, fontWeight: 600, color: "#6366f1",
                    background: "#eef2ff", padding: "3px 8px", borderRadius: 6,
                    display: "inline-block", marginBottom: 10, width: "fit-content",
                  }}>
                    {article.category}
                  </span>
                )}
                <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600, color: "#111827" }}>
                  {article.title}
                </h3>
                {article.excerpt && (
                  <p style={{ margin: "0 0 12px", fontSize: 14, color: "#6b7280", lineHeight: 1.5, flex: 1 }}>
                    {article.excerpt.length > 120 ? article.excerpt.slice(0, 120) + "..." : article.excerpt}
                  </p>
                )}
                <span style={{ fontSize: 13, color: "#6366f1", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                  Read more <ChevronRight size={14} />
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid #e5e7eb", padding: "20px 32px", textAlign: "center", background: "#ffffff" }}>
        <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>
          Powered by <span style={{ fontWeight: 600, color: "#6366f1" }}>Parallly</span>
        </p>
      </footer>
    </div>
  );
}
