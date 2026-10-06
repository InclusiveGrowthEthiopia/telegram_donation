"use client";

import { useEffect, useMemo, useState } from "react";

const PRESETS = [100, 250, 500, 1000];

declare global {
  interface Window {
    Telegram?: { WebApp?: { ready: () => void; expand: () => void; initData: string; initDataUnsafe?: { user?: { first_name?: string } }; close?: () => void } };
  }
}

export default function Home() {
  const [amount, setAmount] = useState(250);
  const [custom, setCustom] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
  }, []);

  const selectedAmount = useMemo(() => {
    const n = Number(custom);
    return custom ? n : amount;
  }, [amount, custom]);

  async function donate() {
    setError("");
    if (!Number.isFinite(selectedAmount) || selectedAmount < 10) {
      setError("Please enter at least 10 ETB.");
      return;
    }
    setLoading(true);
    try {
      const initData = window.Telegram?.WebApp?.initData ?? "";
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initData,
          amount: selectedAmount,
          donorName: anonymous ? undefined : name,
          message,
          anonymous,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to start payment.");
      window.location.href = data.checkoutUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to start payment.");
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <div className="container">
        <section className="hero">
          <div className="logo"><span className="logo-mark">IG</span><span>Inclusive Growth</span></div>
          <h1>Support inclusive digital growth.</h1>
          <p>Your contribution helps expand opportunities for young people, communities and inclusive digital development in Ethiopia.</p>
        </section>

        <section className="card">
          <div style={{fontWeight:800, fontSize:18}}>Choose your contribution</div>
          <div className="amount-grid">
            {PRESETS.map((value) => (
              <button key={value} type="button" className={`amount-btn ${!custom && amount === value ? "active" : ""}`} onClick={() => { setAmount(value); setCustom(""); }}>
                {value.toLocaleString()} ETB
              </button>
            ))}
          </div>
          <label className="label" htmlFor="custom">Other amount (ETB)</label>
          <input id="custom" className="input" inputMode="decimal" placeholder="Enter amount" value={custom} onChange={(e) => setCustom(e.target.value)} />

          <label className="label" htmlFor="name">Name (optional)</label>
          <input id="name" className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} disabled={anonymous} />

          <label className="label" htmlFor="message">Message (optional)</label>
          <textarea id="message" className="textarea" placeholder="Leave a message of support" maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} />

          <label className="row" style={{marginTop:14, fontSize:13}}>
            <input className="checkbox" type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            Make my donation anonymous
          </label>

          {error && <div className="error">{error}</div>}
          <button className="donate-btn" disabled={loading} onClick={donate}>
            {loading ? <><span className="spinner" />Opening Telebirr…</> : `Donate ${Number.isFinite(selectedAmount) ? selectedAmount.toLocaleString() : ""} ETB`}
          </button>
          <div className="notice">Payments are processed by Telebirr. Your donation is recorded only after server-side payment confirmation.</div>
        </section>
      </div>
    </main>
  );
}
