"use client";

import { useState, type RefObject } from "react";
import type { Market } from "@/lib/market";

export default function BuyControls({ market, disabled, onAccountRefresh, submissionRef, onPendingChange }: {
  market: Market;
  disabled: boolean;
  onAccountRefresh: () => Promise<void>;
  submissionRef: RefObject<boolean>;
  onPendingChange: (pending: boolean) => void;
}) {
  const [notional, setNotional] = useState("10");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function buy(side: "YES" | "NO") {
    if (submissionRef.current || disabled || !market.isTradable) return;
    const amount = Number(notional);
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(notional)) {
      setMessage("Enter a positive USD amount with at most two decimal places.");
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
        setMessage(result.error || "Order failed.");
        return;
      }
      setMessage(`Bought ${result.order.quantity} ${side} at $${result.order.fillPrice}.`);
      await onAccountRefresh();
    } catch {
      setMessage("The result could not be confirmed. Check your account before submitting again.");
      await onAccountRefresh();
    } finally {
      submissionRef.current = false;
      onPendingChange(false);
      setPending(false);
    }
  }

  return (
    <div>
      <label>
        Notional (USD){" "}
        <input type="number" min="0.01" step="0.01" value={notional}
          disabled={pending || disabled || !market.isTradable}
          onChange={(event) => setNotional(event.target.value)} />
      </label>{" "}
      <button type="button" disabled={pending || disabled || !market.isTradable || !market.yesPrice}
        onClick={() => void buy("YES")}>Buy YES</button>{" "}
      <button type="button" disabled={pending || disabled || !market.isTradable || !market.noPrice}
        onClick={() => void buy("NO")}>Buy NO</button>
      {pending && <p role="status">Submitting…</p>}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
