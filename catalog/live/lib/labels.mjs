// labels.mjs — los textos del tablero (spec 020, R7, R13). Responsabilidad ÚNICA: cada palabra que ve el
// usuario, en es y en. Razón de cambio: cómo se dice algo en la página.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// Paridad exacta de claves entre es y en: el test la exige, y además comprueba que cada `L.grupo.clave` que usa
// el script del navegador exista aquí. Los nombres de las etapas, su resultado y los hallazgos del portón NO
// están aquí: llegan ya escritos con las palabras del portón (`frameOf`, `messageOf`), las de `.chalc/gate.md`.

export const LABELS = {
  es: {
    title: 'Tablero del proyecto',
    sections: {
      headline: 'Resumen', flow: 'Flujo SDD', charts: 'Tokens y tiempo por tarea', gate: 'Último portón', tasks: 'Tareas',
      notes: 'Notas de los roles', missing: 'Qué falta', specs: 'Specs', activity: 'Actividad en vivo', nav: 'Secciones'
    },
    kpi: { progress: 'Avance', gate: 'Portón', tokens: 'Tokens', time: 'Tiempo', roles: 'Roles al día', next: 'Siguiente paso' },
    actions: {
      blocked_config: 'Completar .chalc/gate.json', sync_contract: 'Sincronizar el contrato', read_mail: 'Leer los avisos',
      run_gate: 'Correr el portón', fix_gate: 'Arreglar lo que reporta el portón', call_role: 'Llamar a un rol', fix_review: 'Corregir los hallazgos de un rol',
      tick_task: 'Marcar la tarea como hecha', work_task: 'Trabajar en la tarea', done: 'Feature terminada', ask_human: 'Necesita a una persona'
    },
    phases: {
      constitution: 'Constitución', spec: 'Spec', plan: 'Plan', tasks: 'Tareas', implement: 'Implementación (TDD + mutación)',
      gate: 'Portón', roles: 'Roles', close: 'Cierre'
    },
    phase: { done: 'hecha', current: 'en curso', pending: 'pendiente', failed: 'con problemas' },
    status: { ok: 'OK', findings: 'con hallazgos', stale: 'revisión vieja', none: 'sin revisar' },
    marks: {
      complies: 'cumple', violates: 'no cumple', na: 'no aplica', reviewed: 'revisado', fixed: 'corregido', 'not-fixed': 'no corregido',
      finding: 'hallazgo', note: 'nota'
    },
    harness: { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity', cursor: 'Cursor', copilot: 'GitHub Copilot' },
    task: { done: 'Hecha', current: 'En curso', pending: 'Pendiente' },
    agent: {
      working: 'Trabajando', waiting: 'Quieto', none: 'Sin actividad',
      workingHint: 'El agente está trabajando ahora.', waitingHint: 'El agente terminó su turno. La página sigue al día y se moverá sola cuando vuelva a trabajar.',
      noneHint: 'Todavía no hay actividad registrada (hook de actividad en .chalc/gate-hook.md).', inside: 'dentro'
    },
    words: {
      of: 'de', score: 'score', survivors: 'supervivientes', noGate: 'Todavía no hay evidencia del portón.',
      noActivity: 'Sin actividad registrada. Activa el hook de actividad (.chalc/gate-hook.md).', nothingMissing: 'Nada: la feature está completa.',
      pendingTasks: 'Tareas pendientes', pendingRoles: 'Roles que faltan', nextStep: 'Paso siguiente', updated: 'Actualizado', offline: 'Sin conexión con el tablero',
      principal: 'principal', start: 'entró', stop: 'salió', 'turn-end': 'terminó su turno',
      requirements: 'Requisitos', noRequirements: 'Sin requisitos citados', tokens: 'tokens', time: 'tiempo', started: 'Empezó',
      input: 'Entrada', output: 'Salida', cacheRead: 'Caché leída', cacheWrite: 'Caché escrita', total: 'Total',
      outside: 'Fuera de una tarea (spec, plan…)', noUsage: 'Sin tokens registrados: activa el hook de actividad (solo Claude Code).',
      taskActivity: 'Actividad de esta tarea', noTaskActivity: 'Esta tarea todavía no tiene actividad registrada.', noTaskTokens: 'Sin tokens registrados para esta tarea.',
      why: 'Por qué', noDetails: 'Sin hallazgos en esta etapa.', more: 'hallazgos más en .chalc/gate.md', findingOne: 'hallazgo', findingMany: 'hallazgos',
      file: 'Archivo', rule: 'Regla', hint: 'Haz clic en una tarea, una etapa o una nota para ver el detalle.',
      h: 'h', min: 'min', s: 's', ago: 'hace {t}', justNow: 'ahora mismo', noTask: 'sin tarea',
      from: 'Tareas de', requirementsN: 'requisitos', tasksN: 'tareas', requirementOne: 'requisito', taskOne: 'tarea', current: 'vigente', plan: 'plan', noPlan: 'sin plan',
      noSpecs: 'Todavía no hay specs en el proyecto.', noNotes: 'Ningún rol ha dejado notas todavía.', noTasks: 'Todavía no hay tareas.',
      task: 'Tarea', noTaskNow: 'Sin tarea en curso', gateWord: 'portón', by: 'por', and: 'y', next: 'siguiente', noGateYet: 'portón sin correr',
      detail: 'Detalle', pickStage: 'Elige una etapa para ver su porqué.',
      noLiveHarness: 'La actividad en vivo y los tokens salen de los hooks de Claude Code; este proyecto está equipado para {harness}, así que esa parte no se registra. Lo demás —flujo, tareas, portón, roles y sus notas— sí está al día.'
    }
  },
  en: {
    title: 'Project board',
    sections: {
      headline: 'Summary', flow: 'SDD flow', charts: 'Tokens and time per task', gate: 'Last gate', tasks: 'Tasks',
      notes: 'Role notes', missing: 'What is missing', specs: 'Specs', activity: 'Live activity', nav: 'Sections'
    },
    kpi: { progress: 'Progress', gate: 'Gate', tokens: 'Tokens', time: 'Time', roles: 'Roles up to date', next: 'Next step' },
    actions: {
      blocked_config: 'Fill in .chalc/gate.json', sync_contract: 'Sync the contract', read_mail: 'Read the notes',
      run_gate: 'Run the gate', fix_gate: 'Fix what the gate reports', call_role: 'Call a role', fix_review: 'Fix a role\'s findings',
      tick_task: 'Tick the task', work_task: 'Work on the task', done: 'Feature complete', ask_human: 'Needs a person'
    },
    phases: {
      constitution: 'Constitution', spec: 'Spec', plan: 'Plan', tasks: 'Tasks', implement: 'Implementation (TDD + mutation)',
      gate: 'Gate', roles: 'Roles', close: 'Close'
    },
    phase: { done: 'done', current: 'in progress', pending: 'pending', failed: 'with problems' },
    status: { ok: 'OK', findings: 'with findings', stale: 'stale review', none: 'not reviewed' },
    marks: {
      complies: 'complies', violates: 'violates', na: 'n/a', reviewed: 'reviewed', fixed: 'fixed', 'not-fixed': 'not fixed',
      finding: 'finding', note: 'note'
    },
    harness: { claude: 'Claude Code', codex: 'Codex', antigravity: 'Antigravity', cursor: 'Cursor', copilot: 'GitHub Copilot' },
    task: { done: 'Done', current: 'In progress', pending: 'Pending' },
    agent: {
      working: 'Working', waiting: 'Idle', none: 'No activity',
      workingHint: 'The agent is working right now.', waitingHint: 'The agent ended its turn. The page is up to date and will move by itself when it works again.',
      noneHint: 'No activity recorded yet (activity hook in .chalc/gate-hook.md).', inside: 'inside'
    },
    words: {
      of: 'of', score: 'score', survivors: 'survivors', noGate: 'No gate evidence yet.',
      noActivity: 'No activity recorded. Enable the activity hook (.chalc/gate-hook.md).', nothingMissing: 'Nothing: the feature is complete.',
      pendingTasks: 'Pending tasks', pendingRoles: 'Roles still to pass', nextStep: 'Next step', updated: 'Updated', offline: 'Lost connection to the board',
      principal: 'main', start: 'started', stop: 'finished', 'turn-end': 'ended its turn',
      requirements: 'Requirements', noRequirements: 'No requirements cited', tokens: 'tokens', time: 'time', started: 'Started',
      input: 'Input', output: 'Output', cacheRead: 'Cache read', cacheWrite: 'Cache write', total: 'Total',
      outside: 'Outside a task (spec, plan…)', noUsage: 'No tokens recorded: enable the activity hook (Claude Code only).',
      taskActivity: 'Activity of this task', noTaskActivity: 'This task has no recorded activity yet.', noTaskTokens: 'No tokens recorded for this task.',
      why: 'Why', noDetails: 'No findings in this stage.', more: 'more findings in .chalc/gate.md', findingOne: 'finding', findingMany: 'findings',
      file: 'File', rule: 'Rule', hint: 'Click a task, a stage or a note to see the detail.',
      h: 'h', min: 'min', s: 's', ago: '{t} ago', justNow: 'just now', noTask: 'no task',
      from: 'Tasks from', requirementsN: 'requirements', tasksN: 'tasks', requirementOne: 'requirement', taskOne: 'task', current: 'current', plan: 'plan', noPlan: 'no plan',
      noSpecs: 'No specs in the project yet.', noNotes: 'No role has left notes yet.', noTasks: 'No tasks yet.',
      task: 'Task', noTaskNow: 'No task in progress', gateWord: 'gate', by: 'on', and: 'and', next: 'next', noGateYet: 'gate not run yet',
      detail: 'Detail', pickStage: 'Pick a stage to see why.',
      noLiveHarness: 'Live activity and tokens come from Claude Code hooks; this project is equipped for {harness}, so that part is not recorded. Everything else —flow, tasks, gate, roles and their notes— is up to date.'
    }
  }
};
