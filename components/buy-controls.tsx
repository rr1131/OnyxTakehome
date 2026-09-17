"use client";

import { useId, useState, type RefObject } from "react";
import type { Market } from "@/lib/market";

export default function BuyControls({ market, disabled, onAccountRefresh, submissionRef, onPendingChange }: {
  market: Market;
  disabled: boolean;
  onAccountRefresh: () => Promise<void>;
  submissionRef: RefObject<boolean>;
  onPendingChange: (pending: boolean) => void;
}) {
  const notionalId = useId();
  const [notional, setNotional] = useState("10");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function buy(side: "YES" | "NO") {
    if (submissionRef.current || disabled || !market.isTradable) return;
    const amount = Number(notional);
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(notional)) {
      setMessage({ text: "Enter a positive USD amount with at most two decimal places.", error: true });
      return;
    }
    submissionRef.current = true;
    onPendingChange(true);
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketId: market.id, side, notional: amount }),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage({ text: result.error || "Your order could not be completed. Please try again.", error: true });
        return;
      }
      setMessage({ text: `Bought ${result.order.quantity} ${side} at $${result.order.fillPrice}.`, error: false });
      await onAccountRefresh();
    } catch {
      setMessage({ text: "The result could not be confirmed. Check your account before submitting again.", error: true });
      await onAccountRefresh();
    } finally {
      submissionRef.current = false;
      onPendingChange(false);
      setPending(false);
    }
  }

  return (
    <div className="buy-controls" aria-busy={pending}>
      <div className="buy-notional">
        <label htmlFor={notionalId}>Amount (USD)</label>
        <input id={notionalId} type="number" inputMode="decimal" min="0.01" step="0.01" value={notional}
          disabled={pending || disabled || !market.isTradable}
          aria-describedby={message ? `${notionalId}-message` : undefined}
          onChange={(event) => setNotional(event.target.value)} />
      </div>
      <div className="buy-actions">
        <button className="button" type="button" disabled={pending || disabled || !market.isTradable || !market.yesPrice}
          onClick={() => void buy("YES")}>Buy YES</button>
        <button className="button button-secondary" type="button" disabled={pending || disabled || !market.isTradable || !market.noPrice}
          onClick={() => void buy("NO")}>Buy NO</button>
      </div>
      {pending && <p className="order-message" role="status">Submitting paper order…</p>}
      {message && (
        <p id={`${notionalId}-message`} className={`order-message ${message.error ? "order-error" : "order-success"}`}
          role={message.error ? "alert" : "status"}>{message.text}</p>
      )}
    </div>
  );
}
