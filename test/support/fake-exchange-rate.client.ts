import type {
  ExchangeRate,
  ExchangeRateClient,
} from '../../src/enrichment/clients/exchange-rate.client';
import { RetryableEnrichmentError } from '../../src/enrichment/enrichment.errors';

/**
 * Substitui o provider EXCHANGE_RATE_CLIENT nos testes de integração.
 * Controlável: taxa, falhas roteirizadas e uma "trava" que segura o job em
 * PROCESSING para observar o estado intermediário de forma determinística.
 */
export class FakeExchangeRateClient implements ExchangeRateClient {
  readonly calls: Array<{ from: string; to: string }> = [];

  private rate = 5;
  private date = '2026-10-20';
  private failuresLeft = 0;
  private alwaysError: Error | null = null;
  private nextError: Error = new RetryableEnrichmentError('falha simulada');
  private gate: Promise<void> | null = null;

  reset(): void {
    this.calls.length = 0;
    this.rate = 5;
    this.date = '2026-10-20';
    this.failuresLeft = 0;
    this.alwaysError = null;
    this.gate = null;
  }

  setRate(rate: number, date = this.date): void {
    this.rate = rate;
    this.date = date;
  }

  /** As próximas `times` chamadas falham; depois volta a responder. */
  failTimes(times: number, error?: Error): void {
    this.failuresLeft = times;
    if (error) this.nextError = error;
  }

  /** Toda chamada falha com este erro. */
  failAlways(error: Error): void {
    this.alwaysError = error;
  }

  /** Segura as chamadas até o `release` devolvido ser executado. */
  hold(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => (release = resolve));
    return release;
  }

  async getRate(from: string, to: string): Promise<ExchangeRate> {
    this.calls.push({ from, to });

    if (this.gate) await this.gate;
    if (this.alwaysError) throw this.alwaysError;
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw this.nextError;
    }
    return { rate: this.rate, date: this.date };
  }
}
