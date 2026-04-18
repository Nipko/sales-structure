"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Calendar, Clock, BookOpen } from "lucide-react";

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

export default function KBArticlePage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string;
  const slug = params?.slug as string;

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const tenantName = tenantSlug
    ? tenantSlug.charAt(0).toUpperCase() + tenantSlug.slice(1).replace(/-/g, " ")
    : "";

  useEffect(() => {
    if (!tenantSlug || !slug) return;
    setLoading(true);
    fetch(`${API_URL}/knowledge/public/${tenantSlug}/articles/${slug}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.data) setArticle(data.data);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [tenantSlug, slug]);

  // Simple markdown-like rendering (bold, links, headings, lists)
  const renderContent = (text: string) => {
    return text
      .replace(/^### (.+)$/gm, '<h3 style="font-size:18px;font-weight:700;margin:24px 0 8px;color:#111827">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 style="font-size:20px;font-weight:700;margin:28px 0 10px;color:#111827">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 style="font-size:24px;font-weight:700;margin:32px 0 12px;color:#111827">$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '<li style="margin-left:20px;list-style:disc;margin-bottom:4px">$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li style="margin-left:20px;list-style:decimal;margin-bottom:4px">$2</li>')
      .replace(/\n\n/g, '<br/><br/>')
      .replace(/\n/g, '<br/>');
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 32, height: 32, border: "3px solid #e5e7eb", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (error || !article) {
    return (
      <div style={{
        minHeight: "100vh", background: "#ffffff", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}>
        <BookOpen size={48} color="#d1d5db" />
        <h2 style={{ margin: "16px 0 8px", fontSize: 20, fontWeight: 700, color: "#111827" }}>Article not found</h2>
        <Link href={`/kb/${tenantSlug}`} style={{ color: "#6366f1", fontSize: 14, textDecoration: "none" }}>
          Back to Help Center
        </Link>
      </div>
    );
  }

  const readingTime = Math.max(1, Math.ceil((article.content?.length || 0) / 1200));

  return (
    <div style={{
      minHeight: "100vh", background: "#ffffff", color: "#1a1a2e",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      {/* Header */}
      <header style={{
        borderBottom: "1px solid #e5e7eb", padding: "14px 32px",
        display: "flex", alignItems: "center", gap: 16, background: "#fafafa",
      }}>
        <Link href={`/kb/${tenantSlug}`} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "none", border: "1px solid #d1d5db", borderRadius: 8,
          padding: "6px 14px", cursor: "pointer", fontSize: 13, color: "#374151",
          textDecoration: "none",
        }}>
          <ChevronLeft size={14} /> Back
        </Link>
        <span style={{ fontSize: 14, color: "#6b7280" }}>{tenantName} Help Center</span>
      </header>

      {/* Article */}
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px 80px" }}>
        {article.category && (
          <span style={{
            fontSize: 12, fontWeight: 600, color: "#6366f1", textTransform: "uppercase",
            letterSpacing: 0.5, marginBottom: 12, display: "inline-block",
            background: "#eef2ff", padding: "4px 10px", borderRadius: 6,
          }}>
            {article.category}
          </span>
        )}

        <h1 style={{ margin: "0 0 16px", fontSize: 32, fontWeight: 800, color: "#111827", lineHeight: 1.2 }}>
          {article.title}
        </h1>

        {article.excerpt && (
          <p style={{ margin: "0 0 20px", fontSize: 17, color: "#6b7280", lineHeight: 1.5 }}>
            {article.excerpt}
          </p>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32, paddingBottom: 24, borderBottom: "1px solid #e5e7eb" }}>
          {article.published_at && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#9ca3af" }}>
              <Calendar size={13} />
              {new Date(article.published_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            </span>
          )}
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#9ca3af" }}>
            <Clock size={13} />
            {readingTime} min read
          </span>
        </div>

        <div
          style={{ fontSize: 16, lineHeight: 1.8, color: "#374151", wordBreak: "break-word" }}
          dangerouslySetInnerHTML={{ __html: renderContent(article.content || '') }}
        />
      </main>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid #e5e7eb", padding: "20px 32px", textAlign: "center" }}>
        <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>
          Powered by <span style={{ fontWeight: 600, color: "#6366f1" }}>Parallly</span>
        </p>
      </footer>
    </div>
  );
}
