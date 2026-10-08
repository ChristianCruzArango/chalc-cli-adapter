// lib/commands/aiteam.mjs — el EQUIPO de modelos: qué modelo ocupa cada puesto del CLI (líder,
// desarrollador, revisor) y los dos que discuten en `chalc debate`, más el selector de modelo común.

import { t } from '../i18n.mjs';
import { PROVIDERS, isConfigured, listModels, loadConfig, saveConfig } from '../ai.mjs';
import { c } from './context.mjs';

// Selector de UN modelo sobre un proveedor dado: lista los instalados si es local (flechas + "otro
// nombre…"); texto libre con default si es cloud. Reutilizado por los paquetes cli/spec/qa/repair.
export async function pickModelOn(prompter, { provider, baseURL, label, current }) {
  const prov = PROVIDERS[provider];
  const installed = prov?.needsKey ? [] : await listModels({ provider, baseURL });
  if (installed.length) {
    const mi = Math.max(0, installed.indexOf(current));
    const pick = await prompter.select(label, [...installed.map((m) => ({ label: m })), { label: t('aiModelOther') }], mi);
    return pick < installed.length ? installed[pick] : ((await prompter.text(t('aiModelQ', current) + ':')).trim() || current);
  }
  return (await prompter.text(label + ` [${current}]:`)).trim() || current;
}

// ---------- dónde corre UN puesto y con qué modelo ----------
// El puesto se queda en el proveedor base (se guarda el nombre del modelo, un string) o se va a otro
// proveedor con su propia key ({provider, model, apiKey}). Lo comparten el equipo del cli y los
// participantes del debate: es la misma pregunta hecha para puestos distintos, y duplicarla dejaría
// que una de las dos copias se olvide de, por ejemplo, no cruzar la key entre servicios.
// `roleKeys` acumula las keys ya tecleadas por proveedor en esta pasada: no pedir la misma tres veces.
export async function pickRoleTarget(prompter, { cfg, name, prev, roleKeys = {} }) {
  const ids = Object.keys(PROVIDERS);
  const provider = cfg.provider;
  const prevObj = prev && typeof prev === 'object' ? prev : null;
  const others = ids.filter((id) => id !== provider);

  const where = await prompter.select(t('aiRoleWhereQ', name), [
    { label: t('aiRoleSameProv', provider) },
    ...others.map((id) => ({ label: `${id} — ${PROVIDERS[id].label}` }))
  ], prevObj ? Math.max(0, others.indexOf(prevObj.provider) + 1) : 0);

  if (where === 0) {
    return pickModelOn(prompter, {
      provider, baseURL: cfg.baseURL,
      label: t('aiRoleModelQ', name), current: (typeof prev === 'string' && prev) || cfg.model
    });
  }

  const rid = others[where - 1];
  const rprov = PROVIDERS[rid];
  const saved = prevObj?.provider === rid ? prevObj : {};   // reconfigurar conserva key/modelo previos del MISMO proveedor
  const entry = { provider: rid };
  if (rprov.needsBaseURL) entry.baseURL = (await prompter.text(t('aiBaseUrlQ') + ':')).trim() || saved.baseURL || '';
  if (rprov.needsKey) {
    const reuse = roleKeys[rid] || saved.apiKey || (rid === cfg.provider ? cfg.apiKey : '') || '';
    entry.apiKey = (await prompter.secret(t('aiRoleKeyQ', rid) + ':')) || reuse;
    roleKeys[rid] = entry.apiKey;
  }
  entry.model = await pickModelOn(prompter, {
    provider: rid, baseURL: entry.baseURL,
    label: t('aiRoleModelQ', name), current: saved.model || rprov.defaultModel
  });
  return entry;
}

// ---------- chalc config-ia debate — los DOS que discuten tu idea (spec 014, R1) ----------
// Se guardan en el mismo almacén que los roles del cli (`cli.roles.debateA/debateB`) para heredar el
// re-anclaje al cambiar de proveedor base y el descarte de modelos que allí ya no existen (D3).
export async function configureAiDebate(prompter) {
  const cfg = await loadConfig();
  if (!isConfigured(cfg)) { console.error(c.red('✗ ' + t('aiNotBaseConfigured'))); return; }
  console.log(c.dim('  ' + t('debateIntro')) + '\n');

  const prevRoles = cfg.cli?.roles || {};
  const roleKeys = {};
  const roles = {};
  const PUESTOS = [
    { key: 'debateA', title: t('debateSideA'), stance: t('debateStanceProponent'), icon: '🅰️ ', paint: c.green },
    { key: 'debateB', title: t('debateSideB'), stance: t('debateStanceChallenger'), icon: '🅱️ ', paint: c.yellow }
  ];

  for (const puesto of PUESTOS) {
    console.log('\n  ' + c.dim('──') + ' ' + puesto.icon + ' ' + puesto.paint(c.bold(puesto.title)) + ' ' + c.dim(`— ${puesto.stance}`));
    roles[puesto.key] = await pickRoleTarget(prompter, { cfg, name: puesto.title, prev: prevRoles[puesto.key], roleKeys });
  }

  const merged = { ...cfg, cli: { ...(cfg.cli || {}), roles: { ...prevRoles, ...roles }, rolesFor: cfg.provider } };
  const path = await saveConfig(merged);
  console.log('\n' + c.green('✓ ' + t('aiSaved', path)));

  const etiqueta = (v) => (typeof v === 'string' ? `${v} (${cfg.provider})` : `${v.model} (${v.provider})`);
  console.log(c.dim('  ' + t('debateVs', etiqueta(roles.debateA), etiqueta(roles.debateB))));
  // Dos lados iguales no contrastan nada: se avisa aquí, donde todavía es fácil cambiarlo.
  if (JSON.stringify(roles.debateA) === JSON.stringify(roles.debateB)) console.log(c.yellow('  ! ' + t('debateWarnSameModel')));
  console.log('');
  return roles;
}

// ---------- chalc config-ia cli — el EQUIPO de la shell: líder / desarrollador / revisor ----------
// Pregunta solo lo del cli, con nombres entendibles y una línea que explica qué hace cada rol.
// Cada rol puede quedarse en el proveedor base (se guarda el nombre del modelo) o irse a otro
// proveedor con su propia key ({provider, model, apiKey}).
export async function configureAiRoles(prompter) {
  const cfg = await loadConfig();
  if (!isConfigured(cfg)) { console.error(c.red('✗ ' + t('aiNotBaseConfigured'))); return; }
  console.log(c.dim('  ' + t('aiRolesIntro')) + '\n');
  const ids = Object.keys(PROVIDERS);
  const provider = cfg.provider;
  const prevRoles = cfg.cli?.roles || {};
  const roleKeys = {};   // keys ya tecleadas por proveedor en ESTA pasada: no pedir la misma 3 veces
  const roles = {};
  // Mini-banner por agente: ícono + nombre en su color + regla, y la descripción desplegada debajo
  // (partida en sus frases) — que se LEA quién es antes de preguntar dónde corre y con qué modelo.
  const ICONS = { planner: '🧠', coder: '⚙️ ', reviewer: '🔍' };
  const PAINT = { planner: c.cyan, coder: c.green, reviewer: c.yellow };
  for (const role of ['planner', 'coder', 'reviewer']) {
    const name = t('aiRoleShort', role);
    const title = t('aiTeamName', role);
    console.log('\n  ' + c.dim('──') + ' ' + ICONS[role] + ' ' + PAINT[role](c.bold(title)) + ' ' + c.dim('─'.repeat(Math.max(6, 46 - title.length))));
    for (const line of t('aiRoleDesc', role).split('; ')) console.log('     ' + c.dim(line.trim()));
    console.log('');
    roles[role] = await pickRoleTarget(prompter, { cfg, name, prev: prevRoles[role], roleKeys });
  }
  const path = await saveConfig({ ...cfg, cli: { ...(cfg.cli || {}), roles, rolesFor: provider } });
  console.log('\n' + c.green('✓ ' + t('aiSaved', path)));
  printTeam(roles, cfg);
}

// Tarjeta GRÁFICA del equipo (líder → desarrollador → revisor): al cerrar la config, el usuario ve de
// un vistazo quién es quién, con qué modelo y dónde corre (nube ☁ / local ⌂) — no una línea de texto.
export function printTeam(roles, cfg) {
  const bar = (s = '') => console.log('   ' + c.dim('│') + (s ? '  ' + s : ''));
  const icons = { planner: '🧠', coder: '⚙️ ', reviewer: '🔍' };
  const paint = { planner: c.cyan, coder: c.green, reviewer: c.yellow };
  const where = (provider) => {
    const cloud = PROVIDERS[provider]?.needsKey;
    return c.dim((cloud ? '☁  ' : '⌂  ') + t(cloud ? 'aiTeamCloud' : 'aiTeamLocal', provider));
  };
  console.log('\n   ' + c.dim('╭──── ') + c.bold(t('aiTeamTitle')) + c.dim(' ────────────────────────'));
  bar();
  for (const role of ['planner', 'coder', 'reviewer']) {
    const v = roles[role];
    if (!v) continue;
    const model = typeof v === 'string' ? v : v.model;
    const provider = typeof v === 'string' ? cfg.provider : v.provider;
    bar(`${icons[role]} ${paint[role](c.bold(t('aiTeamName', role)))}  ${c.bold(model)}`);
    bar(`   ${where(provider)}`);
    bar(`   ${c.dim(t('aiRoleDesc', role))}`);
    if (role !== 'reviewer') bar(c.dim('      ↓'));
  }
  bar();
  console.log('   ' + c.dim('╰──────────────────────────────────────────────') + '\n');
}

