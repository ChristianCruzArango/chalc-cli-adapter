// concepts.mjs — los conceptos de la memoria (spec 015, R4–R7). Responsabilidad ÚNICA: decir de qué
// conceptos habla un texto. Razón de cambio: cómo se reconoce un concepto.
//
// Este archivo lo emite chalc dentro de `.chalc/memory/lib/`. No edites aquí: se regenera al equipar.
//
// La memoria se ordena por concepto y no por palabra: «money», «plata» y «tarifa» son `dinero`. Si
// se ordenara por palabra, una regla aprendida con «monto» no llegaría a una spec que habla de
// «tarifas». El diccionario base trae los conceptos frecuentes; el repo aprende los suyos en
// `.chalc/memory/concepts.json`, que se commitea junto a la memoria.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const LEARNED_REL = '.chalc/memory/concepts.json';

// El diccionario base es código de chalc y se regenera al equipar; lo aprendido por el repo vive
// aparte, en `LEARNED_REL`, para que equipar de nuevo no lo pise.
const BASE = new URL('./base-concepts.json', import.meta.url);

// Una palabra en su forma comparable: minúsculas, sin acentos y en singular. El singular es
// deliberadamente simple —unas pocas terminaciones del español y del inglés—: basta con que el
// diccionario y el texto pasen por la MISMA función para que coincidan.
export function normalize(word) {
  const plain = String(word ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (/[dlrnz]es$/.test(plain) && plain.length > 4) return plain.slice(0, -2);
  if (/(ss|us|is)$/.test(plain)) return plain;
  if (/s$/.test(plain) && plain.length > 3) return plain.slice(0, -1);
  return plain;
}

// Las palabras de un texto, normalizadas. Parte también los identificadores de código
// (`unitPrice`, `fecha_vencimiento`), que es como aparecen los conceptos en los archivos.
const wordsOf = (text) => String(text ?? '')
  .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
  .split(/[^\p{L}\p{N}]+/u)
  .filter(Boolean)
  .map(normalize);

// Un texto como frase comparable: cada palabra normalizada por separado. Es la forma con la que se
// comparan sinónimos y la que da claves estables a la memoria: «Decimales.» y «decimales» son iguales.
export const normalizePhrase = (text) => wordsOf(text).join(' ');
const phrase = normalizePhrase;

const readJson = async (path) => {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return {}; }
};

// Las palabras que el diccionario deja fuera por ambiguas («peso» es moneda y también el de un
// paquete; `Card` es un widget): no son de ningún concepto y el repo no las aprende.
const ambiguous = async () => new Set(((await readJson(BASE))._ambiguous?.words || []).map(phrase));

// El diccionario base unido a lo aprendido en el repo: { concepto: { synonyms, words } }. `synonyms`
// van normalizados, para comparar; `words`, tal como se escriben, para mostrarlos. Las claves que
// empiezan por `_` no son conceptos.
export async function loadConcepts(root) {
  const merged = {};
  const skip = await ambiguous();
  for (const source of [await readJson(BASE), await readJson(join(root, LEARNED_REL))]) {
    for (const [id, { synonyms = [] } = {}] of Object.entries(source).filter(([key]) => !key.startsWith('_'))) {
      const current = merged[id] || { synonyms: [], words: [] };
      // Lo ambiguo no cuenta aunque un repo lo hubiera aprendido antes de que existiera la lista.
      const usable = synonyms.filter((word) => !skip.has(phrase(word)));
      merged[id] = {
        synonyms: [...new Set([...current.synonyms, ...usable.map(phrase)])],
        words: [...new Set([...current.words, ...usable])]
      };
    }
  }
  return merged;
}

// Los conceptos de los que habla `text`, ordenados. Un sinónimo de varias palabras («base de datos»)
// cuenta solo si aparecen seguidas.
export function conceptsIn(text, concepts) {
  const words = wordsOf(text);
  const joined = ` ${words.join(' ')} `;
  const found = Object.entries(concepts)
    .filter(([, { synonyms }]) => synonyms.some((s) => joined.includes(` ${s} `)))
    .map(([id]) => id);
  return found.sort();
}

// Aprende que `word` es `concept` en este repo. Devuelve si escribió algo: un sinónimo ya conocido
// no se repite, y una palabra ambigua no se aprende, la proponga quien la proponga.
export async function learnSynonym(root, concept, word) {
  const synonym = phrase(word);
  if (!synonym || (await ambiguous()).has(synonym)) return false;
  if ((await loadConcepts(root))[concept]?.synonyms.includes(synonym)) return false;

  const path = join(root, LEARNED_REL);
  const learned = await readJson(path);
  learned[concept] = { synonyms: [...(learned[concept]?.synonyms || []), synonym] };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(learned, null, 2) + '\n', 'utf8');
  return true;
}

// Una línea corta por concepto, para quien escribe una spec y tiene que elegir de la lista.
export const listConcepts = (concepts) => Object.keys(concepts).sort()
  .map((id) => `${id} — ${(concepts[id].words || concepts[id].synonyms).slice(0, 6).join(', ')}`);
