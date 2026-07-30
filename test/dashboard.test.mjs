import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { tasksProgress, currentTask, cleanTaskText, diffStates, createMonitor, scanWorkspace, scanWorkspaces, renderPage, renderTerminal, startDashboard } from '../lib/dashboard.mjs';
import { DICT } from '../lib/i18n.mjs';

function sh(args, cwd) { execFileSync('git', args, { cwd, stdio: 'ignore' }); }

// Monta un lado de workspace REAL: repo git en <base>/<id>/<side> con specs/<id>/tasks.md,
// rama base `main` y rama feat/x con un commit encima (como deja chalc + un agente trabajando).
async function sideRepo(base, id, side, tasksMd) {
  const dest = join(base, id, side);
  await mkdir(dest, { recursive: true });
  sh(['init', '-q'], dest);
  sh(['config', 'user.email', 'a@b.c'], dest);
  sh(['config', 'user.name', 'Test'], dest);
  sh(['config', 'commit.gpgsign', 'false'], dest);
  await mkdir(join(dest, 'specs', id), { recursive: true });
  await writeFile(join(dest, 'specs', id, 'tasks.md'), tasksMd, 'utf8');
  sh(['add', '.'], dest);
  sh(['commit', '-q', '-m', 'init'], dest);
  sh(['branch', '-f', 'main'], dest);
  sh(['checkout', '-q', '-b', 'feat/x'], dest);
  await writeFile(join(dest, 'avance.txt'), 'x', 'utf8');
  sh(['add', '.'], dest);
  sh(['commit', '-q', '-m', 'avance R1'], dest);
  return dest;
}

// R2 — cuenta checkboxes de tasks.md (- y *), y devuelve 0/0 en vacío.
test('tasksProgress counts checked and total checkboxes', () => {
  assert.deepEqual(tasksProgress('- [x] T1\n- [ ] T2\n* [X] T3\ntexto suelto'), { done: 2, total: 3 });
  assert.deepEqual(tasksProgress(''), { done: 0, total: 0 });
  assert.deepEqual(tasksProgress('sin tareas'), { done: 0, total: 0 });
});

// R2 — la tarea EN CURSO es la primera pendiente del tasks.md (sin el prefijo de checkbox);
// todo marcado o sin tareas → ''.
test('currentTask returns the first unchecked task text', () => {
  assert.equal(currentTask('- [x] **T1** (R1) — hecho\n- [ ] **T2** (R2) — en esto voy\n- [ ] T3'), '**T2** (R2) — en esto voy');
  assert.equal(currentTask('- [x] T1\n- [x] T2'), '');
  assert.equal(currentTask(''), '');
});

// R2 — el texto de la tarea se muestra LIMPIO: sin **, backticks, [P] ni _cursivas_, y truncado.
test('cleanTaskText strips markdown noise and truncates to a readable length', () => {
  assert.equal(
    cleanTaskText('**T1** `[P]` (R1, R2) — Escribir _tests_ de `AccesoModulo`'),
    'T1 (R1, R2) — Escribir tests de AccesoModulo'
  );
  const long = cleanTaskText('- '.repeat(0) + 'T2 — ' + 'palabra '.repeat(30), 40);
  assert.ok(long.length <= 40);
  assert.match(long, /…$/);
  assert.equal(cleanTaskText(''), '');
});

// R12 — el diff entre refrescos detecta tareas completadas (con el texto de la que ESTABA en
// curso) y commits nuevos; los lados con error no generan eventos.
test('diffStates emits task-done and commit events between refreshes', () => {
  const prev = [{
    id: '005-login', status: 'in-progress',
    sides: [
      { name: 'back', lastCommit: 'init', tasks: { done: 1, total: 3 }, current: 'T2 — puerta bloqueante' },
      { name: 'front', lastCommit: 'init', tasks: { done: 0, total: 2 }, current: 'T1 — modelos' }
    ]
  }];
  const next = [{
    id: '005-login', status: 'in-progress',
    sides: [
      { name: 'back', lastCommit: 'feat: puerta lista', tasks: { done: 2, total: 3 }, current: 'T3 — captura' },
      { name: 'front', lastCommit: 'init', tasks: { done: 0, total: 2 }, current: 'T1 — modelos' }
    ]
  }];
  const events = diffStates(prev, next);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { id: '005-login', side: 'back', type: 'task-done', text: 'T2 — puerta bloqueante' });
  assert.deepEqual(events[1], { id: '005-login', side: 'back', type: 'commit', text: 'feat: puerta lista' });
  assert.deepEqual(diffStates(next, next), []);   // sin cambios → sin eventos
});

// R12 — el monitor acumula el log entre ticks y lo entrega junto al estado.
test('createMonitor accumulates the activity log across ticks', async () => {
  const states = [
    [{ id: '005-x', status: 'in-progress', sides: [{ name: 'back', lastCommit: 'a', tasks: { done: 0, total: 2 }, current: 'T1 — algo' }] }],
    [{ id: '005-x', status: 'in-progress', sides: [{ name: 'back', lastCommit: 'a', tasks: { done: 1, total: 2 }, current: 'T2 — sigue' }] }]
  ];
  let i = 0;
  const monitor = createMonitor('base', { scanImpl: async () => states[Math.min(i++, 1)] });
  const first = await monitor.tick();
  assert.equal(first.log.length, 0);              // primer tick: no hay "antes" que comparar
  const second = await monitor.tick();
  assert.equal(second.log.length, 1);
  assert.match(second.log[0], /005-x/);
  assert.match(second.log[0], /T1 — algo/);       // el evento nombra la tarea que estaba en curso
  assert.equal(second.workspaces[0].sides[0].tasks.done, 1);
});

// R1, R2, R3 — escanea un workspace: rama, limpio, commits sobre la base, progreso y estado agregado.
test('scanWorkspace reads branch, cleanliness, commits over base and task progress', async () => {
  const base = await mkdtemp(join(tmpdir(), 'chalc-dash-'));
  await sideRepo(base, '005-login', 'back', '- [x] T1\n- [ ] T2\n');
  await sideRepo(base, '005-login', 'front', '- [ ] T1\n');
  const ws = await scanWorkspace(base, '005-login');
  assert.equal(ws.id, '005-login');
  assert.equal(ws.status, 'in-progress');
  assert.deepEqual(ws.sides.map((s) => s.name), ['back', 'front']);
  const back = ws.sides[0];
  assert.equal(back.branch, 'feat/x');
  assert.equal(back.clean, true);
  assert.equal(back.commits, 1);                      // un commit sobre main
  assert.equal(back.lastCommit, 'avance R1');
  assert.deepEqual(back.tasks, { done: 1, total: 2 });
  assert.equal(back.current, 'T2');   // la tarea en curso: primera pendiente del tasks.md (R2)
});

// R3 — completa cuando TODAS las tareas de TODOS los lados están marcadas; sin marcar → sin arrancar.
test('scanWorkspace derives complete and not-started statuses', async () => {
  const base = await mkdtemp(join(tmpdir(), 'chalc-dash-'));
  await sideRepo(base, '006-pagos', 'back', '- [x] T1\n- [x] T2\n');
  await sideRepo(base, '006-pagos', 'front', '- [x] T1\n');
  assert.equal((await scanWorkspace(base, '006-pagos')).status, 'complete');
  const base2 = await mkdtemp(join(tmpdir(), 'chalc-dash-'));
  await sideRepo(base2, '007-perfil', 'back', '- [ ] T1\n');
  assert.equal((await scanWorkspace(base2, '007-perfil')).status, 'not-started');
});

// R4 — workspace roto (sin lados legibles) → estado de error, sin lanzar; el resto sigue.
test('scanWorkspaces marks broken workspaces and keeps scanning the rest', async () => {
  const base = await mkdtemp(join(tmpdir(), 'chalc-dash-'));
  await sideRepo(base, '005-login', 'back', '- [ ] T1\n');
  await mkdir(join(base, '008-rota'), { recursive: true });            // sin lados: rota
  await mkdir(join(base, 'no-es-workspace'), { recursive: true });     // sin NNN-: se ignora
  await writeFile(join(base, 'open-all.ps1'), 'wt', 'utf8');           // archivo: se ignora
  const all = await scanWorkspaces(base);
  assert.deepEqual(all.map((w) => w.id), ['005-login', '008-rota']);
  assert.equal(all[0].status, 'not-started');
  assert.equal(all[1].status, 'broken');
});

// R4 — un lado sin specs legibles también rompe el workspace (worktree movido/borrado).
test('scanWorkspace marks broken when a side has no readable spec tasks', async () => {
  const base = await mkdtemp(join(tmpdir(), 'chalc-dash-'));
  const dest = join(base, '009-x', 'back');
  await mkdir(dest, { recursive: true });   // carpeta sin git y sin specs
  assert.equal((await scanWorkspace(base, '009-x')).status, 'broken');
});

// R5, R7, R8 — página autocontenida: polling a /api/state, sin recursos externos, textos vía t().
test('renderPage is self-contained and polls /api/state', () => {
  const html = renderPage({ baseDir: 'D:/features', workspaces: [] });
  assert.match(html, /\/api\/state/);
  assert.doesNotMatch(html, /https?:\/\//);   // sin CDNs ni recursos remotos
  assert.match(html, /<title>/);
  assert.ok(html.includes(DICT.es.dashTitle) || html.includes(DICT.en.dashTitle));
});

// R2 — la tarea larga se expande con una flecha (<details>) y las abiertas SOBREVIVEN al
// refresco (el renderer cliente guarda las llaves abiertas y las restaura al repintar).
test('renderPage expands long tasks with a details arrow that survives refreshes', () => {
  const html = renderPage({ baseDir: 'D:/features', workspaces: [] });
  assert.match(html, /<details/);            // el renderer cliente usa details/summary
  assert.match(html, /<summary/);
  assert.match(html, /openKeys/);            // memoria de flechas abiertas entre repintados
  assert.match(html, /'toggle'/);            // escucha aperturas/cierres para recordarlas
});

// R2 — el escaneo conserva la tarea COMPLETA (limpia, sin truncar): el recorte es del render.
test('scanWorkspace keeps the full cleaned task text for the page to expand', async () => {
  const base = await mkdtemp(join(tmpdir(), 'chalc-dash-'));
  const longTask = '**T9** — ' + 'detalle '.repeat(30);
  await sideRepo(base, '010-larga', 'back', `- [ ] ${longTask}\n`);
  const ws = await scanWorkspace(base, '010-larga');
  const current = ws.sides[0].current;
  assert.ok(current.length > 100, 'no se truncó en el escaneo');
  assert.doesNotMatch(current, /\*\*/);      // pero SÍ va limpio de markdown
  assert.doesNotMatch(current, /…$/);
});

// R10 — la vista de consola pinta el MISMO estado que la página: id, estado, y por lado
// rama + progreso + árbol + commits; un workspace roto no la revienta; vacío → texto de vacío.
test('renderTerminal mirrors the dashboard state as live console text', () => {
  const out = renderTerminal({
    workspaces: [
      {
        id: '005-login', status: 'in-progress',
        sides: [{ name: 'back', branch: 'feat/login', clean: true, commits: 1, lastCommit: 'avance R1', tasks: { done: 1, total: 2 }, current: 'T5 (R3) — puerta bloqueante' }]
      },
      { id: '008-rota', status: 'broken', sides: [{ name: 'back', error: 'not-a-repo' }] }
    ]
  });
  assert.match(out, /005-login/);
  assert.ok(out.includes(DICT.es.dashStatus_in_progress) || out.includes(DICT.en.dashStatus_in_progress));
  assert.match(out, /feat\/login/);
  assert.match(out, /1\/2/);                 // progreso done/total
  assert.match(out, /T5 \(R3\) — puerta bloqueante/);   // la tarea EN CURSO, visible en vivo (R10)
  assert.match(out, /008-rota/);             // el roto aparece, no revienta
  assert.match(out, /not-a-repo/);
  // vacío → mensaje de vacío, no una tabla en blanco
  const empty = renderTerminal({ workspaces: [] });
  assert.ok(empty.includes(DICT.es.dashEmpty) || empty.includes(DICT.en.dashEmpty));
});

// R12 — la vista de consola incluye el log de actividad (últimos eventos) cuando existe.
test('renderTerminal shows the activity log below the boards', () => {
  const out = renderTerminal({
    workspaces: [{ id: '005-x', status: 'complete', sides: [] }],
    log: ['10:01:02  005-x · back — tarea completada: T1 — algo']
  });
  assert.ok(out.includes(DICT.es.dashLogHead) || out.includes(DICT.en.dashLogHead));
  assert.match(out, /tarea completada: T1 — algo/);
});

// R1, R6, R9 — sirve / y /api/state solo por GET en localhost; close() apaga limpio.
test('startDashboard serves state over GET only and closes cleanly', async () => {
  const base = await mkdtemp(join(tmpdir(), 'chalc-dash-'));
  await sideRepo(base, '005-login', 'back', '- [x] T1\n- [ ] T2\n');
  const { server, port } = await startDashboard({ baseDir: base, port: 0 });   // puerto efímero
  try {
    const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
    assert.equal(state.workspaces.length, 1);
    assert.equal(state.workspaces[0].id, '005-login');
    assert.equal(state.workspaces[0].sides[0].tasks.done, 1);
    assert.ok(Array.isArray(state.log));   // el log de actividad viaja con el estado (R12)
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /api\/state/);
    // solo lectura: cualquier método no-GET se rechaza (R6)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/state`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`http://127.0.0.1:${port}/otra`)).status, 404);
  } finally {
    await new Promise((res) => server.close(res));   // R9: apaga sin dejar nada vivo
  }
});

// R8 — claves i18n del dashboard existen en ambos idiomas con el mismo tipo.
test('dashboard i18n keys exist in es and en', () => {
  const keys = [
    'dashHdr', 'dashServing', 'dashNoBase', 'dashStopHint', 'dashTitle', 'dashEmpty',
    'dashStatus_not_started', 'dashStatus_in_progress', 'dashStatus_complete', 'dashStatus_broken',
    'dashSideCol', 'dashBranchCol', 'dashTasksCol', 'dashTreeCol', 'dashCommitsCol', 'dashLastCommitCol',
    'dashClean', 'dashDirty', 'dashUpdated', 'dashPortBusy', 'dashConsoleHint',
    'dashLogHead', 'dashEvTaskDone', 'dashEvCommit'
  ];
  for (const key of keys) {
    assert.ok(key in DICT.es, `falta ${key} en es`);
    assert.ok(key in DICT.en, `falta ${key} en en`);
    assert.equal(typeof DICT.es[key], typeof DICT.en[key], `tipo distinto para ${key}`);
  }
});
