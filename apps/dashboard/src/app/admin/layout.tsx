"use client";

import Sidebar from "@/components/Sidebar";
import { useState } from "react";

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div style={{ display: "flex", minHeight: "100vh" }}>
            <Sidebar />
            <main
                style={{
                    flex: 1,
                    marginLeft: 260,
                    padding: "32px 40px",
                    transition: "margin-left 0.3s ease",
                    maxWidth: "100%",
                    overflow: "auto",
                }}
            >
                {children}
            </main>
        </div>
    );
}
