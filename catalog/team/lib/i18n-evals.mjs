// i18n-evals.mjs — los textos de `team.mjs evals` en es y en (spec 037). Responsabilidad ÚNICA: lo que lee una
// persona en las cifras del equipo. Razón de cambio: la redacción. Paridad exacta de claves.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.

export const EVALS = {
  es: {
    title: 'Evals del equipo (del registro, sin modelos)', specs: 'spec(s)', integrated: 'integrada(s)',
    developers: 'Desarrollador, por nivel de modelo y versión de sus instrucciones',
    reviewers: 'Quien revisa, por rol y versión de sus instrucciones',
    integration: 'Integración', leadTime: 'Tiempo medio de empezar a integrar',
    empty: 'Todavía no hay entregas ni veredictos en el registro: nada que medir.',
    caveat: 'Son conteos, no un juicio: con pocas entregas no distinguen una mejora de la suerte.',
    columns: {
      tier: 'nivel', instructions: 'instrucciones', deliveries: 'entregas', firstPass: 'a la primera', approved: 'aprobadas', rejected: 'rechazadas',
      relaunched: 'relanzadas', escalated: 'escaladas', role: 'rol', verdicts: 'veredictos', rejections: 'rechazos',
      merged: 'uniones buenas', broke: 'rompieron al unirse', conflicts: 'conflictos'
    }
  },
  en: {
    title: 'Team evals (from the ledger, no models)', specs: 'spec(s)', integrated: 'integrated',
    developers: 'Developer, by model tier and version of its instructions',
    reviewers: 'Reviewers, by role and version of their instructions',
    integration: 'Integration', leadTime: 'Average time from start to integrated',
    empty: 'There are no deliveries or verdicts in the ledger yet: nothing to measure.',
    caveat: 'These are counts, not a judgement: with few deliveries they cannot tell an improvement from luck.',
    columns: {
      tier: 'tier', instructions: 'instructions', deliveries: 'deliveries', firstPass: 'first pass', approved: 'approved', rejected: 'rejected',
      relaunched: 'relaunched', escalated: 'escalated', role: 'role', verdicts: 'verdicts', rejections: 'rejections',
      merged: 'good merges', broke: 'broke when joined', conflicts: 'conflicts'
    }
  }
};
