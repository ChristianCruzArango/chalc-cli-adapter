import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTask, createSession, buildProjectSections } from '../cli/session.mjs';
import { inspectProject } from '../cli/project.mjs';

async function makeProject(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-cli-session-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

test('buildProjectSections incluye contexto (req) y constitución equipada', async () => {
  const dir = await makeProject({
    '.chalc.json': JSON.stringify({ target: 'claude', stacks: ['angular'], skills: [], mcp: [] }),
    'specs/constitution.md': 'Regla: tests siempre.'
  });
  try {
    const project = await inspectProject(dir);
    const sections = await buildProjectSections(project, 'es');   // idioma explícito: determinista en cualquier máquina
    const keys = sections.map((s) => s.key);
    assert.ok(keys.includes('contexto'));
    assert.ok(keys.includes('constitución'));
    assert.equal(sections.find((s) => s.key === 'constitución').required, true);
    const ctx = sections.find((s) => s.key === 'contexto').text;
    assert.match(ctx, /angular/);
    // el contexto le dice al modelo CÓMO generar en este stack (evita inventar "tools de generación" MCP)
    assert.match(ctx, /ng generate/);
    assert.match(ctx, /mcp__ tools do NOT generate/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('runTask ejecuta el flujo COMPLETO con un modelo simulado: list → edit → done', async () => {
  const dir = await makeProject({
    '.chalc.json': JSON.stringify({ target: 'claude', stacks: [], skills: [], mcp: [] }),
    'src/app.js': 'const version = 1;\n'
  });
  try {
    // Modelo guionizado: cada turno devuelve el JSON correspondiente. Verifica que el harness+loop+tools
    // encajan de punta a punta sin red.
    const turns = [
      '{"thought":"ver árbol","action":{"tool":"list","args":{"path":"src"}}}',
      '{"thought":"editar versión","action":{"tool":"edit","args":{"path":"src/app.js","old":"const version = 1;","new":"const version = 2;"}}}',
      '{"done":true,"summary":"subí la versión a 2"}'
    ];
    let i = 0;
    const chatImpl = async () => turns[Math.min(i++, turns.length - 1)];

    const seen = [];
    const { project, result } = await runTask({
      projectPath: dir, task: 'Sube la versión a 2', chatImpl,
      approve: async () => true, onStep: (r) => seen.push(r.action.tool)
    });

    assert.equal(result.done, true);
    assert.match(result.summary, /versión a 2/);
    assert.deepEqual(seen, ['list', 'edit']);
    assert.equal(await readFile(join(dir, 'src', 'app.js'), 'utf8'), 'const version = 2;\n');
    assert.equal(project.equipped, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('runTask respeta la aprobación: sin aprobar, no escribe', async () => {
  const dir = await makeProject({
    '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }),
    'a.txt': 'original'
  });
  try {
    const turns = [
      '{"action":{"tool":"write","args":{"path":"a.txt","content":"HACKEADO"}}}',
      '{"done":true,"summary":"intento"}'
    ];
    let i = 0;
    const { result } = await runTask({
      projectPath: dir, task: 'sobrescribe', chatImpl: async () => turns[Math.min(i++, turns.length - 1)],
      approve: async () => false
    });
    assert.equal(result.done, true);
    assert.match(result.steps[0].observation.error, /not approved/);
    assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'original');   // intacto
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('runTask exige una tarea', async () => {
  await assert.rejects(() => runTask({ projectPath: '.', task: '' }), /requiere una tarea/);
});

test('createSession inyecta las skills equipadas al prompt (índice + relevante)', async () => {
  const dir = await makeProject({
    '.chalc.json': JSON.stringify({ target: 'claude', stacks: ['angular'], skills: ['clean-code', 'angular-signals'], mcp: [] }),
    '.claude/skills/clean-code/SKILL.md': '---\nname: clean-code\ndescription: Clean Code\n---\n# CC\nCUERPO CLEAN',
    '.claude/skills/angular-signals/SKILL.md': '---\nname: angular-signals\ndescription: Angular signals\n---\n# S\nCUERPO SIGNALS'
  });
  try {
    let system = '';
    const chatImpl = async (m) => { system = m.system; return '{"done":true,"summary":"ok"}'; };
    const session = await createSession({ projectPath: dir, chatImpl, language: 'es' });
    await session.ask('trabajar con angular signals');
    assert.match(system, /equipped skills/);       // índice compacto
    assert.match(system, /- angular-signals:/);
    assert.match(system, /CUERPO SIGNALS/);          // contenido completo de la relevante
    assert.match(system, /CUERPO CLEAN/);            // clean-code es obligatoria → siempre
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('createSession toma los MCP del proyecto (.mcp.json) y expone sus tools al agente', async () => {
  const dir = await makeProject({
    '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: ['postgres'] }),
    '.mcp.json': JSON.stringify({ mcpServers: { postgres: { command: 'server-postgres' } } })
  });
  try {
    const started = [];
    // connect inyectado: no spawnea; captura la config que vino DEL PROYECTO (nada hardcodeado).
    const mcpConnect = (cfg, id) => {
      started.push({ id, command: cfg.command });
      return { start: async () => {}, listTools: async () => [{ name: 'query', description: 'SQL', inputSchema: {} }], callTool: async () => ({ ok: true }), stop: async () => {} };
    };
    let system = '';
    const chatImpl = async (m) => { system = m.system; return '{"done":true,"summary":"ok"}'; };
    const session = await createSession({ projectPath: dir, chatImpl, language: 'es', mcpConnect });

    assert.deepEqual(started, [{ id: 'postgres', command: 'server-postgres' }]);  // config tomada del proyecto
    assert.deepEqual(session.mcp, ['postgres']);
    await session.ask('consulta la base');
    assert.match(system, /mcp__postgres__query/);   // la tool MCP aparece en el índice del prompt
    await session.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('createSession expone tools y setModel; ask propaga shouldStop (interrupción)', async () => {
  const dir = await makeProject({ '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }) });
  try {
    const turns = ['{"action":{"tool":"list","args":{}}}', '{"action":{"tool":"list","args":{"path":"."}}}', '{"done":true,"summary":"ok"}'];
    let i = 0;
    const session = await createSession({ projectPath: dir, chatImpl: async () => turns[Math.min(i++, turns.length - 1)], language: 'es' });

    assert.ok(session.tools.includes('read') && session.tools.includes('bash'), '/tools lista las herramientas');
    assert.equal(session.setModel('otro'), false);   // chatImpl inyectado: el cambio en caliente no aplica (tests)

    let stop = false;
    const result = await session.ask('lista todo', { onStep: () => { stop = true; }, shouldStop: () => stop });
    assert.equal(result.interrupted, true);
    assert.equal(result.steps.length, 1);   // se interrumpió tras el primer paso
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('buildProjectSections inyecta el árbol REAL del proyecto (anti-adivinanza de rutas)', async () => {
  const dir = await makeProject({
    '.chalc.json': JSON.stringify({ target: 'claude', stacks: ['angular'], skills: [], mcp: [] }),
    'src/app/app.config.ts': 'x'
  });
  try {
    const project = await inspectProject(dir);
    const sections = await buildProjectSections(project, 'es');
    const tree = sections.find((s) => s.key === 'tree');
    assert.ok(tree, 'el árbol entra como sección');
    assert.equal(tree.required, true);             // crítico: sin él, el modelo inventa rutas
    assert.match(tree.text, /do not guess paths/);
    assert.match(tree.text, /app\.config\.ts/);    // la foto real, no la imaginada
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('buildProjectSections incluye el README (acotado) incluso sin proyecto equipado', async () => {
  const dir = await makeProject({ 'README.md': '# Mi proyecto\nUsa pnpm y el puerto 4300.\n' + 'x'.repeat(3000) });
  try {
    const project = await inspectProject(dir);
    const sections = await buildProjectSections(project, 'es');
    const readme = sections.find((s) => s.key === 'readme');
    assert.ok(readme, 'el README entra como sección');
    assert.equal(readme.required, false);                    // opcional: el budgeter decide si cabe
    assert.match(readme.text, /project README/);             // título en inglés (va al modelo)
    assert.match(readme.text, /puerto 4300/);
    assert.match(readme.text, /\[…truncated\]/);             // acotado a ~2.5k chars
    assert.ok(readme.text.length < 2700);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('las best practices del MCP DEL stack entran al contexto; las de otro stack NO', async () => {
  const mkProject = (stack, mcpId) => makeProject({
    '.chalc.json': JSON.stringify({ target: 'claude', stacks: [stack], skills: [], mcp: [mcpId] }),
    '.mcp.json': JSON.stringify({ mcpServers: { [mcpId]: { command: 'x' } } })
  });
  const mkConnect = (calls) => () => ({
    start: async () => {},
    listTools: async () => [{ name: 'get_best_practices', description: 'bp', inputSchema: {} }],
    callTool: async (name) => { calls.push(name); return { content: [{ type: 'text', text: 'Use standalone components; do NOT use NgModules.' }] }; },
    stop: async () => {}
  });

  // Proyecto Angular + MCP angular-cli → el orquestador consulta las prácticas y las inyecta.
  const dirA = await mkProject('angular', 'angular-cli');
  try {
    const calls = [];
    let system = '';
    const session = await createSession({
      projectPath: dirA, mcpConnect: mkConnect(calls), language: 'es',
      chatImpl: async (m) => { system = m.system; return '{"done":true,"summary":"ok"}'; }
    });
    assert.deepEqual(calls, ['get_best_practices']);   // consultado UNA vez, por el orquestador
    await session.ask('crea un feature');
    assert.match(system, /framework best practices/);
    assert.match(system, /do NOT use NgModules/);      // planner/coder/reviewer lo verán
    await session.close();
  } finally { await rm(dirA, { recursive: true, force: true }); }

  // Proyecto de OTRO stack (dotnet) con un MCP que no le corresponde → NO se consulta ni se inyecta.
  const dirB = await mkProject('dotnet', 'angular-cli');
  try {
    const calls = [];
    let system = '';
    const session = await createSession({
      projectPath: dirB, mcpConnect: mkConnect(calls), language: 'es',
      chatImpl: async (m) => { system = m.system; return '{"done":true,"summary":"ok"}'; }
    });
    assert.deepEqual(calls, []);   // ni una llamada: las prácticas no aplican a este stack
    await session.ask('crea un feature');
    assert.doesNotMatch(system, /framework best practices/);
    await session.close();
  } finally { await rm(dirB, { recursive: true, force: true }); }
});

test('createSession.modelFor devuelve el modelo del rol configurado (o null = el base)', async () => {
  const dir = await makeProject({ '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }) });
  try {
    const cfg = { provider: 'ollama', model: 'base:1b', cli: { roles: { planner: 'qwen2.5-coder:14b' } } };
    const session = await createSession({ projectPath: dir, cfg, chatImpl: async () => '{"done":true,"summary":"ok"}' });
    assert.equal(session.modelFor('planner'), 'qwen2.5-coder:14b');
    assert.equal(session.modelFor('coder'), null);   // sin config: la UI muestra el modelo base
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('createSession mantiene la conversación entre turnos (contexto continuo)', async () => {
  const dir = await makeProject({ '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }) });
  try {
    const systems = [];
    // El modelo simulado registra el system que recibe y siempre termina de una.
    const chatImpl = async ({ system }) => { systems.push(system); return '{"done":true,"summary":"hecho"}'; };
    const session = await createSession({ projectPath: dir, chatImpl, language: 'es' });

    await session.ask('Primer pedido único ABC123');
    await session.ask('Segundo pedido');

    // En el 2º turno, el system debe contener el resumen del 1º (conversación previa) → contexto continuo.
    assert.doesNotMatch(systems[0], /ABC123/);          // aún no había conversación previa
    assert.match(systems[1], /previous conversation/);
    assert.match(systems[1], /ABC123/);
    assert.equal(session.conversation.length, 4);       // 2 user + 2 assistant
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('focus (paso de plan): el README sale del contexto del coder; sin focus permanece', async () => {
  const dir = await makeProject({
    '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }),
    'README.md': 'ORIENTACION-GENERAL-DEL-PROYECTO'
  });
  try {
    const systems = [];
    const session = await createSession({
      projectPath: dir, language: 'es',
      chatImpl: async ({ system }) => { systems.push(system); return '{"done":true,"summary":"ok"}'; }
    });
    await session.ask('tarea normal');
    assert.match(systems[0], /ORIENTACION-GENERAL-DEL-PROYECTO/);   // turno normal: README presente
    await session.ask('1. Crear el componente', { focus: true });
    assert.doesNotMatch(systems[1], /ORIENTACION-GENERAL-DEL-PROYECTO/);   // paso acotado: enrutado fuera
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---- roles multi-proveedor: líder/revisor en la nube + coder local, cada uno con su propia key ----
import { roleConfig, roleModelLabel } from '../cli/session.mjs';

test('roleConfig: string = otro modelo del MISMO proveedor (hereda key y baseURL)', () => {
  const cfg = { provider: 'ollama', baseURL: 'http://localhost:11434/v1', model: 'gpt-oss:20b', cli: { roles: { coder: 'qwen3-coder:30b' } } };
  const rc = roleConfig(cfg, 'coder');
  assert.equal(rc.model, 'qwen3-coder:30b');
  assert.equal(rc.provider, 'ollama');
  assert.equal(rc.baseURL, 'http://localhost:11434/v1');
  assert.equal(roleConfig(cfg, 'planner'), null);   // rol sin configurar → impl base
});

test('roleConfig: objeto = rol en OTRO proveedor, SIN heredar credenciales del base', () => {
  const cfg = {
    provider: 'ollama', baseURL: 'http://localhost:11434/v1', apiKey: 'key-local-que-no-debe-viajar',
    model: 'qwen3-coder:30b', cli: { think: 'low', roles: {
      planner: { provider: 'openrouter', model: 'anthropic/claude-opus-4-8', apiKey: 'sk-or-xxx' },
      coder: 'qwen3-coder:30b'
    } }
  };
  const rc = roleConfig(cfg, 'planner');
  assert.equal(rc.provider, 'openrouter');
  assert.equal(rc.model, 'anthropic/claude-opus-4-8');
  assert.equal(rc.apiKey, 'sk-or-xxx');
  assert.equal(rc.baseURL, undefined);            // usa el default del proveedor, no el de Ollama
  assert.equal(rc.cli?.think, 'low');             // cli.* (timeouts, think) SÍ se hereda
  // objeto incompleto (sin model o sin provider) → null: jamás una llamada a medias
  assert.equal(roleConfig({ cli: { roles: { qa: { provider: 'openai' } } } }, 'qa'), null);
});

test('roleModelLabel: nombre a secas en el mismo proveedor, "modelo (proveedor)" si es otro', () => {
  const cfg = { provider: 'ollama', cli: { roles: { coder: 'qwen3-coder:30b', planner: { provider: 'openrouter', model: 'anthropic/claude-opus-4-8', apiKey: 'k' } } } };
  assert.equal(roleModelLabel(cfg, 'coder'), 'qwen3-coder:30b');
  assert.equal(roleModelLabel(cfg, 'planner'), 'anthropic/claude-opus-4-8 (openrouter)');
  assert.equal(roleModelLabel(cfg, 'reviewer'), null);
});

test('presupuesto por rol: un líder CLOUD recibe completas las skills que el presupuesto local recorta', async () => {
  const dir = await makeProject({
    '.chalc.json': JSON.stringify({ target: 'claude', stacks: ['angular'], skills: ['clean-code'], mcp: [] }),
    '.claude/skills/clean-code/SKILL.md': '---\nname: clean-code\ndescription: Clean Code\n---\n# CC\n' + 'CUERPO-GRANDE '.repeat(400)
  });
  try {
    const cap = (slot) => async ({ system }) => { if (!slot.v) slot.v = system; return '{"done":true,"summary":"1. paso"}'; };
    const a = {}, b = {};
    const s1 = await createSession({ projectPath: dir, chatImpl: cap(a), language: 'es', budgetTokens: 400 });
    await s1.plan('aplicar clean code'); await s1.close();
    const s2 = await createSession({
      projectPath: dir, chatImpl: cap(b), language: 'es', budgetTokens: 400,
      cfg: { cli: { roles: { planner: { provider: 'openrouter', model: 'anthropic/claude-opus-4.8', apiKey: 'k' } } } }
    });
    await s2.plan('aplicar clean code'); await s2.close();
    assert.ok(!a.v.includes('CUERPO-GRANDE'), 'local: el cuerpo del skill debía quedar fuera del presupuesto de 400 tokens');
    assert.ok(b.v.includes('CUERPO-GRANDE'), 'cloud: el cuerpo del skill debía entrar completo con el presupuesto amplio');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('la PLANTILLA de spec del proyecto (specs/_template/spec.md) viaja al planner — y solo a él', async () => {
  const dir = await makeProject({
    '.chalc.json': JSON.stringify({ target: 'claude', skills: [], mcp: [] }),
    'specs/_template/spec.md': '# Spec: <feature>\n## Requirements (EARS)\n- **R1** — WHEN PLANTILLA-EARS THE SYSTEM SHALL…'
  });
  try {
    const prompts = [];
    const session = await createSession({ projectPath: dir, chatImpl: async ({ system }) => { prompts.push(system); return '{"done":true,"summary":"1. paso"}'; }, language: 'es' });
    await session.plan('crear una feature');
    assert.match(prompts[0], /spec template \(the project's REQUIRED spec format/);   // sección obligatoria
    assert.match(prompts[0], /PLANTILLA-EARS/);                                       // con el contenido REAL
    await session.ask('crear una feature');
    assert.doesNotMatch(prompts[prompts.length - 1], /PLANTILLA-EARS/);               // el coder no la recibe
    await session.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('documentos rectores: CLAUDE.md y los README internos de carpetas llegan SIEMPRE al contexto', async () => {
  const dir = await makeProject({
    '.chalc.json': JSON.stringify({ target: 'claude', stacks: ['angular'], skills: [], mcp: [] }),
    'CLAUDE.md': '# Reglas\nREGLA-RECTORA: leer docs/architecture.md antes de crear archivos.',
    'src/app/features/README.md': '# Features\nCONVENCION-FEATURES: una feature nunca importa otra feature.',
    'src/app/core/README.md': '# Core\nCONVENCION-CORE: servicios transversales.',
    'README.md': '# raiz\nreadme de la raiz'
  });
  try {
    let sys = '';
    const session = await createSession({ projectPath: dir, chatImpl: async ({ system }) => { sys = sys || system; return '{"done":true,"summary":"1. paso"}'; }, language: 'es' });
    await session.plan('crear una feature');
    await session.close();
    assert.match(sys, /project instructions \(the governing document/);
    assert.match(sys, /REGLA-RECTORA/);                       // CLAUDE.md viaja como sección obligatoria
    assert.match(sys, /folder guides \(conventions that live INSIDE/);
    assert.match(sys, /src\/app\/features\/README\.md/);      // con su ruta como encabezado
    assert.match(sys, /CONVENCION-FEATURES/);
    assert.match(sys, /CONVENCION-CORE/);
    // el README de la raíz NO se duplica dentro de folder guides (tiene su propia sección)
    assert.ok(!sys.split('folder guides')[1].includes('readme de la raiz'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
