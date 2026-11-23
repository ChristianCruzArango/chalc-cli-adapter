// i18n-approve.mjs — lo que dicen las dos aprobaciones del usuario (spec 024, R14, R15; spec 028, R2, R3).
// Responsabilidad ÚNICA: sus textos en es y en. Razón de cambio: la redacción de una aprobación.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Vive aparte de `i18n.mjs` solo por tamaño; `FRAME` lo incluye, así que la paridad de claves se exige igual.

export const APPROVE = {
  es: {
    // La spec: el plan que se aprueba antes de escribir un test.
    approve: {
      prompt: (name) => `Vas a aprobar la spec "${name}" (HU, spec, plan y tareas tal como están). Teclea el nombre de la carpeta para confirmar: `,
      done: (dir) => `Spec aprobada y sellada: ${dir}. El asistente ya puede pasar a tests y código.`,
      noTerminal: (command) => `La aprobación de la spec la da el usuario, no el asistente. Ejecuta tú, en tu terminal: ${command}`,
      noSpec: 'No hay ninguna carpeta de spec que aprobar.',
      problems: 'La spec no se puede aprobar todavía; primero hay que corregir:',
      mismatch: 'El nombre tecleado no coincide con la carpeta: no se aprobó nada.'
    },
    // El cierre: lo que se da por terminado.
    approveFeature: {
      prompt: (name) => `Vas a aprobar el CIERRE de "${name}": todas sus tareas, con la evidencia del portón que hay ahora. Teclea el nombre de la carpeta para confirmar: `,
      done: (dir) => `Cierre aprobado y sellado: ${dir}.`,
      noTerminal: (command) => `El cierre lo aprueba el usuario, no el asistente. Ejecuta tú, en tu terminal: ${command}`,
      noSpec: 'No hay ninguna carpeta de spec que cerrar.',
      specNotApproved: 'La spec no está aprobada (o cambió después de aprobarla): primero `node .chalc/gate.mjs --approve-spec`.',
      tasksOpen: 'Quedan tareas sin marcar en tasks.md: el cierre es de la feature entera.',
      noEvidence: 'No hay evidencia del portón: corre `node .chalc/gate.mjs` (completo) antes de cerrar.',
      evidenceNotPass: 'La última evidencia del portón no aprueba: no se cierra con el portón en rojo.',
      evidenceFast: 'La última evidencia es de una corrida `--fast`, que no mide la mutación: corre el portón completo.',
      mismatch: 'El nombre tecleado no coincide con la carpeta: no se aprobó nada.'
    }
  },
  en: {
    approve: {
      prompt: (name) => `You are about to approve the spec "${name}" (user story, spec, plan and tasks as they stand). Type the folder name to confirm: `,
      done: (dir) => `Spec approved and sealed: ${dir}. The assistant may now move on to tests and code.`,
      noTerminal: (command) => `The spec is approved by the user, not by the assistant. Run it yourself, in your terminal: ${command}`,
      noSpec: 'There is no spec folder to approve.',
      problems: 'The spec cannot be approved yet; fix this first:',
      mismatch: 'The name typed does not match the folder: nothing was approved.'
    },
    approveFeature: {
      prompt: (name) => `You are about to approve the CLOSE of "${name}": all of its tasks, with the gate evidence as it stands now. Type the folder name to confirm: `,
      done: (dir) => `Close approved and sealed: ${dir}.`,
      noTerminal: (command) => `The close is approved by the user, not by the assistant. Run it yourself, in your terminal: ${command}`,
      noSpec: 'There is no spec folder to close.',
      specNotApproved: 'The spec is not approved (or changed after its approval): first `node .chalc/gate.mjs --approve-spec`.',
      tasksOpen: 'There are unticked tasks in tasks.md: the close is for the whole feature.',
      noEvidence: 'There is no gate evidence: run `node .chalc/gate.mjs` (full) before closing.',
      evidenceNotPass: 'The last gate evidence does not pass: nothing is closed with the gate red.',
      evidenceFast: 'The last evidence comes from a `--fast` run, which does not measure mutation: run the full gate.',
      mismatch: 'The name typed does not match the folder: nothing was approved.'
    }
  }
};
