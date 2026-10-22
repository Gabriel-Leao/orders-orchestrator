export interface ExchangeRate {
  rate: number;
  date: string;
}

export interface ExchangeRateClient {
  getRate(from: string, to: string): Promise<ExchangeRate>;
}

export const EXCHANGE_RATE_CLIENT = Symbol('EXCHANGE_RATE_CLIENT');
