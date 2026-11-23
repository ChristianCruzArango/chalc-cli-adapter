// specfacts.mjs — todo lo que se sabe de la carpeta activa (spec 024). Responsabilidad ÚNICA: juntar textos,
// huella, sello y problemas en una sola lectura. Razón de cambio: qué hechos necesitan portón, advisor y aprobación.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Un solo lector para los tres consumidores: si el portón y el advisor calcularan la huella cada uno por su
// lado, podrían discrepar sobre si una spec está aprobada.

import { coherenceProblems } from './coherence.mjs';
import { readSeal } from './specseal.mjs';
import { readSpecSet } from './specset.mjs';
import { huHash, specFingerprint } from './specprint.mjs';

/** { dir, problem, pinned, files, seal, fingerprint, huHash, problems, approved } de la carpeta activa. */
export async function specFacts(root, specDir) {
  const set = await readSpecSet(root, specDir);
  const seal = set.dir ? await readSeal(root, set.dir) : null;
  const fingerprint = specFingerprint(set.files);
  const facts = { ...set, seal, fingerprint, huHash: huHash(set.files['hu.md']) };
  // Aprobada = el usuario selló EXACTAMENTE este contenido. Cualquier edición posterior la invalida.
  return { ...facts, problems: coherenceProblems(facts), approved: seal?.fingerprint === fingerprint };
}
