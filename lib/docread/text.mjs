// lib/docread/text.mjs — de XML (DOCX/ODT), HTML y RTF a texto, con recorridos lineales.

import { t } from '../i18n.mjs';
import { zipRead } from './zip.mjs';
import { tokens, replaceBlocks, dropRunBefore, trimLineEnds } from '../markup.mjs';

// ---------------------------------------------------------------- XML → texto

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeXml(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function tidy(text) {
  return trimLineEnds(text.replace(/\r\n?/g, '\n'))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Recorre un XML y arma el texto. `opts.textIn` limita la captura a elementos
 * concretos (Word guarda el texto solo en <w:t>); si es null captura todo (ODF).
 */
export function xmlToText(xml, { textIn = null, newlineAfter = [], tabAfter = [], voidMarks = {} } = {}) {
  const out = [];
  let depthInText = 0;
  const local = (name) => name.replace(/^[^:]*:/, '').toLowerCase();
  for (const token of tokens(xml)) {
    if (token.text !== undefined) {
      if (!textIn || depthInText > 0) out.push(decodeXml(token.text));
      continue;
    }
    const tag = token.tag;
    if (tag[0] === '?' || tag[0] === '!') continue;
    const closing = tag[0] === '/';
    const selfClosing = tag.endsWith('/');
    const name = local(tag.replace(/^\//, '').split(/[\s/>]/)[0]);
    if (voidMarks[name] && !closing) out.push(voidMarks[name]);
    if (textIn && textIn.has(name) && !selfClosing) depthInText += closing ? -1 : 1;
    if (depthInText < 0) depthInText = 0;
    if (closing && newlineAfter.includes(name)) out.push('\n');
    if (closing && tabAfter.includes(name)) out.push('\t');
  }
  // las celdas dejan restos "\n\t" / "\t\n" al cerrar párrafo y celda a la vez
  const joined = dropRunBefore(dropRunBefore(out.join(''), '\n', '\t'), '\t', '\n').replace(/\t{2,}/g, '\t');
  return tidy(joined);
}

export function docxToText(buf) {
  const parts = [];
  const main = zipRead(buf, (n) => n === 'word/document.xml');
  if (main == null) throw new Error(t('docNoDocumentXml'));
  parts.push(main);
  for (const extra of ['word/footnotes.xml', 'word/endnotes.xml']) {
    try {
      const xml = zipRead(buf, (n) => n === extra);
      if (xml) parts.push(xml);
    } catch { /* opcional */ }
  }
  const text = parts
    .map((xml) =>
      xmlToText(xml, {
        textIn: new Set(['t', 'delttext']),
        newlineAfter: ['p', 'tr'],
        tabAfter: ['tc'],
        voidMarks: { tab: '\t', br: '\n', cr: '\n' },
      })
    )
    .filter(Boolean)
    .join('\n\n');
  return tidy(text);
}

export function odtToText(buf) {
  const xml = zipRead(buf, (n) => n === 'content.xml');
  if (xml == null) throw new Error(t('docNoContentXml'));
  const body = replaceBlocks(xml, '<office:automatic-styles', '</office:automatic-styles>');
  return xmlToText(body, {
    newlineAfter: ['p', 'h', 'table-row', 'list-item'],
    tabAfter: ['table-cell'],
    voidMarks: { tab: '\t', 'line-break': '\n', s: ' ' },
  });
}

const HTML_BLOCK_END = new Set(['p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'blockquote', 'pre']);

// Lo que deja una etiqueta HTML en el texto: salto tras un bloque o un <br>, tabulador tras una celda.
function htmlTagText(tag) {
  const closing = tag[0] === '/';
  const name = (closing ? tag.slice(1) : tag).trim().split(/[\s/]/)[0].toLowerCase();
  if (!closing) return name === 'br' || name === 'hr' ? '\n' : '';
  if (HTML_BLOCK_END.has(name)) return '\n';
  return name === 'td' || name === 'th' ? '\t' : '';
}

export function htmlToText(html) {
  let source = html;
  for (const tag of ['script', 'style', 'head']) {
    source = replaceBlocks(source, `<${tag}`, `</${tag}>`, { ignoreCase: true, boundary: true, replacement: ' ' });
  }
  source = replaceBlocks(source, '<!--', '-->', { replacement: ' ' });
  const parts = [];
  for (const token of tokens(source)) parts.push(token.text !== undefined ? token.text : htmlTagText(token.tag));
  return tidy(dropRunBefore(decodeXml(parts.join('')), '\t', '\n').replace(/[ \t]{2,}/g, ' '));
}

// grupos de RTF que no son texto del documento
const RTF_DEST = /^\{\\(?:\*|(?:fonttbl|colortbl|stylesheet|info|pict|nonshppict|listtable|listoverridetable|rsidtbl|filetbl|xmlnstbl|themedata|colorschememapping|latentstyles|datastore|fldinst|generator)\b)/;

function skipRtfGroup(s, i) {
  let depth = 0;
  for (; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i + 1;
  }
  return s.length;
}

function stripRtfGroups(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '{' && RTF_DEST.test(s.slice(i, i + 40))) { i = skipRtfGroup(s, i); continue; }
    out += s[i++];
  }
  return out;
}

export function rtfToText(rtf) {
  let s = stripRtfGroups(rtf); // fonttbl, colortbl, info, imágenes…
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => Buffer.from(h, 'hex').toString('latin1'));
  s = s.replace(/\\u(-?\d+)\s?\??/g, (_, n) => String.fromCharCode(((+n % 65536) + 65536) % 65536));
  s = s.replace(/\\(par|line|sect)\b\s?/g, '\n');
  s = s.replace(/\\tab\b\s?/g, '\t');
  s = s.replace(/\\[a-zA-Z]+-?\d*\s?/g, ''); // resto de control words
  s = s.replace(/[{}]/g, '').replace(/\\([\\{}])/g, '$1');
  return tidy(s);
}
