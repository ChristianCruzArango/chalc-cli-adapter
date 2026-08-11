// decide.mjs — la tabla de prioridad del advisor (spec 008, R9). Responsabilidad ÚNICA: dado un
// snapshot del repo, decir cuál es la ÚNICA acción siguiente. Razón de cambio: la política del
// ciclo de tarea.
//
// Este archivo lo emite chalc dentro de `.chalc/next/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Es una función pura a propósito (R7, R8): recibe hechos ya leídos y no toca disco, git ni reloj.
// Todo el valor de la spec 008 está en el ORDEN de esta tabla, y ese orden solo se puede defender
// con tests que lo prueben rama por rama. Cualquier lectura del mundo vive en `snapshot.mjs`.
//
// Qué NO hace: no redacta el motivo (eso es `i18n.mjs`) ni conoce comandos (eso es `actions.mjs`).
// Devuelve la acción y los HECHOS que la produjeron, que es lo que R10 necesita para que el motivo
// cite un dato y no repita el nombre del estado.

// Una corrida rápida omite la mutación a propósito, así que su verde no dice nada de la calidad de
// las pruebas: para el advisor equivale a no tener evidencia (R14).
// Sin git no hay ramas que comparar, así que esa comprobación no aplica (R11b). El portón resuelve
// la ausencia de git recorriendo el árbol entero en vez de fallar; un advisor más estricto que el
// portón sería inservible en un repo que todavía no hizo `git init`.
const branchMatches = (s) => !s.git.branch || s.gate.branch === s.git.branch;

const evidenceIsCurrent = (s) =>
  s.gate.exists &&
  !s.gate.fast &&
  branchMatches(s) &&
  s.changed.newestMtime <= s.gate.date;

// La bitácora fecha con precisión de SEGUNDO (así lo fija su contrato, porque la escribe un modelo
// con `date -u`), mientras que la evidencia lleva milisegundos. Comparar en crudo hacía que una
// revisión hecha justo después del portón pareciera anterior hasta por 999 ms, y el advisor pedía
// revisor una y otra vez. Se compara con la granularidad del dato MENOS preciso.
const sameSecond = (ms) => Math.floor(ms / 1000);

// Los roles que aplican, en orden (spec 009, R7). Este módulo NO conoce ningún rol por su nombre: el
// catálogo lo aporta `snapshot.mjs`, incluida la compatibilidad con un `gate.json` anterior a esta
// spec. Aquí solo vive la política.
const rolesOf = (s) => (s.flow.roles || [])
  .filter((r) => r.required !== false)
  .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));

// Lo que un rol dejó en la bitácora DESPUÉS de la evidencia vigente. Una entrada firmada por otro no
// cuenta (R8): darla por buena sería dar por revisado lo que nadie revisó.
const entryOf = (s, role) => (s.review.entries || [])
  .filter((e) => e.role === role.id && sameSecond(e.date) >= sameSecond(s.gate.date))
  .at(-1);

// El primer rol de esta cadencia que falta por pasar, o el primero con hallazgos abiertos.
function pendingRole(s, cadence) {
  for (const role of rolesOf(s).filter((r) => r.cadence === cadence)) {
    const entry = entryOf(s, role);
    if (!entry) return { role, entry: null };
    if (!entry.ok) return { role, entry };
  }
  return null;
}

// Hay una tarea sin marcar en la que trabajar.
const hasPendingTask = (s) => !!s.tasks.current;

// ¿Este repo forma parte de un workspace con varios lados? (spec 010, R11). Un mono-repo no tiene con
// quién coordinarse, y una función que no le aplica jamás puede volverse un estado del que no sale.
const sidesActive = (s) => !!s.flow.sides?.enabled;

// Lo que impide aplicar la tabla siquiera (R11). Un `tasks.md` sin checkboxes no es una feature
// terminada: confundirlo con `done` daría por cerrado un trabajo que no empezó.
function unreadable(s) {
  const problems = [...(s.problems || [])];
  if (!s.tasks.hasTasksFile) problems.push('tasks-missing');
  else if (!s.tasks.total) problems.push('tasks-empty');
  return problems;
}

// La tabla de R9, en orden. El primero que aplique manda: por eso cada condición solo describe SU
// caso y confía en que los anteriores ya se descartaron.
const TABLE = [
  {
    action: 'blocked_config',
    when: (s) => s.gate.pending.length > 0,
    facts: (s) => ({ pending: s.gate.pending })
  },
  // La coordinación entre lados va ANTES de medir (spec 010, R4): correr el portón contra un contrato
  // que ya cambió gasta una corrida entera —minutos, con mutación— para producir una evidencia que
  // hay que tirar. Y el aviso sin leer puede decir justamente que no midas todavía.
  {
    action: 'sync_contract',
    when: (s) => sidesActive(s) && s.flow.sides.me !== s.flow.sides.owner && s.contract?.differs,
    facts: (s) => ({
      owner: s.flow.sides.owner,
      lines: s.contract.lines,
      minePath: s.contract.minePath,
      ownerPath: s.contract.ownerPath
    })
  },
  {
    action: 'read_mail',
    when: (s) => sidesActive(s) && (s.mail?.unread || 0) > 0,
    facts: (s) => ({ unread: s.mail.unread, from: s.mail.from })
  },
  {
    action: 'run_gate',
    when: (s) => s.changed.files.length > 0 && !evidenceIsCurrent(s),
    facts: (s) => ({
      files: s.changed.files.length,
      newestMtime: s.changed.newestMtime,
      evidenceDate: s.gate.exists ? s.gate.date : null,
      fast: s.gate.fast,
      otherBranch: s.gate.exists && s.gate.branch !== s.git.branch ? s.gate.branch : ''
    })
  },
  {
    // Exige que HAYA evidencia. Sin corrida previa el veredicto es `unknown` —defecto seguro, para
    // que "no sé" jamás valga como aprobado— pero eso no es algo que arreglar: es una tarea que aún
    // no ha empezado, y mandar a arreglar una corrida inexistente confunde a quien lo lea.
    action: 'fix_gate',
    when: (s) => s.gate.exists && s.gate.verdict !== 'pass',
    facts: (s) => ({ verdict: s.gate.verdict, evidenceDate: s.gate.date })
  },
  // Los roles de cadencia `task` cierran la tarea; los de cadencia `feature` cierran la feature. La
  // acción es la misma (`call_role` / `fix_review`) y el rol viaja en los hechos: un vocabulario que
  // creciera con cada rol dejaría de ser un contrato de máquina.
  {
    action: 'call_role',
    when: (s) => hasPendingTask(s) && pendingRole(s, 'task')?.entry === null,
    facts: (s) => roleFacts(s, pendingRole(s, 'task'))
  },
  {
    action: 'fix_review',
    when: (s) => hasPendingTask(s) && !!pendingRole(s, 'task')?.entry,
    facts: (s) => roleFacts(s, pendingRole(s, 'task'))
  },
  {
    action: 'tick_task',
    when: (s) => hasPendingTask(s) && s.tasks.mtime < s.gate.date,
    facts: (s) => ({ task: s.tasks.current, done: s.tasks.done, total: s.tasks.total, waitForApproval: s.flow.approvals.task })
  },
  {
    action: 'work_task',
    when: hasPendingTask,
    facts: (s) => ({ task: s.tasks.current, done: s.tasks.done, total: s.tasks.total })
  },
  // Sin tareas pendientes: los roles de feature, y solo entonces, `done`.
  {
    action: 'call_role',
    when: (s) => pendingRole(s, 'feature')?.entry === null,
    facts: (s) => roleFacts(s, pendingRole(s, 'feature'))
  },
  {
    action: 'fix_review',
    when: (s) => !!pendingRole(s, 'feature')?.entry,
    facts: (s) => roleFacts(s, pendingRole(s, 'feature'))
  },
  {
    action: 'done',
    when: () => true,
    facts: (s) => ({ total: s.tasks.total })
  }
];

// Los hechos de una acción de rol: quién falta, desde cuándo y con cuántos hallazgos.
const roleFacts = (s, pending) => ({
  role: pending.role.id,
  cadence: pending.role.cadence,
  evidenceDate: s.gate.date,
  reviewDate: pending.entry?.date ?? null,
  findings: pending.entry?.findings ?? 0
});

// La acción siguiente. Devuelve { action, facts }.
//
// `ask_human` es una GUARDA previa, no una fila de la tabla: si los hechos no se pueden leer, la
// tabla de R9 no se puede aplicar en absoluto. Devolver el control es lo único honesto — adivinar
// un estado sería peor, porque el asistente lo obedecería a ciegas (R11).
export function decide(snapshot) {
  const problems = unreadable(snapshot);
  if (problems.length) return { action: 'ask_human', facts: { problems } };

  const rule = TABLE.find((candidate) => candidate.when(snapshot));
  return { action: rule.action, facts: rule.facts(snapshot) };
}
