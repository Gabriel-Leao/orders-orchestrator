export interface WaitForOptions {
  timeoutMs?: number;
  intervalMs?: number;
  description?: string;
}

/**
 * Faz polling até a sonda devolver um valor "truthy". Substitui sleeps fixos:
 * o teste só espera o necessário e falha com uma mensagem útil no timeout.
 */
export async function waitFor<T>(
  probe: () =>
    Promise<T | null | undefined | false> | T | null | undefined | false,
  {
    timeoutMs = 10_000,
    intervalMs = 50,
    description = 'condição',
  }: WaitForOptions = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const suffix = lastError
    ? ` (último erro: ${(lastError as Error).message})`
    : '';
  throw new Error(
    `Timeout de ${timeoutMs}ms esperando ${description}${suffix}`,
  );
}
