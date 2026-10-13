// stdin.mjs — leer el evento de un hook (spec 013, R10b; spec 017, R5). Responsabilidad ÚNICA: devolver
// lo que llegue por la entrada estándar sin colgar al proceso. Razón de cambio: cómo entrega un
// asistente el evento a sus hooks.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Lo comparten el anotador (`record.mjs`) y la guarda (`guard.mjs`): los dos corren dentro del turno
// del asistente, y para un hook colgarse es peor que fallar — no da error, bloquea el turno entero.

// Lee todo lo que llegue por la entrada estándar. Sin nada que leer (una terminal) devuelve '' en vez
// de esperar.
//
// Quien llama decide si la necesita. Encontrado equipando un repo de verdad: con las rutas ya dadas
// por argumento, el anotador seguía esperando a que alguien cerrara stdin, y nadie la cerraba porque
// no había nada que mandar por ahí. El proceso no terminaba nunca.
//
// El stream se recibe como parámetro (por defecto, la entrada estándar) para poder probarlo dentro del
// proceso: el código que solo corre en un proceso hijo no lo alcanza la pasada de mutación.
export const readStdin = (input = process.stdin) => new Promise((done) => {
  if (input.isTTY) return done('');
  let text = '';
  input.setEncoding('utf8');
  input.on('data', (chunk) => { text += chunk; });
  input.on('end', () => done(text));
  input.on('error', () => done(''));
});
