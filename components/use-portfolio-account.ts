"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PortfolioAccount } from "@/lib/portfolio";

const POLL_DELAY_MS = 15_000;

export function usePortfolioAccount() {
  const [account, setAccount] = useState<PortfolioAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const activeRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refreshAccount = useCallback(async function refresh() {
    if (!activeRef.current) return;
    clearTimeout(timerRef.current);
    // An order refresh supersedes an older poll so a late pre-order snapshot
    // cannot restore the old cash balance or positions.
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    let continuePolling = true;

    try {
      const response = await fetch("/api/account", {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      });
      if (!activeRef.current || controller.signal.aborted) return;
      if (response.status === 401) {
        continuePolling = false;
        setAccount(null);
        setSignedOut(true);
        setError("Your session has ended. Sign in to view your portfolio.");
        return;
      }
      if (!response.ok) throw new Error("Account unavailable.");

      const result: PortfolioAccount = await response.json();
      if (!activeRef.current || controller.signal.aborted || requestRef.current !== controller) return;
      setAccount(result);
      setError(null);
      setSignedOut(false);
    } catch {
      if (!activeRef.current || controller.signal.aborted || requestRef.current !== controller) return;
      setError("Unable to refresh your portfolio. Retrying automatically.");
    } finally {
      // One request at a time for the entire portfolio, regardless of holdings.
      // A failed request also settles before another poll is scheduled.
      if (activeRef.current && requestRef.current === controller && continuePolling) {
        timerRef.current = setTimeout(refresh, POLL_DELAY_MS);
      }
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    timerRef.current = setTimeout(() => { void refreshAccount(); }, 0);
    return () => {
      activeRef.current = false;
      clearTimeout(timerRef.current);
      requestRef.current?.abort();
    };
  }, [refreshAccount]);

  return { account, error, signedOut, refreshAccount };
}
