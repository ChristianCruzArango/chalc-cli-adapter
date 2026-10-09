// lib/terminals.mjs — lanzador de terminales del modo workspace (spec 005, R12–R13).
// Responsabilidad única: abrir UNA ventana con una pestaña por workspace (título NNN-slug,
// ubicada en su carpeta) y escribir el script `open-all` para reabrirlas después. NUNCA ejecuta
// agentes en las pestañas: el usuario escribe el comando (`claude`, `codex`…) él mismo.

import { spawn } from 'node:child_process';
import { t } from './i18n.mjs';

// Shell de los paneles de trabajo: cmd, no el perfil PowerShell por defecto de wt — los CLIs de
// agentes (`claude`, `codex`…) del usuario funcionan en cmd y no en ese perfil.
const PANE_SHELL = 'cmd';

// Los ids y las carpetas vienen de nombres de rama y de rutas: son DATOS. En un script se citan con
// comillas SIMPLES, que ni sh ni PowerShell expanden (`$()`, comilla invertida); y `;`, que `wt` usa
// para separar subcomandos incluso dentro de un argumento, se escapa como `\;`.
const wtText = (value) => String(value).replace(/;/g, '\\;');
const psQuote = (value) => `'${wtText(value).replace(/'/g, "''")}'`;
const shQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

// Args de Windows Terminal: UNA ventana con todos los workspaces VISIBLES A LA VEZ — el primero
// abre la ventana (`nt`) y cada siguiente es un panel (`sp`, split-pane; wt reparte el espacio
// solo), no pestañas que haya que ir cambiando. workspaces = [{ id, dir }]. Puro, testeable.
export function wtArgs(workspaces) {
  return workspaces.flatMap(({ id, dir }, i) =>
    (i === 0 ? ['nt'] : [';', 'sp']).concat(['--title', wtText(id), '-d', wtText(dir), PANE_SHELL]));
}

// Script para reabrir las terminales (R13). En Windows: PowerShell llamando a wt (el separador
// ';' va escapado con backtick para que PowerShell no lo interprete). En otros SO no hay wt:
// el script lista los workspaces para abrirlos a mano (sin fallar en ningún caso).
// Los comentarios del script son texto visible al usuario: van por t() (paridad es/en).
export function openAllScript(workspaces, platform = process.platform) {
  if (platform === 'win32') {
    const panes = workspaces.map(({ id, dir }, i) => `${i === 0 ? 'nt' : 'sp'} --title ${psQuote(id)} -d ${psQuote(dir)} ${PANE_SHELL}`).join(' `; ');
    return {
      name: 'open-all.ps1',
      content: [`# chalc — ${t('termOpenAllPs1')}`, `wt ${panes}`, ''].join('\n')
    };
  }
  const lines = workspaces.map(({ id, dir }) => `printf '%s\\n' ${shQuote(`${id}  ->  ${dir}`)}`);
  return {
    name: 'open-all.sh',
    content: ['#!/bin/sh', `# chalc — ${t('termOpenAllSh')}`, ...lines, ''].join('\n')
  };
}

// Vista viva en ventana aparte (spec 006, R10): una ventana wt con un ÚNICO panel corriendo el
// comando del dashboard — la terminal donde el usuario ejecutó el comando queda libre. Puro.
export function dashboardWindowArgs(dashboardCmd) {
  return ['nt', '--title', 'dashboard', ...dashboardCmd];
}

// Puesto de mando (spec 006, R11): UNA ventana con layout fijo — el dashboard vivo ocupa un
// lado completo (mitad de la ventana) y los workspaces se apilan en el otro a partes iguales.
// El primer workspace divide en vertical (-V, columnas) cediendo la mitad; cada siguiente parte
// en horizontal (-H) el panel recién creado, con un tamaño que deja la pila en fracciones
// iguales: el split k-ésimo cede (restantes)/(restantes+1) — p.ej. 3 workspaces → 2/3 y luego
// 1/2 = tercios exactos. Ningún panel de trabajo lleva comando (el agente lo escribe el usuario).
export function commandCenterArgs(dashboardCmd, workspaces) {
  const n = workspaces.length;
  return ['nt', '--title', 'dashboard', ...dashboardCmd]
    .concat(workspaces.flatMap(({ id, dir }, i) => {
      const size = String(Math.round(((n - i) / (n - i + 1)) * 100) / 100);
      return [';', 'sp', i === 0 ? '-V' : '-H', '-s', i === 0 ? '0.5' : size, '--title', wtText(id), '-d', wtText(dir), PANE_SHELL];
    }));
}

// Lanza la ventana con todas las pestañas (R12). Solo win32 (Windows Terminal); en otros SO no
// intenta nada (queda el script, R13). spawnImpl inyectable para testear sin abrir ventanas.
// Espera a saber si wt arrancó (R34, como el dashboard en C-08): el ENOENT llega como evento, y antes
// se devolvía `ok: true` aunque Windows Terminal no estuviera instalado.
export async function launchTerminals(workspaces, { platform = process.platform, spawnImpl = spawn } = {}) {
  if (platform !== 'win32' || !workspaces.length) return { ok: false, launched: 0 };
  if (!(await launchDetached('wt', wtArgs(workspaces), { spawnImpl }))) return { ok: false, launched: 0, reason: 'wt-missing' };
  return { ok: true, launched: workspaces.length };
}

// Lanza `cmd` desacoplado y dice si DE VERDAD arrancó (C-08). Si el binario no existe, spawn no lanza:
// el ENOENT llega después como evento `error`. Se espera `spawn` o `error` antes de decidir; un fallo
// síncrono también cuenta como no arrancado. spawnImpl inyectable para testear sin abrir ventanas.
export function launchDetached(cmd, args, { spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawnImpl(cmd, args, { detached: true, stdio: 'ignore' }); } catch { resolve(false); return; }
    child.once('spawn', () => { child.unref(); resolve(true); });
    child.once('error', () => resolve(false));
  });
}
