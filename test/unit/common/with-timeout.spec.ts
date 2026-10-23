import { withTimeout } from '../../../src/common/utils/with-timeout';

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('devolve o valor quando a promise resolve antes do limite', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('propaga o erro original quando a promise rejeita antes do limite', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('falhou')), 1000),
    ).rejects.toThrow('falhou');
  });

  it('rejeita com mensagem informativa quando o limite estoura', async () => {
    const never = new Promise<never>(() => undefined);
    const result = withTimeout(never, 3000);
    const assertion = expect(result).rejects.toThrow(
      'Redis did not respond within 3000ms',
    );

    await jest.advanceTimersByTimeAsync(3000);

    await assertion;
  });

  it('não rejeita antes de o limite passar', async () => {
    let settled = false;
    const never = new Promise<never>(() => undefined);
    withTimeout(never, 3000).catch(() => (settled = true));

    await jest.advanceTimersByTimeAsync(2999);

    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it('usa o rótulo informado na mensagem', async () => {
    const result = withTimeout(
      new Promise<never>(() => undefined),
      10,
      'Postgres',
    );
    const assertion = expect(result).rejects.toThrow(
      'Postgres did not respond within 10ms',
    );

    await jest.advanceTimersByTimeAsync(10);

    await assertion;
  });

  it('limpa o timer quando a promise termina (não deixa timers pendentes)', async () => {
    await withTimeout(Promise.resolve(1), 5000);

    expect(jest.getTimerCount()).toBe(0);
  });
});
