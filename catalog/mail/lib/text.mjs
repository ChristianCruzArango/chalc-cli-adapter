// text.mjs — lo que el buzón dice, en el idioma del proyecto (`language` de .chalc/gate.json), igual
// que el portón: paridad exacta de claves entre es y en.

const TEXT = {
  es: {
    usage: ['Uso:', '  node .chalc/mail.mjs send --to <lado> --message "una línea"', '  node .chalc/mail.mjs read', '', 'Envía y lee avisos cortos entre los lados de un workspace.'].join('\n'),
    noMailbox: 'Este repo no forma parte de un workspace con varios lados: no hay buzón.',
    markedRead: (n) => `${n} aviso(s) marcado(s) como leído(s).`,
    nothingUnread: 'No hay avisos sin leer.',
    sent: (to) => `Aviso enviado a ${to}.`,
    noRecipient: 'Falta el destinatario.',
    toSelf: (me) => `No puedes enviarte un aviso a ti mismo (${me}).`,
    unknownSide: (to, valid) => `El lado "${to}" no existe. Los lados de este workspace son: ${valid}.`,
    emptyMessage: 'El mensaje está vacío.',
    oneLine: 'El mensaje debe ser UNA línea. Para algo más largo, habla con el usuario.',
    tooLong: (n, max) => `El mensaje tiene ${n} caracteres y el máximo es ${max}.`,
    tooMany: 'Demasiados avisos en el mismo segundo.'
  },
  en: {
    usage: ['Usage:', '  node .chalc/mail.mjs send --to <side> --message "one line"', '  node .chalc/mail.mjs read', '', 'Send / read short notes between the sides of a workspace.'].join('\n'),
    noMailbox: 'This repo is not part of a multi-side workspace: there is no mailbox.',
    markedRead: (n) => `${n} note(s) marked as read.`,
    nothingUnread: 'No unread notes.',
    sent: (to) => `Note sent to ${to}.`,
    noRecipient: 'The recipient is missing.',
    toSelf: (me) => `You cannot send a note to yourself (${me}).`,
    unknownSide: (to, valid) => `The side "${to}" does not exist. This workspace's sides are: ${valid}.`,
    emptyMessage: 'The message is empty.',
    oneLine: 'The message must be ONE line. For anything longer, talk to the user.',
    tooLong: (n, max) => `The message has ${n} characters and the maximum is ${max}.`,
    tooMany: 'Too many notes in the same second.'
  }
};

export const textOf = (lang) => TEXT[lang] || TEXT.en;
export const LANGS = Object.keys(TEXT);
