// lib/debate/participants.mjs — quién debate contra quién (spec 014, R2, R4, R5, R29).
// Responsabilidad ÚNICA: traducir la config del usuario en dos participantes con postura.
// Razón de cambio: cómo se declara un participante.
//
// Los dos lados se guardan en `cli.roles.debateA` / `debateB`, el MISMO almacén que los roles del
// harness (D3). No es pereza: así el debate hereda sin escribir una línea el re-anclaje cuando
// cambias de proveedor base y el descarte de modelos que ya no existen allí. Un `cfg.debate` aparte
// tendría que reimplementar las dos cosas, y la copia que se quedara vieja no fallaría al leerse:
// fallaría con un 400 en mitad de un debate ya pagado.

import { roleConfig } from '../roleconfig.mjs';

// La postura es del PUESTO, no del modelo: quien ocupe A propone y quien ocupe B rebate. Dos modelos
// con el mismo papel se dan la razón; la asimetría es lo que hace que salga algo.
const STANCES = { a: 'proponent', b: 'challenger' };
const KEYS = { a: 'debateA', b: 'debateB', judge: 'debateJudge' };

// Un participante listo para llamar: su config efectiva, etiquetada como gasto de `debate` (R29).
function participant(id, cfg, rc) {
  return {
    id,
    stance: STANCES[id],
    model: rc.model || cfg?.model || '',
    provider: rc.provider || cfg?.provider || '',
    cfg: { ...rc, task: 'debate' }
  };
}

/**
 * Los participantes del debate a partir de la config del usuario.
 *
 * `configured: false` cuando falta alguno de los dos: un debate de uno no es un debate, y es mejor
 * decirlo que fabricar un segundo lado con el mismo modelo sin avisar.
 *
 * `warnings` son CÓDIGOS, no frases: este módulo es núcleo y no habla el idioma del usuario. El
 * comando los traduce con `t()`.
 */
export function resolveParticipants(cfg) {
  const roles = cfg?.cli?.roles || {};
  const warnings = [];

  const lado = (id) => {
    const declarado = roles[KEYS[id]];
    if (!declarado) return null;
    const rc = roleConfig(cfg, KEYS[id]);
    // Declarado pero inservible aquí (se fijó con otro proveedor base): antes que reventar la llamada,
    // se debate con el modelo base y se dice que ese lado no es el que el usuario eligió (R5).
    if (!rc) {
      warnings.push(`stale:${id}`);
      return participant(id, cfg, { ...cfg });
    }
    return participant(id, cfg, rc);
  };

  const a = lado('a');
  const b = lado('b');
  if (!a || !b) return { configured: false, a: null, b: null, judge: null, judgeIsParticipant: false, warnings };

  // Mismo proveedor Y mismo modelo: no hay dos puntos de vista, hay uno hablando solo. Se avisa y se
  // sigue: es una configuración pobre, no un error del usuario (R4).
  if (a.provider === b.provider && a.model === b.model) warnings.push('same-model');

  // El juez es opcional. Sin uno propio lo asume el participante A, y `judgeIsParticipant` obliga al
  // informe a decir que quien dictaminó también sostenía una postura (R22).
  const rcJuez = roles[KEYS.judge] ? roleConfig(cfg, KEYS.judge) : null;
  const judge = rcJuez
    ? { id: 'judge', model: rcJuez.model, provider: rcJuez.provider, cfg: { ...rcJuez, task: 'debate' } }
    : { ...a, id: 'judge' };

  return { configured: true, a, b, judge, judgeIsParticipant: !rcJuez, warnings };
}
