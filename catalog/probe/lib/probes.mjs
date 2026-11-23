// probes.mjs — el archivo de sondas de una spec (spec 041). Responsabilidad ÚNICA: dar a las sondas el mismo
// lector que usa el portón. Razón de cambio: dónde vive ese lector.
//
// Este archivo lo emite chalc dentro de `.chalc/probe/lib/`. No edites aquí: se regenera al equipar el repo.
//
// No hay dos lectores: lo que el portón acepta como `probes.json` válido es exactamente lo que aquí se ejecuta.

export { parseProbes } from '../../gate/lib/probes.mjs';
