// M-01 (spec 016, R28) — el módulo compartido de entrada de historias (storyinput.mjs) se prueba en
// proceso: fuente de la historia (interactiva y por flags) e idioma del spec. Las fuentes de red, el
// disco y stdin se inyectan; por defecto siguen siendo las reales, así que los comandos no cambian.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { t } from '../lib/i18n.mjs';
import { c } from '../lib/ansi.mjs';
import { acquireUserStory, askSpecLang } from '../lib/commands/storyinput.mjs';

// Prompter falso: devuelve las respuestas en orden y anota cada pregunta.
function fakePrompter({ pick = 0, texts = [], secrets = [] } = {}) {
  const asked = [];
  return {
    asked,
    async select(q, options, def) { asked.push(['select', q, options.map((o) => o.label), def]); return pick; },
    async text(q) { asked.push(['text', q]); return texts.shift(); },
    async secret(q) { asked.push(['secret', q]); return secrets.shift(); }
  };
}

// Fuentes falsas: cada una devuelve una marca con sus argumentos.
function fakeIo() {
  const calls = [];
  const rec = (name) => async (...args) => { calls.push([name, ...args]); return name + ':ok'; };
  return { calls, io: { readDocument: rec('doc'), fetchAzureDevOps: rec('azure'), fetchJira: rec('jira'), fetchUrl: rec('url'), readPasted: rec('paste') } };
}

const SOURCE_LABELS = () => [t('srcFile'), t('srcAzure'), t('srcJira'), t('srcUrl'), t('srcPaste')];
const FETCHING = () => c.dim('  ' + t('fetching'));

test('R28: interactive file source asks the path, cleans it and reads that document', async () => {
  const p = fakePrompter({ pick: 0, texts: ['  "./historia.md"  '] });
  const { calls, io } = fakeIo();
  const logs = [];
  assert.equal(await acquireUserStory(p, { io, log: (m) => logs.push(m) }), 'doc:ok');
  assert.deepEqual(p.asked, [['select', t('sourceQ'), SOURCE_LABELS(), 0], ['text', t('docQ') + ':']]);
  assert.deepEqual(calls, [['doc', resolve('./historia.md')]]);
  assert.deepEqual(logs, []);
});

test('R28: interactive Azure source asks url and PAT (secret) and fetches with both', async () => {
  const p = fakePrompter({ pick: 1, texts: ['https://dev.azure.com/x'], secrets: ['pat-1'] });
  const { calls, io } = fakeIo();
  const logs = [];
  assert.equal(await acquireUserStory(p, { io, log: (m) => logs.push(m) }), 'azure:ok');
  assert.deepEqual(p.asked.slice(1), [['text', t('azureUrlQ') + ':'], ['secret', t('patQ') + ':']]);
  assert.deepEqual(calls, [['azure', { url: 'https://dev.azure.com/x', pat: 'pat-1' }]]);
  assert.deepEqual(logs, [FETCHING()]);
});

test('R28: interactive Jira source asks url, email and token (secret) and fetches with them', async () => {
  const p = fakePrompter({ pick: 2, texts: ['https://x.atlassian.net/browse/A-1', 'yo@x.com'], secrets: ['tok'] });
  const { calls, io } = fakeIo();
  const logs = [];
  assert.equal(await acquireUserStory(p, { io, log: (m) => logs.push(m) }), 'jira:ok');
  assert.deepEqual(p.asked.slice(1), [['text', t('jiraUrlQ') + ':'], ['text', t('emailQ') + ':'], ['secret', t('tokenQ') + ':']]);
  assert.deepEqual(calls, [['jira', { url: 'https://x.atlassian.net/browse/A-1', email: 'yo@x.com', token: 'tok' }]]);
  assert.deepEqual(logs, [FETCHING()]);
});

test('R28: interactive URL source asks the url and fetches it', async () => {
  const p = fakePrompter({ pick: 3, texts: ['https://example.com/hu'] });
  const { calls, io } = fakeIo();
  const logs = [];
  assert.equal(await acquireUserStory(p, { io, log: (m) => logs.push(m) }), 'url:ok');
  assert.deepEqual(p.asked.slice(1), [['text', t('urlQ') + ':']]);
  assert.deepEqual(calls, [['url', 'https://example.com/hu']]);
  assert.deepEqual(logs, [FETCHING()]);
});

test('R28: interactive paste source shows the END hint and reads the pasted text', async () => {
  const p = fakePrompter({ pick: 4 });
  const { calls, io } = fakeIo();
  const logs = [];
  assert.equal(await acquireUserStory(p, { io, log: (m) => logs.push(m) }), 'paste:ok');
  assert.equal(p.asked.length, 1);
  assert.deepEqual(calls, [['paste']]);
  assert.deepEqual(logs, [c.dim('  ' + t('pasteQ'))]);
});

test('R28: without a prompter --doc wins and its path is cleaned and resolved', async () => {
  const { calls, io } = fakeIo();
  const opts = { doc: ' "./a.md" ', azure: 'https://dev.azure.com/x', jira: 'https://j', url: 'https://u' };
  assert.equal(await acquireUserStory(null, { opts, env: {}, io }), 'doc:ok');
  assert.deepEqual(calls, [['doc', resolve('./a.md')]]);
});

test('R28: --azure uses --pat, else CHALC_PAT, else an empty PAT', async () => {
  for (const [opts, env, pat] of [
    [{ azure: 'https://a', pat: 'flag' }, { CHALC_PAT: 'env' }, 'flag'],
    [{ azure: 'https://a' }, { CHALC_PAT: 'env' }, 'env'],
    [{ azure: 'https://a' }, {}, '']
  ]) {
    const { calls, io } = fakeIo();
    assert.equal(await acquireUserStory(null, { opts: { ...opts, jira: 'https://j', url: 'https://u' }, env, io }), 'azure:ok');
    assert.deepEqual(calls, [['azure', { url: 'https://a', pat }]]);
  }
});

test('R28: --jira uses --email and --token, else empty email and CHALC_TOKEN, else empty token', async () => {
  for (const [opts, env, email, token] of [
    [{ jira: 'https://j', email: 'e@x', token: 'flag' }, { CHALC_TOKEN: 'env' }, 'e@x', 'flag'],
    [{ jira: 'https://j' }, { CHALC_TOKEN: 'env' }, '', 'env'],
    [{ jira: 'https://j' }, {}, '', '']
  ]) {
    const { calls, io } = fakeIo();
    assert.equal(await acquireUserStory(null, { opts: { ...opts, url: 'https://u' }, env, io }), 'jira:ok');
    assert.deepEqual(calls, [['jira', { url: 'https://j', email, token }]]);
  }
});

test('R28: --url fetches that url; with no source flag the story is empty', async () => {
  const one = fakeIo();
  assert.equal(await acquireUserStory(null, { opts: { url: 'https://u' }, env: {}, io: one.io }), 'url:ok');
  assert.deepEqual(one.calls, [['url', 'https://u']]);
  const none = fakeIo();
  assert.equal(await acquireUserStory(null, { opts: {}, env: {}, io: none.io }), '');
  assert.deepEqual(none.calls, []);
});

test('R28: --lang fixes the spec language by name and nothing is asked', async () => {
  const p = fakePrompter();
  assert.equal(await askSpecLang(p, { opts: { lang: 'EN' }, uiLang: 'es' }), 'English');
  assert.equal(await askSpecLang(null, { opts: { lang: 'pt' }, uiLang: 'es' }), 'português');
  assert.equal(await askSpecLang(null, { opts: { lang: 'klingon' }, uiLang: 'es' }), 'klingon');
  assert.deepEqual(p.asked, []);
});

test('R28: interactively the spec language defaults to the UI language and returns the choice', async () => {
  const labels = ['Español', 'English', t('otherLang')];
  const es = fakePrompter({ pick: 0 });
  assert.equal(await askSpecLang(es, { opts: {}, uiLang: 'es' }), 'español');
  assert.deepEqual(es.asked, [['select', t('specLangQ'), labels, 0]]);
  const en = fakePrompter({ pick: 1 });
  assert.equal(await askSpecLang(en, { opts: {}, uiLang: 'en' }), 'English');
  assert.deepEqual(en.asked, [['select', t('specLangQ'), labels, 1]]);
  // Cruzado: la elección manda sobre el idioma de la interfaz (no es el respaldo quien responde).
  assert.equal(await askSpecLang(fakePrompter({ pick: 0 }), { opts: {}, uiLang: 'en' }), 'español');
  assert.equal(await askSpecLang(fakePrompter({ pick: 1 }), { opts: {}, uiLang: 'es' }), 'English');
});

test('R28: "other" asks the language by name; empty falls back to the UI language', async () => {
  const typed = fakePrompter({ pick: 2, texts: ['  Deutsch  '] });
  assert.equal(await askSpecLang(typed, { opts: {}, uiLang: 'es' }), 'Deutsch');
  assert.deepEqual(typed.asked.slice(1), [['text', t('otherLangQ') + ':']]);
  assert.equal(await askSpecLang(fakePrompter({ pick: 2, texts: ['   '] }), { opts: {}, uiLang: 'en' }), 'English');
});

test('R28: without a prompter nor --lang the spec language is the UI language', async () => {
  assert.equal(await askSpecLang(null, { opts: {}, uiLang: 'es' }), 'español');
  assert.equal(await askSpecLang(null, { opts: {}, uiLang: 'en' }), 'English');
});
