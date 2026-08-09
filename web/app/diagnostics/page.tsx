"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function DiagnosticsPage() {
  const [arkanStatus, setArkanStatus] = useState<any>(null);

  useEffect(() => {
    const fetchArkan = async () => {
      try {
        const res = await fetch("/api/arkan/status");
        if (res.ok) {
          const data = await res.json();
          setArkanStatus(data);
        } else {
          setArkanStatus(null);
        }
      } catch {
        setArkanStatus(null);
      }
    };
    fetchArkan();
    const interval = setInterval(fetchArkan, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main style={{ padding: "24px", fontFamily: "sans-serif", color: "#ccc", background: "#111", minHeight: "100vh" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <h1 style={{ color: "#fff", fontSize: "24px", margin: 0 }}>Hermes Diagnostics</h1>
        <Link href="/" style={{ padding: "8px 16px", background: "#333", color: "#fff", textDecoration: "none", borderRadius: "8px" }}>
          Voltar para Home
        </Link>
      </header>

      <section style={{ background: "rgba(0,0,0,0.5)", padding: "24px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.1)", fontSize: "14px", display: "grid", gap: "12px", maxWidth: "600px" }}>
        <div style={{ color: "#a855f7", fontWeight: "bold", marginBottom: "8px", fontSize: "16px" }}>Arkan Vault Status</div>
        
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Arkan Online:</span> 
          <strong style={{ color: arkanStatus?.arkanOnline ? "#4ade80" : "#fca5a5" }}>
            {arkanStatus ? (arkanStatus.arkanOnline ? "Yes" : "No") : "Buscando..."}
          </strong>
        </div>
        
        {arkanStatus && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>API Contract:</span> <strong style={{ color: arkanStatus.contractCompatible ? "#4ade80" : "#fca5a5" }}>{arkanStatus.contractCompatible ? "Compatible" : "Incompatible"}</strong></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Recall Available:</span> <strong style={{ color: arkanStatus.searchAvailable ? "#4ade80" : "#fca5a5" }}>{arkanStatus.searchAvailable ? "Yes" : "No"}</strong></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Endpoint Mode:</span> <strong>{arkanStatus.mode}</strong></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Health Latency:</span> <strong>{Math.round(arkanStatus.latencyMs)} ms</strong></div>
          </>
        )}
      </section>

      <p style={{ marginTop: "24px", opacity: 0.6 }}>Nota: Status detalhado da sessão do Wake/Gemini (frequência PCM, scores, latências dinâmicas) estão visíveis no próprio console do navegador na Home.</p>
    </main>
  );
}
