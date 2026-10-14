// cli/shell/answers.mjs — las respuestas que la shell acepta en una aprobación o una pregunta sí/no.
// UNA sola tabla (spec 022, F8): el front-end aceptaba "sí" con tilde y el turno, con su propia lista,
// lo leía como NO —el usuario aprobaba y la acción se denegaba—.

const YES = ['y', 'yes', 's', 'si', 'sí'];
const ALL = ['a', 'all', 'todo'];   // aprueba esta acción y el resto del turno
const NO = ['n', 'no'];

// Stryker disable next-line StringLiteral: equivalente — ningún texto de relleno está en las tablas de respuestas
const norm = (answer) => String(answer ?? '').trim().toLowerCase();

// ¿Es una respuesta de aprobación (y/n/a en cualquiera de sus formas)?
export const isApprovalAnswer = (answer) => [...YES, ...ALL, ...NO].includes(norm(answer));

// ¿Aprueba? ("a"/"todo" también aprueban).
export const isYes = (answer) => [...YES, ...ALL].includes(norm(answer));

// ¿Aprueba el resto del turno?
export const isApproveAll = (answer) => ALL.includes(norm(answer));

// Sí/no de una pregunta sin "aprobar todo" (el selector sin TTY).
export const isPlainYes = (answer) => YES.includes(norm(answer));
