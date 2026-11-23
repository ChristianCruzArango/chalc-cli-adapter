// measure.mjs — medir páginas (spec 039, R1, R4, R5). Responsabilidad ÚNICA: recorrer cada URL en cada ancho del
// contrato y traer sus medidas y su captura. Razón de cambio: qué se le pide al navegador.
//
// Este archivo lo emite chalc dentro de `.chalc/design/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Recibe una sesión ya abierta (la real, o una de mentira en los tests): aquí no se lanza ningún navegador.

import { PROBE } from './probe.mjs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** ¿Es `url` una página de esta máquina? Solo esas se miden sin pedirlo expresamente. */
export function localOnly(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') return true;
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && LOCAL_HOSTS.has(parsed.hostname);
  } catch { return false; }
}

const failure = (url, detail) => new Error(`${url}: ${detail}`);

// Una página en un ancho: fija la vista, carga, mide y captura.
async function measureOne(session, sessionId, { url, view }) {
  await session.send('Emulation.setDeviceMetricsOverride', { width: view.width, height: view.height, deviceScaleFactor: 1, mobile: false }, sessionId);
  // La espera de la carga se arma ANTES de navegar: si no, una página rápida ya habría avisado.
  const loaded = session.once('Page.loadEventFired', sessionId);
  loaded.catch(() => {});
  const navigation = await session.send('Page.navigate', { url }, sessionId);
  if (navigation.errorText) throw failure(url, navigation.errorText);
  await loaded.catch((error) => { throw failure(url, error.message); });
  const probed = await session.send('Runtime.evaluate', { expression: PROBE, returnByValue: true }, sessionId);
  if (probed.exceptionDetails) throw failure(url, probed.exceptionDetails.text || 'probe failed');
  if (!Array.isArray(probed.result?.value)) throw failure(url, 'the probe returned no elements');
  const shot = await session.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  return { width: view.width, height: view.height, url, elements: probed.result.value, screenshot: Buffer.from(shot.data || '', 'base64') };
}

/** Las medidas de `urls` en cada vista de `viewports`: { viewports: [{ name, width, height, url, elements, screenshot }] }. */
export async function measurePages(session, { urls, viewports }) {
  const { targetId } = await session.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await session.send('Target.attachToTarget', { targetId, flatten: true });
  await session.send('Page.enable', {}, sessionId);
  const measured = [];
  for (const url of urls) {
    for (const view of viewports) {
      // Con una sola página basta el nombre de la vista; con varias, cada una dice de cuál es.
      const name = urls.length > 1 ? `${view.name} · ${url}` : view.name;
      measured.push({ name, ...await measureOne(session, sessionId, { url, view }) });
    }
  }
  return { viewports: measured };
}
