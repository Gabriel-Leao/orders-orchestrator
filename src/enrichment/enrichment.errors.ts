export class RetryableEnrichmentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RetryableEnrichmentError';
  }
}

export class PermanentEnrichmentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentEnrichmentError';
  }
}

export class OrderNotFoundError extends PermanentEnrichmentError {
  constructor(orderId: string) {
    super(`Order ${orderId} not found`);
    this.name = 'OrderNotFoundError';
  }
}
