// T14 (spec 022, R2, S1) — el aviso al activar /auto dice la verdad: las compilaciones ya NO se aprueban
// solas (ejecutan código del repo). Hallado en el E2E: el texto seguía prometiendo `ng build` sin preguntar.

import test from 'node:test';
import assert from 'node:assert/strict';
import es from '../lib/i18n/es/commands.mjs';
import en from '../lib/i18n/en/commands.mjs';

for (const [lang, dict] of [['es', es], ['en', en]]) {
  test(`S1 (${lang}): cliAutoOn no lista compilaciones entre lo que corre sin preguntar`, () => {
    const [unattended, exceptions] = dict.cliAutoOn.split(/Excepción|Exception/);
    assert.ok(exceptions, 'el aviso conserva su parte de excepciones');
    assert.doesNotMatch(unattended, /ng build|dotnet build|cargo|compil|build commands/i);
    assert.match(exceptions, /build/i);   // las compilaciones aparecen entre lo que SIEMPRE pregunta
    assert.match(exceptions, /audit fix/);
    assert.match(exceptions, /MCP/);
  });
}
