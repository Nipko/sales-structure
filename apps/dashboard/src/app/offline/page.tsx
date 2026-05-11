"use client";

export default function OfflinePage() {
    return (
        <div style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--bg-primary, #0a0a12)",
            color: "var(--text-primary, #e8e8f0)",
            fontFamily: "Inter, system-ui, sans-serif",
            padding: 24,
            textAlign: "center",
        }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>&#128268;</div>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Sin conexión</h1>
            <p style={{ fontSize: 15, color: "var(--text-secondary, #9898b0)", maxWidth: 400, lineHeight: 1.6 }}>
                No se pudo conectar al servidor. Verifica tu conexión a internet e intenta de nuevo.
            </p>
            <button
                onClick={() => window.location.reload()}
                style={{
                    marginTop: 24,
                    padding: "10px 24px",
                    background: "var(--accent, #6c5ce7)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                }}
            >
                Reintentar
            </button>
        </div>
    );
}
