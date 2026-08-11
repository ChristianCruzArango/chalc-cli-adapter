// lib/sides.mjs — la vista que cada lado tiene del workspace (spec 010, R2, R9, R11).
// Responsabilidad ÚNICA: componer la sección `flow.sides` de un lado. Razón de cambio: el layout del
// workspace.
//
// Esto NO lo puede detectar el portón: mirando un repo no hay forma de saber que es el front de un
// workspace de tres. Lo sabe el único que reparte —`chalc feature` en modo worktree—, y por eso vive
// aquí, en una función pura que ese comando llama por lado.
//
// El dueño del contrato es el PRIMER lado declarado, no el que se llame `back`. El orden ya expresa
// quién posee el contrato en el flujo de `feature` (el back lidera, los demás consumen), y atarlo al
// nombre rompería con una carpeta llamada `api`.

// El buzón vive en la raíz del workspace, hermano de los worktrees y fuera de todos ellos: dentro de
// `.chalc/` de un lado aparecería en el `git status` de ese repo y acabaría commiteado o ensuciando
// cada diff.
const MAIL_DIRNAME = '.chalc-mail';

const OFF = { me: '', owner: '', peers: [], mail: '', enabled: false };

// La sección `flow.sides` para `me`, dado el layout `<workspace>/<lado>` de la spec 005.
//
// Con menos de dos lados no hay coordinación posible y todo queda apagado: es el caso del mono-repo,
// que es el más común, y una función que no aplica no puede llegar a emitir acciones (R11).
export function sidesFor(me, sides = []) {
  if (!me || sides.length < 2 || !sides.includes(me)) return { ...OFF };

  return {
    me,
    owner: sides[0],
    peers: sides.filter((id) => id !== me).map((id) => ({ id, path: `../${id}` })),
    mail: `../${MAIL_DIRNAME}`,
    enabled: true
  };
}

export { MAIL_DIRNAME };
