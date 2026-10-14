// lib/airetry.mjs — reintentos del cliente de IA (F6).
// Responsabilidad única: repetir una llamada que falló por algo PASAJERO (408, 429, 5xx o un error de
// red) con espera creciente, sin reintentar nunca lo que no va a cambiar (400, 401, modelo inválido)
// ni lo que el usuario canceló (Ctrl+C). Así un 429 en la tercera llamada de `feature` no tira las
// dos anteriores ya pagadas.

export const RETRY_DELAYS_MS = [500, 1500];

// Error de API con su status HTTP, para poder decidir si se reintenta.
export function apiError(message, status) {
  return Object.assign(new Error(message), { status });
}

// 408/429/5xx, o un fallo de red de `fetch` (TypeError «fetch failed»). El plazo propio (netTimeout)
// no se reintenta: triplicaría una espera de minutos.
export function isRetryable(err) {
  const status = err?.status;
  if (typeof status === 'number') return status === 408 || status === 429 || status >= 500;
  return err instanceof TypeError;
}

// Espera `ms` o hasta que aborten la señal (entonces rechaza con el motivo del aborto).
export function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(signal.reason); }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// Ejecuta `call` con hasta `delays.length` reintentos. `sleep` es inyectable para testear sin esperar.
export async function withRetry(call, { signal, delays = RETRY_DELAYS_MS, sleep = abortableSleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (signal?.aborted || attempt >= delays.length || !isRetryable(err)) throw err;
      await sleep(delays[attempt], signal);
      if (signal?.aborted) throw signal.reason ?? err;
    }
  }
}
