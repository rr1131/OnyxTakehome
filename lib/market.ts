// Application contract shared with the browser; no provider response types.
export type Market = {
  id: string;
  symbol: string;
  title: string;
  sport: string;
  status: string;
  expiresAt: string;
  yesPrice: number | null;
  noPrice: number | null;
  isTradable: boolean;
};

export type MarketFilters = {
  sport?: string;
  status?: string;
  eventType?: string;
  contractType?: string;
  periodType?: string;
};

export type MarketPage = {
  markets: Market[];
  limit: number;
  offset: number;
  hasMore: boolean;
};

export const DEFAULT_MARKET_PAGE_SIZE = 20;
export const MAX_MARKET_PAGE_SIZE = 100;
