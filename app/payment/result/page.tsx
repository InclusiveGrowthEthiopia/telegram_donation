"use client";

import { useEffect, useState } from "react";

export default function PaymentResult() {
  const [orderId, setOrderId] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("PENDING");
  const [amount, setAmount] = useState("");
  const [transactionId, setTransactionId] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOrderId(params.get("merch_order_id") || params.get("orderId") || "");
    setToken(params.get("token") || "");
  }, []);

  useEffect(() => {
    if (!orderId || !token) return;
    let stopped = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch(`/api/payments/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        const data = await response.json();
        if (stopped) return;
        setStatus(data.status || "PENDING");
        setAmount(data.amount || "");
        setTransactionId(data.transactionId || "");
        attempts += 1;
        if (data.status === "PENDING" && attempts < 12) timer = setTimeout(poll, 2500);
      } catch {
        attempts += 1;
        if (!stopped && attempts < 12) timer = setTimeout(poll, 2500);
      }
    };

    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [orderId, token]);

  const paid = status === "PAID";
  const failed = status === "FAILED" || status === "FAILURE";

  return (
    <main className="app-shell">
      <div className="container">
        <section className="card success">
          <div className="success-icon">{paid ? "✓" : failed ? "!" : "…"}</div>
          <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>
            {paid ? "Thank you for your donation" : failed ? "Payment was not completed" : "Confirming your payment…"}
          </h1>
          <p className="small">
            {paid ? `${amount} ETB has been confirmed by the payment system.` : failed ? "You can return to the donation page and try again." : "We are checking the server-side Telebirr payment status. Please keep this page open."}
          </p>
          {transactionId && <div className="order-id">Transaction: {transactionId}</div>}
          {orderId && <div className="order-id">Order: {orderId}</div>}
        </section>
      </div>
    </main>
  );
}
