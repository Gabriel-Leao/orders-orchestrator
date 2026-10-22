import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.validation';
import {
  PermanentEnrichmentError,
  RetryableEnrichmentError,
} from '../enrichment.errors';
import { ExchangeRate, ExchangeRateClient } from './exchange-rate.client';

interface FrankfurterBody {
  date?: unknown;
  rates?: Record<string, unknown>;
}

@Injectable()
export class FrankfurterExchangeRateClient implements ExchangeRateClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config
      .getOrThrow<string>('EXCHANGE_API_URL')
      .replace(/\/+$/, '');
    this.timeoutMs = config.getOrThrow<number>('EXTERNAL_TIMEOUT_MS');
  }

  async getRate(from: string, to: string): Promise<ExchangeRate> {
    const url = `${this.baseUrl}/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const cause = error as Error;
      throw new RetryableEnrichmentError(
        `Exchange API unreachable or timed out (${cause.name}: ${cause.message})`,
        { cause },
      );
    }

    if (response.status === 429 || response.status >= 500) {
      await this.discard(response);
      throw new RetryableEnrichmentError(
        `Exchange API responded with ${response.status}`,
      );
    }

    if (!response.ok) {
      await this.discard(response);
      throw new PermanentEnrichmentError(
        `Exchange API rejected ${from}->${to} with ${response.status}`,
      );
    }

    let body: FrankfurterBody;
    try {
      body = (await response.json()) as FrankfurterBody;
    } catch (error) {
      throw new RetryableEnrichmentError(
        'Exchange API returned an invalid JSON body',
        { cause: error },
      );
    }

    const rate = body.rates?.[to];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new PermanentEnrichmentError(
        `Exchange API has no rate for ${from}->${to}`,
      );
    }

    const date =
      typeof body.date === 'string'
        ? body.date
        : new Date().toISOString().slice(0, 10);

    return { rate, date };
  }

  private async discard(response: Response): Promise<void> {
    try {
      await response.body?.cancel();
    } catch (error: unknown) {
      const cause = error instanceof Error ? error : new Error(String(error));

      throw new RetryableEnrichmentError(
        `Exchange API unreachable or timed out (${cause.name}: ${cause.message})`,
        { cause },
      );
    }
  }
}
