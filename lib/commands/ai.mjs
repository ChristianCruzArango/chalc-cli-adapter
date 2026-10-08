// Comandos de IA: `chalc config-ia` (base, cli, spec|qa|repair), `ai-doctor` y `eval-ia`,
// más los helpers de perfiles/config por tarea que reutilizan spec-ia, qa, feature e init.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../i18n.mjs';
import { assertSafeId } from '../ids.mjs';
import { PROVIDERS, applyProfileModels, configForTask, loadConfig, modelForTask, pruneStaleModels, saveConfig, isConfigured, isStaleModel, listModels } from '../ai.mjs';
import { runLocalAiEvals } from '../aieval.mjs';
import { PROFILES_DIR, c, flags, interactive, positional } from './context.mjs';
import { makePrompter } from './prompter.mjs';
import { exitCommand } from './exit.mjs';
import { pickModelOn, configureAiDebate, configureAiRoles } from './aiteam.mjs';

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
  const stale = cfg.models?.[task] && isStaleModel(cfg, cfg.models[task], cfg.modelsFor) ? cfg.models[task] : '';
  const profile = await loadAiProfile(String(flags.profile || cfg.profile || 'chalc-default'));
  cfg = applyProfileModels(cfg, profile);
  const flagName = `${task}-model`;
  // El flag es intención explícita del usuario: manda sobre lo guardado y queda sellado para este proveedor.
  if (flags[flagName]) cfg = { ...cfg, models: { ...(cfg.models || {}), [task]: String(flags[flagName]) }, modelsFor: cfg.provider };
  const resolved = configForTask(cfg, task);
  // Si el modelo guardado era de otro proveedor lo decimos: el usuario debe saber con qué se generó.
  if (stale && !flags[flagName]) console.log(c.yellow('  ! ' + t('aiStaleModel', stale, cfg.provider, resolved.model)));
  return resolved;
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
async function askProfile(prompter, cfg, profiles) {
  const profileIds = profiles.map((p) => p.id);
  const defaultProfile = String(flags.profile || cfg.profile || 'chalc-default');
  const pIndex = Math.max(0, profileIds.indexOf(defaultProfile));
  return profiles[await prompter.select(t('aiProfileQ'), profiles.map((p) => ({ label: `${p.id} — ${p.description || t('aiNoDesc')}` })), pIndex)].id;
}

// Para providers locales (Ollama, LM Studio…) listamos los modelos REALMENTE instalados y dejamos elegir,
// en vez de pedir texto libre con un default que puede no existir y reventar al llamar.
async function askBaseModel(prompter, { provider, prov, baseURL, cfg }) {
  const installed = prov.needsKey ? [] : await listModels({ provider, baseURL });
  if (installed.length) {
    const otherIdx = installed.length;
    const di = Math.max(0, installed.indexOf(cfg.model));
    const pick = await prompter.select(t('aiModelPickQ'), [...installed.map((m) => ({ label: m })), { label: t('aiModelOther') }], di);
    return pick < otherIdx ? installed[pick] : ((await prompter.text(t('aiModelQ', installed[0]) + ':')).trim() || cfg.model || installed[0]);
  }
  if (!prov.needsKey) console.log(c.dim('  ' + t('aiModelListEmpty')));
  const modelQ = prov.needsDeployment ? t('aiDeploymentQ') : t('aiModelQ', prov.defaultModel);
  return (await prompter.text(modelQ + ':')).trim() || cfg.model || prov.defaultModel;
}

// Roles del cli guardados como STRING = "el modelo tal en el proveedor base". Si el base cambió, ese
// nombre ya no existe allí: los devuelvo al modelo nuevo y aviso (los roles fijados a OTRO proveedor,
// que llevan su propia key, no se tocan — siguen siendo válidos). Devuelve los roles reubicados.
function rebaseRoles(merged, { providerChanged, provider, model }) {
  const rebased = [];
  if (providerChanged && merged.cli?.roles) {
    const roles = { ...merged.cli.roles };
    for (const [role, v] of Object.entries(roles)) {
      if (typeof v === 'string' && v !== model) { roles[role] = model; rebased.push(role); }
    }
    merged.cli = { ...merged.cli, roles, rolesFor: provider };
  } else if (merged.cli?.roles) {
    merged.cli = { ...merged.cli, rolesFor: merged.cli.rolesFor || provider };
  }
  return rebased;
}

function printAiSaved(path, out, { previous, providerChanged, rebased }) {
  console.log('\n' + c.green('✓ ' + t('aiSaved', path)));
  if (providerChanged) console.log(c.yellow('  ! ' + t('aiProviderChanged', previous, out.provider, out.model)));
  if (rebased.length) console.log(c.yellow('  ! ' + t('aiRolesRebased', rebased.join(' / '), out.model)));
  console.log(c.dim(`  ${out.provider} · default ${out.model} · spec ${out.models?.spec || out.model} · qa ${out.models?.qa || out.model}${out.apiKey ? ' · key ' + out.apiKey.slice(0, 4) + '…' : ''}`));
  console.log(c.dim('  ' + t('aiScopesTip')));
  console.log('');
}

// Reutilizable: la usa `chalc spec-ai` y también `chalc spec-gen` si aún no hay config.
export async function configureAi(prompter) {
  console.log(c.dim('  ' + t('aiIntro')) + '\n');
  const cfg = await loadConfig();
  const profiles = await listAiProfiles();
  const ids = Object.keys(PROVIDERS);
  const provider = ids[await prompter.select(t('aiProviderQ'), ids.map((id) => ({ label: `${id} — ${PROVIDERS[id].label}` })), Math.max(0, ids.indexOf(cfg.provider)))];
  const prov = PROVIDERS[provider];
  const out = { provider };
  if (profiles.length) out.profile = await askProfile(prompter, cfg, profiles);
  if (prov.needsBaseURL) out.baseURL = (await prompter.text(t('aiBaseUrlQ') + ':')).trim() || cfg.baseURL || '';
  if (prov.needsKey) out.apiKey = (await prompter.secret(t('aiKeyQ') + ':')) || cfg.apiKey || '';
  else console.log(c.dim('  ' + t('aiNoKeyNeeded')));
  out.model = await askBaseModel(prompter, { provider, prov, baseURL: out.baseURL, cfg });
  const profile = await loadAiProfile(out.profile || 'chalc-default');
  // En providers locales NO arrastramos modelos por tarea previos (podrían ser un default obsoleto tipo llama3.1
  // que pisa el modelo que el usuario acaba de elegir); el modelo elegido manda salvo que pida personalizar.
  // Y si CAMBIA el proveedor, tampoco: `gpt-oss:20b` (Ollama) enviado a OpenRouter da 400 "not a valid model ID".
  const providerChanged = !!cfg.provider && cfg.provider !== provider;
  const baseModels = prov.needsKey && !providerChanged ? (cfg.models || {}) : {};
  // Los modelos por tarea vienen del perfil; se afinan APARTE con `config-ia spec|qa|repair` (por paquetes:
  // este wizard base solo configura proveedor + key + modelo — no interroga por cosas que no vas a usar).
  out.models = { ...(applyProfileModels({ ...out, models: baseModels }, profile).models || {}) };
  out.modelsFor = provider;   // sello: con qué proveedor se fijaron esos modelos por tarea
  if (provider === 'azure') out.apiVersion = (await prompter.text(t('aiVersionQ', '2024-10-21') + ':')).trim() || cfg.apiVersion || '2024-10-21';
  // Merge sobre la config existente: config-ia solo gobierna SUS claves — lang, cli.* y cualquier otra
  // preferencia guardada en ~/.chalc/config.json deben sobrevivir a una reconfiguración.
  const merged = { ...cfg, ...out };
  if (!prov.needsKey) delete merged.apiKey;   // provider local: no persistir una key heredada del entorno
  const rebased = rebaseRoles(merged, { providerChanged, provider, model: out.model });
  printAiSaved(await saveConfig(merged), out, { previous: cfg.provider, providerChanged, rebased });
  return out;
}

// ---------- chalc config-ia spec|qa|repair — el modelo de UNA tarea, sin interrogatorio ----------
export const AI_TASK_LABELS = { spec: 'spec-ia', qa: 'qa --agent', repair: 'repair-plan' };
export async function configureAiTask(prompter, task) {
  const cfg = await loadConfig();
  if (!isConfigured(cfg)) { console.error(c.red('✗ ' + t('aiNotBaseConfigured'))); return; }
  const label = AI_TASK_LABELS[task];
  console.log(c.dim('  ' + t('aiTaskIntro', label)) + '\n');
  const saved = cfg.models?.[task];
  // si lo guardado era de otro proveedor, arranco desde el modelo base (no ofrezco un nombre que dará 400)
  const current = (saved && !isStaleModel(cfg, saved, cfg.modelsFor) ? saved : cfg.model);
  const model = await pickModelOn(prompter, {
    provider: cfg.provider, baseURL: cfg.baseURL,
    label: t('aiModelForTask', label, current), current
  });
  // al sellar para este proveedor hay que soltar lo que quedó del anterior, no darlo por bueno
  const path = await saveConfig({ ...cfg, models: { ...pruneStaleModels(cfg), [task]: model }, modelsFor: cfg.provider });
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
  if (!interactive) { console.error(c.red('✗ ' + t('aiNeedsTty'))); exitCommand(1); }
  const prompter = makePrompter();
  if (scope === 'cli') await configureAiRoles(prompter);
  else if (scope === 'debate') await configureAiDebate(prompter);
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
    exitCommand(1);
  }
  const prov = PROVIDERS[cfg.provider];
  console.log(`  ${t('aiDoctorProvider').padEnd(9)} : ${cfg.provider} — ${prov.label}`);
  console.log(`  ${t('aiDoctorBaseUrl').padEnd(9)} : ${cfg.baseURL || prov.baseURL}`);
  console.log(`  ${t('aiDoctorProfile').padEnd(9)} : ${cfg.profile || '—'}`);
  console.log(`  ${t('aiDoctorModels').padEnd(9)} : spec=${modelForTask(cfg, 'spec')} · qa=${modelForTask(cfg, 'qa')} · repair=${modelForTask(cfg, 'repair')}`);
  if (prov.needsKey && cfg.apiKey) console.log(`  ${t('aiDoctorApiKey').padEnd(9)} : ${cfg.apiKey.slice(0, 4)}…${cfg.apiKey.slice(-2)}`);
  // Modelos guardados que NO son de este proveedor: se ignoran al llamar, pero el usuario debe verlo.
  const raw = await loadConfig();
  const stale = [
    ...Object.entries(raw.models || {}).filter(([, m]) => isStaleModel(raw, m, raw.modelsFor)).map(([task, m]) => `${task}=${m}`),
    ...Object.entries(raw.cli?.roles || {})
      .filter(([, v]) => typeof v === 'string' && isStaleModel(raw, v, raw.cli?.rolesFor))
      .map(([role, v]) => `cli.${role}=${v}`)
  ];
  // Con modelos colgados de otro proveedor la config NO es consistente: no la doy por buena.
  if (stale.length) console.log('\n' + c.yellow('! ' + t('aiDoctorStale', stale.join(' · '), cfg.provider)));
  else console.log(c.green('\n✓ ' + t('aiDoctorConsistent')));
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
  if (failed.length) exitCommand(1);
}
