// page-style.mjs — el estilo del tablero (spec 020, R13, R17, R19, R21). Responsabilidad ÚNICA: cómo se ve.
// Razón de cambio: el diseño. Sin fuentes ni recursos de fuera: corre en local y sin red.
//
// Este archivo lo emite chalc dentro de `.chalc/live/lib/`. No edites aquí: se regenera al equipar.
//
// Dirección (skill `interface-design`, aprobada): plano técnico + línea de producción. Grafito de fondo y una
// sola tinta —cian de plano— para lo activo; el verde del sello, el rojo del lápiz del revisor y el ámbar de la
// cinta de precaución solo dicen estados. Profundidad solo con bordes, casi invisibles. Base de 8 px. Cifras,
// rutas y commits en monoespaciada. A pantalla completa: barra lateral fija y área principal ancha.

export const STYLE = `
:root{--paper:#f5f6f8;--sheet:#ffffff;--sheet-2:#f0f2f5;--graphite:#141922;--graphite-2:#4b5565;--graphite-3:#7a8494;--graphite-4:#a3abb8;
--rule:rgba(20,25,34,.09);--rule-strong:rgba(20,25,34,.18);--ink:#0b7fa8;--ink-wash:rgba(11,127,168,.10);
--stamp:#147a52;--stamp-wash:rgba(20,122,82,.10);--pen:#c2361b;--pen-wash:rgba(194,54,27,.09);--tape:#a86207;--tape-wash:rgba(168,98,7,.11);
--tokens:#0b7fa8;--clock:#7c5cc4;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--side:280px}
@media (prefers-color-scheme:dark){:root{--paper:#0d1117;--sheet:#121821;--sheet-2:#171e29;--graphite:#e6e9ef;--graphite-2:#b3bbc8;--graphite-3:#8892a2;--graphite-4:#5d6676;
--rule:rgba(230,233,239,.08);--rule-strong:rgba(230,233,239,.16);--ink:#4cc3ea;--ink-wash:rgba(76,195,234,.12);
--stamp:#41c98f;--stamp-wash:rgba(65,201,143,.12);--pen:#ff7a5c;--pen-wash:rgba(255,122,92,.12);--tape:#f2b13c;--tape-wash:rgba(242,177,60,.12);--tokens:#4cc3ea;--clock:#a48cff}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font:14px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--paper);color:var(--graphite);display:grid;grid-template-columns:var(--side) minmax(0,1fr);min-height:100vh}
aside{position:sticky;top:0;height:100vh;overflow:auto;padding:24px 16px;border-right:1px solid var(--rule);background:var(--sheet);display:flex;flex-direction:column;gap:24px}
aside h1{margin:0;font-size:15px;letter-spacing:-.01em}
nav{display:flex;flex-direction:column;gap:2px}nav a{color:var(--graphite-2);text-decoration:none;padding:6px 8px;border-radius:6px}
nav a:hover{background:var(--sheet-2);color:var(--graphite)}nav a:focus-visible{outline:2px solid var(--ink);outline-offset:1px}
#updated{margin-top:auto}
main{display:grid;gap:16px;padding:24px 32px 48px;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start}
section{background:var(--sheet);border:1px solid var(--rule);border-radius:8px;padding:24px;min-width:0;scroll-margin-top:16px}.wide{grid-column:1/-1}
h2{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--graphite-3);margin:0 0 16px}
.label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--graphite-3);margin:16px 0 8px}
.mute{color:var(--graphite-3)}.small{font-size:12px}.mono,code{font-family:var(--mono);font-size:12px}code{word-break:break-all}
.chip{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;border-radius:8px;border:1px solid var(--rule);background:var(--sheet-2);font-size:13px;cursor:help}
.chip.working{border-color:var(--ink);background:var(--ink-wash)}.chip.waiting{border-color:var(--rule-strong)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--graphite-4)}.dot.working{background:var(--ink);animation:pulse 1.4s ease-in-out infinite}.dot.waiting{background:var(--tape)}
@keyframes pulse{50%{opacity:.25}}
.headline{font-size:22px;font-weight:600;line-height:1.35;letter-spacing:-.015em;margin:0}.headline .sep{color:var(--graphite-4)}.headline .next{color:var(--ink)}
.v-pass{color:var(--stamp)}.v-fail,.v-blocked{color:var(--pen)}.v-none{color:var(--graphite-3)}
.reason{margin:8px 0 0;max-width:110ch}
.figures{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-top:24px;padding-top:16px;border-top:1px solid var(--rule)}
.figure .label{margin:0 0 4px}.figure .value{font:600 22px/1.2 var(--mono);letter-spacing:-.02em}
.bar{height:6px;background:var(--sheet-2);border-radius:3px;overflow:hidden;margin-top:8px}.bar>i{display:block;height:100%;background:var(--stamp);border-radius:3px;transition:width .3s ease}
.bar.tokens>i{background:var(--tokens)}.bar.time>i{background:var(--clock)}
.rail{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(8,minmax(0,1fr));position:relative}
.rail::before{content:"";position:absolute;left:6%;right:6%;top:15px;height:2px;background:var(--rule-strong)}
.station{position:relative;text-align:center;padding:0 4px}
.node{position:relative;z-index:1;display:inline-flex;width:32px;height:32px;border-radius:50%;align-items:center;justify-content:center;font:600 13px var(--mono);background:var(--sheet);border:2px solid var(--rule-strong);color:var(--graphite-3)}
.station .name{margin-top:8px;font-weight:600;font-size:13px}.station .meta{font-size:12px;color:var(--graphite-3)}
.station.done .node{background:var(--stamp);border-color:var(--stamp);color:#fff}
.station.current .node{border-color:var(--ink);color:var(--ink);box-shadow:0 0 0 4px var(--ink-wash)}.station.current .name{color:var(--ink)}
.station.failed .node{background:var(--pen);border-color:var(--pen);color:#fff}.station.failed .name{color:var(--pen)}
.gate-head{display:flex;align-items:center;gap:16px;margin-bottom:16px}
.stamp{display:inline-block;padding:4px 16px;border:2px solid currentColor;border-radius:4px;font:700 15px var(--mono);letter-spacing:.12em;transform:rotate(-2deg)}
.gate-body{display:grid;grid-template-columns:minmax(220px,320px) minmax(0,1fr);gap:24px}
.stage-lane{display:flex;flex-direction:column;gap:4px}
.stage-btn{display:flex;align-items:center;gap:8px;width:100%;text-align:left;font:inherit;color:inherit;background:transparent;border:1px solid transparent;border-radius:6px;padding:8px 12px;cursor:pointer;transition:background .15s ease}
.stage-btn:hover{background:var(--sheet-2)}.stage-btn:focus-visible{outline:2px solid var(--ink);outline-offset:1px}
.stage-btn.chosen{background:var(--sheet-2);border-color:var(--rule-strong)}
.stage-btn .mark{width:16px;font-weight:700;text-align:center}.stage-btn.passed .mark{color:var(--stamp)}.stage-btn.skipped .mark{color:var(--tape)}
.stage-btn.failed .mark,.stage-btn.blocked .mark{color:var(--pen)}.stage-btn.failed,.stage-btn.blocked{color:var(--pen)}
.stage-btn .count{margin-left:auto;font:600 11px var(--mono);padding:0 8px;border-radius:8px;background:var(--pen-wash);color:var(--pen)}
.stage-panel{border-left:2px solid var(--rule-strong);padding:0 0 0 24px}.stage-panel.failed,.stage-panel.blocked{border-left-color:var(--pen)}.stage-panel.passed{border-left-color:var(--stamp)}
.stage-panel .label:first-child{margin-top:0}.panel-title{font-size:16px;font-weight:600}
ul{margin:0;padding-left:16px}li{margin:4px 0}.why{list-style:none;padding:0}.why li{padding:8px 0;border-bottom:1px solid var(--rule)}.why li:last-child{border-bottom:0}
.bar-row{display:grid;grid-template-columns:40px minmax(0,1fr) 72px 80px;gap:16px;align-items:center;padding:8px 0}.bar-row .bars .bar{margin:4px 0}
.tid,.num{font-family:var(--mono);font-size:12px}.tid{font-weight:700}
.legend{display:flex;gap:8px;align-items:center;margin-top:8px}.sw{width:12px;height:6px;border-radius:2px;display:inline-block;margin-left:8px}.sw.tokens{background:var(--tokens)}.sw.time{background:var(--clock)}
.pill{display:inline-block;padding:0 8px;border-radius:4px;font-size:12px;line-height:20px;border:1px solid var(--rule);white-space:nowrap;color:var(--graphite-2)}
.pill.done,.pill.passed,.pill.ok,.pill.m-complies,.pill.m-fixed,.pill.m-reviewed{color:var(--stamp);background:var(--stamp-wash);border-color:transparent}
.pill.current{color:var(--ink);background:var(--ink-wash);border-color:transparent}
.pill.failed,.pill.blocked,.pill.findings,.pill.m-violates,.pill.m-not-fixed,.pill.m-finding{color:var(--pen);background:var(--pen-wash);border-color:transparent}
.pill.skipped,.pill.stale,.pill.m-na{color:var(--tape);background:var(--tape-wash);border-color:transparent}.pill.role{color:var(--ink)}
details{border:1px solid var(--rule);border-radius:8px;margin:8px 0;background:var(--sheet)}details[open]{border-color:var(--rule-strong)}
summary{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:12px 16px;cursor:pointer;list-style:none;border-radius:8px}
summary:hover{background:var(--sheet-2)}summary:focus-visible{outline:2px solid var(--ink)}summary::-webkit-details-marker{display:none}
summary::after{content:"▸";margin-left:auto;color:var(--graphite-4)}details[open]>summary::after{content:"▾"}.body{padding:0 16px 16px}
.task.current{border-left:3px solid var(--ink)}.task.done .ttext{color:var(--graphite-3);text-decoration:line-through}
.ttext{font-weight:600;flex:1 1 280px}.mark{font-weight:700}.mark.done{color:var(--stamp)}.mark.current{color:var(--ink)}.mark.pending{color:var(--graphite-4)}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.stat{border:1px solid var(--rule);border-radius:6px;padding:8px 12px;min-width:96px}.stat .value{font:600 14px var(--mono)}.stat .label{margin:0}
.role-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
.margin-note{border-left:3px solid var(--rule-strong)}.margin-note.findings{border-left-color:var(--pen)}.margin-note.ok{border-left-color:var(--stamp)}
.pen{color:var(--pen);font-size:15px}.margin-note.ok .pen{color:var(--stamp)}.role{font-size:14px}
.note-lines{list-style:none;padding:0;margin:0}.note-line{display:grid;grid-template-columns:112px minmax(0,1fr);gap:16px;align-items:baseline;padding:8px 0;border-bottom:1px solid var(--rule)}
.note-line:last-child{border-bottom:0}.note-line .pill{text-align:center}
.spec{padding:8px;border-radius:6px;border:1px solid transparent}.spec.current{border-color:var(--rule-strong);background:var(--sheet-2)}
.spec-name{font:600 13px var(--mono)}.spec.current .spec-name::after{content:" ●";color:var(--ink)}
.ok{color:var(--stamp)}
.rows{display:flex;flex-direction:column;max-height:480px;overflow:auto}.row{display:grid;grid-template-columns:88px 112px 120px minmax(0,1fr) auto;gap:16px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--rule)}
.time{font-family:var(--mono);font-size:12px;color:var(--graphite-3)}.who{font-weight:600;overflow:hidden;text-overflow:ellipsis}
@media (max-width:1100px){main{grid-template-columns:minmax(0,1fr)}.gate-body{grid-template-columns:minmax(0,1fr)}.stage-panel{padding-left:16px}}
@media (max-width:820px){body{grid-template-columns:minmax(0,1fr)}aside{position:static;height:auto;border-right:0;border-bottom:1px solid var(--rule)}
main{padding:16px}section{padding:16px}.figures{grid-template-columns:repeat(2,minmax(0,1fr))}.rail{grid-template-columns:repeat(4,minmax(0,1fr));row-gap:16px}.rail::before{display:none}
.row{grid-template-columns:72px minmax(0,1fr)}.row code{grid-column:1/-1}.note-line{grid-template-columns:minmax(0,1fr)}.bar-row{grid-template-columns:40px minmax(0,1fr) 64px}.bar-row>.num.mute{display:none}.headline{font-size:18px}}`;
