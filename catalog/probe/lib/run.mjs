// run.mjs — ejecutar una sonda (spec 041, R1, R5). Responsabilidad ÚNICA: hacer la petición o correr el comando,
// con plazo, y devolver en qué difiere de lo esperado. Razón de cambio: cómo se ejecuta una sonda.
//
// Este archivo lo emite chalc dentro de `.chalc/probe/lib/`. No edites aquí: se regenera al equipar el repo.
//
// Se sondea el servicio LEVANTADO, no su código: es lo que usará quien lo consuma. Nada espera para siempre: un
// servicio caído o un comando que no termina es una sonda que falla, no un proceso colgado.

import { spawn } from 'node:child_process';
import { apiMismatches, cliMismatches } from './expect.mjs';

export const DEFAULT_TIMEOUT_MS = 10000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** ¿Es `url` una dirección HTTP de esta máquina? */
export function localUrl(url) {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && LOCAL_HOSTS.has(parsed.hostname);
  } catch { return false; }
}

const result = (probe, kind, mismatches) => ({ name: probe.name, kind, ok: mismatches.length === 0, mismatches });

// El cuerpo tal como viaja: un objeto va como JSON, con su cabecera si no se declaró otra.
function requestOf(probe, signal) {
  const asJson = probe.body !== undefined && typeof probe.body !== 'string';
  return {
    method: probe.method, signal, redirect: 'manual',
    headers: { ...(asJson ? { 'content-type': 'application/json' } : {}), ...probe.headers },
    body: probe.body === undefined ? undefined : asJson ? JSON.stringify(probe.body) : probe.body
  };
}

/** Ejecuta una sonda de API. Devuelve { name, kind, ok, mismatches }; nunca lanza. */
export async function runApi(probe, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(probe.url, requestOf(probe, controller.signal));
    return result(probe, 'api', apiMismatches(probe.expect, { status: response.status, body: await response.text() }));
  } catch (error) {
    const detail = error?.name === 'AbortError' ? `no response in ${timeoutMs} ms` : String(error?.message || error);
    return result(probe, 'api', [{ what: 'request', expected: 'response', actual: detail }]);
  } finally { clearTimeout(timer); }
}

// Corre `command` en `cwd` y devuelve { exit, stdout, stderr }, o { timedOut } si agota el plazo.
function execute(command, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = { stdout: '', stderr: '' };
    child.stdout.on('data', (chunk) => { output.stdout += chunk; });
    child.stderr.on('data', (chunk) => { output.stderr += chunk; });
    // Al vencer se resuelve YA: en Windows un nieto puede retener las tuberías aunque el hijo haya muerto.
    const timer = setTimeout(() => { child.kill(); resolve({ timedOut: true }); }, timeoutMs);
    const done = (exit) => { clearTimeout(timer); resolve({ exit, ...output }); };
    child.on('error', () => done(127));
    child.on('close', (code) => done(code ?? 1));
  });
}

/** Ejecuta una sonda de CLI en `cwd`. Devuelve { name, kind, ok, mismatches }; nunca lanza. */
export async function runCli(probe, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const ran = await execute(probe.command, { cwd, timeoutMs });
  if (ran.timedOut) return result(probe, 'cli', [{ what: 'timeout', expected: 'exit', actual: `no exit in ${timeoutMs} ms` }]);
  return result(probe, 'cli', cliMismatches(probe.expect, ran));
}
