import type { Market } from "./market";

// All persisted NUMERIC values and derived amounts are decimal strings.
export type AccountState = {
  userId: string;
  currency: "USD";
  balance: string;
  createdAt: string;
  updatedAt: string;
  positions: {
    marketId: string;
    outcome: "YES" | "NO";
    quantity: string;
    totalCost: string;
    averagePrice: string;
    createdAt: string;
    updatedAt: string;
  }[];
  orders: {
    id: string;
    marketId: string;
    outcome: "YES" | "NO";
    quantity: string;
    status: "filled";
    createdAt: string;
  }[];
  fills: {
    id: string;
    orderId: string;
    quantity: string;
    price: string;
    totalCost: string;
    createdAt: string;
  }[];
};

export type PortfolioPosition = AccountState["positions"][number] & {
  market: Market | null;
  side: "YES" | "NO";
  costBasis: string;
  averageEntry: string;
  currentSidePrice: string | null;
  currentValue: string | null;
  unrealizedPnl: string | null;
};

export type PortfolioAccount = Omit<AccountState, "positions"> & {
  positions: PortfolioPosition[];
  // Equity includes cash and only the positions with available marks.
  equity: string;
  // A partial portfolio does not have a complete total unrealized P&L.
  totalUnrealizedPnl: string | null;
  unpricedPositionCount: number;
  pricingUpdatedAt: string | null;
  pricingUnavailable: boolean;
};
