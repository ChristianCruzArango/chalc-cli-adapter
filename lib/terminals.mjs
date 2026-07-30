// lib/terminals.mjs — lanzador de terminales del modo workspace (spec 005, R12–R13).
// Responsabilidad única: abrir UNA ventana con una pestaña por workspace (título NNN-slug,
// ubicada en su carpeta) y escribir el script `open-all` para reabrirlas después. NUNCA ejecuta
// agentes en las pestañas: el usuario escribe el comando (`claude`, `codex`…) él mismo.

import { spawn } from 'node:child_process';
import { t } from './i18n.mjs';

// Shell de los paneles de trabajo: cmd, no el perfil PowerShell por defecto de wt — los CLIs de
// agentes (`claude`, `codex`…) del usuario funcionan en cmd y no en ese perfil.
const PANE_SHELL = 'cmd';

// Args de Windows Terminal: UNA ventana con todos los workspaces VISIBLES A LA VEZ — el primero
// abre la ventana (`nt`) y cada siguiente es un panel (`sp`, split-pane; wt reparte el espacio
// solo), no pestañas que haya que ir cambiando. workspaces = [{ id, dir }]. Puro, testeable.
export function wtArgs(workspaces) {
  return workspaces.flatMap(({ id, dir }, i) =>
    (i === 0 ? ['nt'] : [';', 'sp']).concat(['--title', id, '-d', dir, PANE_SHELL]));
}

// Script para reabrir las terminales (R13). En Windows: PowerShell llamando a wt (el separador
// ';' va escapado con backtick para que PowerShell no lo interprete). En otros SO no hay wt:
// el script lista los workspaces para abrirlos a mano (sin fallar en ningún caso).
// Los comentarios del script son texto visible al usuario: van por t() (paridad es/en).
export function openAllScript(workspaces, platform = process.platform) {
  if (platform === 'win32') {
    const panes = workspaces.map(({ id, dir }, i) => `${i === 0 ? 'nt' : 'sp'} --title "${id}" -d "${dir}" ${PANE_SHELL}`).join(' `; ');
    return {
      name: 'open-all.ps1',
      content: [`# chalc — ${t('termOpenAllPs1')}`, `wt ${panes}`, ''].join('\n')
    };
  }
  const lines = workspaces.map(({ id, dir }) => `echo "${id}  ->  ${dir}"`);
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
      return [';', 'sp', i === 0 ? '-V' : '-H', '-s', i === 0 ? '0.5' : size, '--title', id, '-d', dir, PANE_SHELL];
    }));
}

// Lanza la ventana con todas las pestañas (R12). Solo win32 (Windows Terminal); en otros SO no
// intenta nada (queda el script, R13). spawnImpl inyectable para testear sin abrir ventanas.
export function launchTerminals(workspaces, { platform = process.platform, spawnImpl = spawn } = {}) {
  if (platform !== 'win32' || !workspaces.length) return { ok: false, launched: 0 };
  try {
    const child = spawnImpl('wt', wtArgs(workspaces), { detached: true, stdio: 'ignore', shell: false });
    if (child.on) child.on('error', () => { /* wt no instalado: queda el script (R13) */ });
    if (child.unref) child.unref();
    return { ok: true, launched: workspaces.length };
  } catch {
    return { ok: false, launched: 0 };
  }
}
