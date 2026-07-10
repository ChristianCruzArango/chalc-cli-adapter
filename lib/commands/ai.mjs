// Comandos de IA: `chalc config-ia` (base, cli, spec|qa|repair), `ai-doctor` y `eval-ia`,
// más los helpers de perfiles/config por tarea que reutilizan spec-ia, qa, feature e init.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../i18n.mjs';
import { assertSafeId } from '../ids.mjs';
import { PROVIDERS, applyProfileModels, configForTask, loadConfig, modelForTask, saveConfig, isConfigured, listModels } from '../ai.mjs';
import { runLocalAiEvals } from '../aieval.mjs';
import { PROFILES_DIR, c, flags, interactive, positional } from './context.mjs';
import { makePrompter } from './prompter.mjs';

export async function loadAiProfile(id = 'chalc-default') {
  const safe = assertSafeId(id || 'chalc-default', 'profile id');
  const file = join(PROFILES_DIR, `${safe}.json`);
  if (!existsSync(file)) return null;
  const profile = JSON.parse(await readFile(file, 'utf8'));
  profile.id = assertSafeId(profile.id || safe, 'profile id');
  return profile;
}

export async function listAiProfiles() {
  if (!existsSync(PROFILES_DIR)) return [];
  const files = (await readdir(PROFILES_DIR)).filter((f) => f.endsWith('.json'));
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(join(PROFILES_DIR, file), 'utf8'))));
}

export async function resolveAiTaskConfig(task) {
  let cfg = await loadConfig();
  const profile = await loadAiProfile(String(flags.profile || cfg.profile || 'chalc-default'));
  cfg = applyProfileModels(cfg, profile);
  const flagName = `${task}-model`;
  if (flags[flagName]) cfg.models = { ...(cfg.models || {}), [task]: String(flags[flagName]) };
  return configForTask(cfg, task);
}

// Muestra qué proveedor/modelo de IA se usará (para que el usuario sepa si está sobre Ollama local, nube, etc.).
export function printAiLine(cfg) {
  if (!cfg?.provider) return;
  const prov = PROVIDERS[cfg.provider];
  const base = cfg.baseURL || prov?.baseURL || '';
  const local = prov && !prov.needsKey;   // ollama u otro local: mostramos también el endpoint
  console.log(c.dim('  ' + t('aiActiveLine', cfg.provider, cfg.model || prov?.defaultModel || '?')) + (local && base ? c.dim(`  · ${base}`) : '')) ;
}

// ---------- configuración de la IA (solo para generar specs SDD) ----------
// Reutilizable: la usa `chalc spec-ai` y también `chalc spec-gen` si aún no hay config.
export async function configureAi(prompter) {
  console.log(c.dim('  ' + t('aiIntro')) + '\n');
  const cfg = await loadConfig();
  const profiles = await listAiProfiles();
  const ids = Object.keys(PROVIDERS);
  const di = Math.max(0, ids.indexOf(cfg.provider));
  const provider = ids[await prompter.select(t('aiProviderQ'), ids.map((id) => ({ label: `${id} — ${PROVIDERS[id].label}` })), di)];
  const prov = PROVIDERS[provider];
  const out = { provider };
  if (profiles.length) {
    const profileIds = profiles.map((p) => p.id);
    const defaultProfile = String(flags.profile || cfg.profile || 'chalc-default');
    const pIndex = Math.max(0, profileIds.indexOf(defaultProfile));
    const picked = profiles[await prompter.select(t('aiProfileQ'), profiles.map((p) => ({ label: `${p.id} — ${p.description || t('aiNoDesc')}` })), pIndex)];
    out.profile = picked.id;
  }
  if (prov.needsBaseURL) out.baseURL = (await prompter.text(t('aiBaseUrlQ') + ':')).trim() || cfg.baseURL || '';
  if (prov.needsKey) out.apiKey = (await prompter.secret(t('aiKeyQ') + ':')) || cfg.apiKey || '';
  else console.log(c.dim('  ' + t('aiNoKeyNeeded')));
  // Para providers locales (Ollama, LM Studio…) listamos los modelos REALMENTE instalados y dejamos elegir,
  // en vez de pedir texto libre con un default que puede no existir y reventar al llamar.
  const installed = prov.needsKey ? [] : await listModels({ provider, baseURL: out.baseURL });
  if (installed.length) {
    const otherIdx = installed.length;
    const di = Math.max(0, installed.indexOf(cfg.model));
    const pick = await prompter.select(t('aiModelPickQ'), [...installed.map((m) => ({ label: m })), { label: t('aiModelOther') }], di);
    out.model = pick < otherIdx ? installed[pick] : ((await prompter.text(t('aiModelQ', installed[0]) + ':')).trim() || cfg.model || installed[0]);
  } else {
    if (!prov.needsKey) console.log(c.dim('  ' + t('aiModelListEmpty')));
    const modelQ = prov.needsDeployment ? t('aiDeploymentQ') : t('aiModelQ', prov.defaultModel);
    out.model = (await prompter.text(modelQ + ':')).trim() || cfg.model || prov.defaultModel;
  }
  const profile = await loadAiProfile(out.profile || 'chalc-default');
  // En providers locales NO arrastramos modelos por tarea previos (podrían ser un default obsoleto tipo llama3.1
  // que pisa el modelo que el usuario acaba de elegir); el modelo elegido manda salvo que pida personalizar.
  const baseModels = prov.needsKey ? (cfg.models || {}) : {};
  const profiled = applyProfileModels({ ...out, models: baseModels }, profile);
  // Los modelos por tarea vienen del perfil; se afinan APARTE con `config-ia spec|qa|repair` (por paquetes:
  // este wizard base solo configura proveedor + key + modelo — no interroga por cosas que no vas a usar).
  out.models = { ...(profiled.models || {}) };
  if (provider === 'azure') out.apiVersion = (await prompter.text(t('aiVersionQ', '2024-10-21') + ':')).trim() || cfg.apiVersion || '2024-10-21';
  // Merge sobre la config existente: config-ia solo gobierna SUS claves — lang, cli.* y cualquier otra
  // preferencia guardada en ~/.chalc/config.json deben sobrevivir a una reconfiguración.
  const merged = { ...cfg, ...out };
  if (!prov.needsKey) delete merged.apiKey;   // provider local: no persistir una key heredada del entorno
  const path = await saveConfig(merged);
  console.log('\n' + c.green('✓ ' + t('aiSaved', path)));
  console.log(c.dim(`  ${provider} · default ${out.model} · spec ${out.models?.spec || out.model} · qa ${out.models?.qa || out.model}${out.apiKey ? ' · key ' + out.apiKey.slice(0, 4) + '…' : ''}`));
  console.log(c.dim('  ' + t('aiScopesTip')));
  console.log('');
  return out;
}

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
    const prev = prevRoles[role];
    const prevObj = prev && typeof prev === 'object' ? prev : null;
    const others = ids.filter((id) => id !== provider);
    const where = await prompter.select(t('aiRoleWhereQ', name), [
      { label: t('aiRoleSameProv', provider) },
      ...others.map((id) => ({ label: `${id} — ${PROVIDERS[id].label}` }))
    ], prevObj ? Math.max(0, others.indexOf(prevObj.provider) + 1) : 0);
    if (where === 0) {
      roles[role] = await pickModelOn(prompter, {
        provider, baseURL: cfg.baseURL,
        label: t('aiRoleModelQ', name), current: (typeof prev === 'string' && prev) || cfg.model
      });
      continue;
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
    roles[role] = entry;
  }
  const path = await saveConfig({ ...cfg, cli: { ...(cfg.cli || {}), roles } });
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

// ---------- chalc config-ia spec|qa|repair — el modelo de UNA tarea, sin interrogatorio ----------
export const AI_TASK_LABELS = { spec: 'spec-ia', qa: 'qa --agent', repair: 'repair-plan' };
export async function configureAiTask(prompter, task) {
  const cfg = await loadConfig();
  if (!isConfigured(cfg)) { console.error(c.red('✗ ' + t('aiNotBaseConfigured'))); return; }
  const label = AI_TASK_LABELS[task];
  console.log(c.dim('  ' + t('aiTaskIntro', label)) + '\n');
  const current = cfg.models?.[task] || cfg.model;
  const model = await pickModelOn(prompter, {
    provider: cfg.provider, baseURL: cfg.baseURL,
    label: t('aiModelForTask', label, current), current
  });
  const path = await saveConfig({ ...cfg, models: { ...(cfg.models || {}), [task]: model } });
  console.log('\n' + c.green('✓ ' + t('aiSaved', path)));
  console.log(c.dim(`  ${label} → ${model}`) + '\n');
}

// ---------- comando: chalc config-ia [cli|spec|qa|repair|doctor] — por PAQUETES ----------
// Sin argumento: solo lo base (proveedor + key + modelo). Cada paquete pregunta ÚNICAMENTE lo suyo:
// `cli` el equipo líder/desarrollador/revisor de la shell; `spec|qa|repair` el modelo de esa tarea.
export async function runAi() {
  const scope = positional[1];
  console.log('\n' + c.bold('⚙️  chalc config-ia' + (scope && scope !== 'doctor' ? ' ' + scope : '')) + '\n');
  if (flags.doctor || scope === 'doctor') return runAiDoctor();
  if (!interactive) { console.error(c.red('✗ ' + t('aiNeedsTty'))); process.exit(1); }
  const prompter = makePrompter();
  if (scope === 'cli') await configureAiRoles(prompter);
  else if (AI_TASK_LABELS[scope]) await configureAiTask(prompter, scope);
  else await configureAi(prompter);
  prompter.close();
}

export async function runAiDoctor() {
  console.log('\n' + c.bold('⚙️  chalc ai-doctor') + '\n');
  let cfg = await loadConfig();
  const profile = await loadAiProfile(String(flags.profile || cfg.profile || 'chalc-default'));
  cfg = applyProfileModels(cfg, profile);
  if (!isConfigured(cfg)) {
    console.log(c.red('✗ ' + t('aiDoctorNotConfigured')));
    process.exit(1);
  }
  const prov = PROVIDERS[cfg.provider];
  console.log(`  ${t('aiDoctorProvider').padEnd(9)} : ${cfg.provider} — ${prov.label}`);
  console.log(`  ${t('aiDoctorBaseUrl').padEnd(9)} : ${cfg.baseURL || prov.baseURL}`);
  console.log(`  ${t('aiDoctorProfile').padEnd(9)} : ${cfg.profile || '—'}`);
  console.log(`  ${t('aiDoctorModels').padEnd(9)} : spec=${modelForTask(cfg, 'spec')} · qa=${modelForTask(cfg, 'qa')} · repair=${modelForTask(cfg, 'repair')}`);
  if (prov.needsKey && cfg.apiKey) console.log(`  ${t('aiDoctorApiKey').padEnd(9)} : ${cfg.apiKey.slice(0, 4)}…${cfg.apiKey.slice(-2)}`);
  console.log(c.green('\n✓ ' + t('aiDoctorConsistent')));
  console.log(c.dim('  ' + t('aiDoctorLiveHint') + '\n'));
}

export async function runAiEval() {
  console.log('\n' + c.bold('⚙️  chalc eval-ia') + c.dim('  ·  local') + '\n');
  const checks = runLocalAiEvals();
  for (const check of checks) {
    const mark = check.ok ? c.green('✓') : c.red('✗');
    console.log(`  ${mark} ${check.name}${check.error ? c.dim(` — ${check.error}`) : ''}`);
  }
  const failed = checks.filter((x) => !x.ok);
  console.log(`\n  ${t('aiEvalSummary', checks.length - failed.length, checks.length)}\n`);
  if (failed.length) process.exit(1);
}
