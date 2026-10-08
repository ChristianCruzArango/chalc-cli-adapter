// lib/docread/external.mjs — conversores del sistema (soffice, pdftotext, textutil) como respaldo, con plazo.

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { t } from '../i18n.mjs';

// Plazo de los conversores del sistema (soffice, pdftotext, textutil): un documento que los cuelga
// no puede colgar el CLI con ellos.
const CONVERTER_TIMEOUT_MS = 120000;

export function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], timeout: CONVERTER_TIMEOUT_MS, killSignal: 'SIGKILL' });
}

// ---------------------------------------------------------------- respaldos externos

function sofficeCandidates() {
  const list = ['soffice', 'libreoffice'];
  if (process.platform === 'win32') {
    list.push('C:\\Program Files\\LibreOffice\\program\\soffice.exe');
    list.push('C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe');
  }
  return list;
}

export async function convertWithSoffice(path) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-doc-'));
  try {
    for (const bin of sofficeCandidates()) {
      try {
        sh(bin, ['--headless', '--convert-to', 'txt:Text', '--outdir', dir, path]);
      } catch { continue; }
      const files = await readdir(dir);
      const txt = files.find((f) => f.toLowerCase().endsWith('.txt'));
      if (txt) return (await readFile(join(dir, txt), 'utf8')).trim();
    }
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function legacyOfficeToText(path, ext) {
  if (process.platform === 'darwin') {
    try { return sh('textutil', ['-convert', 'txt', '-stdout', path]).trim(); } catch { /* sigo */ }
  }
  const viaSoffice = await convert(path);
  if (viaSoffice) return viaSoffice;
  if (ext === '.doc') {
    try { return sh('antiword', [path]).trim(); } catch { /* sigo */ }
  }
  throw new Error(t('docLegacyNoTool', basename(path), ext));
}
