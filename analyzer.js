// SPDX-License-Identifier: GPL-2.0-or-later
// The logic analyzer: the web counterpart of IRSIM's Tk analyzer window
// (the analyzer section of tcltk/irsim.tcl.in) and of the X11 analyzer.
//
// IRSIM decides which traces to show (the "ana" command, through
// analyzer/webana.c); this window keeps the list, fetches the nodes'
// histories from the session and draws them.
//
//   Menus     Zoom (In, Out, Full), Base (Binary .. Hex), Window (traces,
//             name length, scroll, steps, move to, width), Print (file, title,
//             banner, legend, times, outline)
//   Display   button 1 sets the marker, button 3 (or Shift+button 1) drags the
//             delta marker, button 2 (or Escape) clears them; z zooms to the
//             marked interval.  Left/Right step, Shift+Left/Right step further,
//             z zooms out, Z in, v shows everything; Ctrl+wheel zooms.
//   Slider    button 1 centres the view, button 3 (or Shift) moves an edge.

import {FloatingWindow} from "./floating-window.js";
import {menuBar} from "./menu.js";
import {ask} from "./dialog.js";
import {t, register, applyStatic, onLanguageChange} from "./i18n.js";

// The analyzer's text in Japanese (i18n.js), here rather than in an app, since the Magic app
// loads this file too.  Node and vector names stay as they are.
register({
    "Analyzer": "アナライザー",
    "Analyzer menu": "アナライザーのメニュー",
    "logic analyzer display": "ロジックアナライザー表示",
    "Traces": "トレース",
    "Waveforms": "波形",
    "Values at the marker": "マーカー位置の値",
    "No traces. Add some with Window > Manage Traces, or the ana command (for example: ana A B Y).":
        "トレースはありません。「ウィンドウ」>「トレースの管理」か、ana コマンド（例：ana A B Y）で追加できます。",
    "Show all (v)": "全体を表示（v）",
    "To the beginning": "先頭へ",
    "Step left (←; Shift: further)": "左へ移動（←、Shift で大きく）",
    "View position: click to centre, right-drag or Shift-drag an edge to resize":
        "表示位置：クリックで中央に移動、右ドラッグか Shift+ドラッグで端を動かして幅を変更",
    "Step right (→; Shift: further)": "右へ移動（→、Shift で大きく）",
    "To the end": "末尾へ",
    "{name} (vector: {bits})": "{name}（ベクトル：{bits}）",
    "Remove from the analyzer": "アナライザーから削除します",
    "Remove {name}": "{name} を削除",
    "{marker} {delta} (delta = {difference})": "{marker} {delta}（差 = {difference}）",
    "now {time} ns": "現在 {time} ns",
    // Menus
    "Zoom": "ズーム",
    "In": "拡大",
    "Out": "縮小",
    "Full": "全体",
    "Base": "基数",
    "Binary": "2 進数",
    "Octal": "8 進数",
    "Unsigned Decimal": "符号なし 10 進数",
    "Signed Decimal": "符号付き 10 進数",
    "Hex": "16 進数",
    "Window": "ウィンドウ",
    "Manage Traces": "トレースの管理",
    "Name Length": "名前の長さ",
    "Scroll": "スクロール",
    "Scroll Step": "スクロールのステップ",
    "Shift Step": "Shift でのステップ",
    "Move To…": "移動…",
    "Set Width…": "幅を設定…",
    "Remove Selected Trace": "選択したトレースを削除",
    "Clear All Traces": "すべてのトレースを消去",
    "Print": "印刷",
    "File…": "ファイルに出力…",
    "Title…": "タイトル…",
    "Banner": "バナー",
    "Legend": "凡例",
    "Times": "時刻",
    "Outline": "枠線",
    // Dialogs
    "Name length": "名前の長さ",
    "Characters of each name to show (0: all)": "各名前に表示する文字数（0：すべて）",
    "Scroll step": "スクロールのステップ",
    "Step for ← and → in ns (empty: a tenth of the view)": "← と → で動く幅、ns 単位（空欄：表示幅の 10 分の 1）",
    "Shift step": "Shift でのステップ",
    "Step for Shift+← and Shift+→ in ns (empty: half the view)": "Shift+← と Shift+→ で動く幅、ns 単位（空欄：表示幅の半分）",
    "Move to": "移動",
    "Time at the left edge, in ns": "左端の時刻、ns 単位",
    "Set width": "幅を設定",
    "Width of the view, in ns": "表示幅、ns 単位",
    "Title": "タイトル",
    "Print to file": "ファイルに出力",
    "Banner, Legend, Times and Outline in the Print menu choose what goes on the page.":
        "「印刷」メニューの「バナー」「凡例」「時刻」「枠線」で、ページに載せる内容を選べます。",
    "Format": "形式",
    "PNG image (.png)": "PNG 画像（.png）",
    "File name": "ファイル名",
    "Save": "保存",
});

const ROW = 26, RULER = 18;
const BASES = [["bin", "Binary"], ["oct", "Octal"], ["udec", "Unsigned Decimal"], ["sdec", "Signed Decimal"], ["hex", "Hex"]];
const DEFAULT_TITLE = "logic analyzer display";
const DIGITS_TO_BASE = {1: "bin", 3: "oct", 4: "hex"};

const STYLES = `
.an-body { display: flex; flex-direction: column; height: 100%; font-size: 12px; }
.an-top { display: flex; align-items: center; gap: 6px; padding: 2px 6px; border-bottom: 1px solid var(--rule); }
.an-title { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--muted); }
.an-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; position: relative; }
.an-scope { display: grid; grid-template-columns: auto 1fr auto; position: relative; }
.an-names, .an-values { padding-top: ${RULER}px; font: 12px var(--mono); }
.an-name, .an-value { height: ${ROW}px; line-height: ${ROW - 2}px; padding: 0 8px; white-space: nowrap;
  border: 1px solid var(--rule); border-width: 0 0 1px 0; box-sizing: border-box; overflow: hidden; }
.an-name { cursor: pointer; user-select: none; touch-action: none; position: relative; padding-right: 22px; }
.an-name:hover { background: var(--accent-soft); }
.an-name.selected { background: var(--an-select); color: #1d1d1f; }
.an-name .an-x { position: absolute; right: 2px; top: 3px; width: 18px; height: 18px; border: 0; background: none;
  color: var(--muted); cursor: pointer; border-radius: 4px; padding: 0; font: 12px system-ui; visibility: hidden; }
.an-name:hover .an-x, .an-name.selected .an-x { visibility: visible; }
.an-name.dragging { opacity: .5; }
.an-value { min-width: 4em; text-align: right; color: var(--accent); }
.an-display { display: block; width: 100%; outline: none; touch-action: none; cursor: crosshair; }
.an-display:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
.an-empty { position: absolute; inset: ${RULER + 10}px 12px auto; color: var(--muted); }
.an-times { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; padding: 2px 6px; font: 12px var(--mono);
  border-top: 1px solid var(--rule); }
.an-times span:first-child { text-align: left; }
.an-times span:last-child { text-align: right; }
.an-slide { display: flex; align-items: center; gap: 2px; padding: 3px 4px; border-top: 1px solid var(--rule); }
.an-slide button { font: 12px system-ui; min-width: 26px; height: 22px; padding: 0 4px; border: 1px solid var(--rule);
  border-radius: 4px; background: var(--head); color: inherit; cursor: pointer; }
.an-slider { flex: 1; height: 16px; min-width: 40px; touch-action: none; cursor: pointer; }
`;

function cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function formatNs(ns) {
    return Number.isFinite(ns) ? ns.toFixed(2) : "";
}

// ----- Values

// The value of a node history at time t (index of the last entry at or before t).
function indexAt(h, t) {
    let lo = 0, hi = h.t.length - 1, found = -1;
    while(lo <= hi) {
        const mid = (lo + hi) >> 1;
        if(h.t[mid] <= t) {
            found = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return found;
}

function bitAt(h, t) {
    if(!h || !h.t.length) {
        return 1;                      // X: nothing known
    }
    const i = indexAt(h, t);
    return i < 0 ? 1 : h.v[i] & 3;
}

// A vector's value as text: bits most significant first; 0 low, 3 high, others unknown.
export function vectorText(bits, base) {
    const n = bits.length;
    const known = bits.every(b => b === 0 || b === 3);
    if(base === "udec" || base === "sdec") {
        if(!known) {
            return "X";
        }
        let value = 0n;
        for(const b of bits) {
            value = (value << 1n) | (b === 3 ? 1n : 0n);
        }
        if(base === "sdec" && n > 0 && bits[0] === 3) {
            value -= 1n << BigInt(n);
        }
        return value.toString();
    }
    const width = base === "oct" ? 3 : base === "hex" ? 4 : 1;
    let out = "";
    for(let end = n; end > 0; end -= width) {
        const group = bits.slice(Math.max(0, end - width), end);
        if(group.some(b => b === 1)) {
            out = "X" + out;
        } else if(group.some(b => b === 2)) {
            out = "Z" + out;
        } else {
            let v = 0;
            for(const b of group) {
                v = v * 2 + (b === 3 ? 1 : 0);
            }
            out = v.toString(16).toUpperCase() + out;
        }
    }
    return out;
}

function nodeText(b) {
    return b === 0 ? "0" : b === 3 ? "1" : b === 2 ? "Z" : "X";
}

// ----- Pens: canvas, SVG and PostScript share one set of drawing calls.

class CanvasPen {
    constructor(ctx) {
        this.ctx = ctx;
    }

    line(x1, y1, x2, y2, color, width = 1, dash = null) {
        const c = this.ctx;
        c.beginPath();
        c.setLineDash(dash || []);
        c.strokeStyle = color;
        c.lineWidth = width;
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
        c.stroke();
    }

    poly(points, fill, stroke, width = 1) {
        const c = this.ctx;
        c.beginPath();
        c.setLineDash([]);
        c.moveTo(points[0], points[1]);
        for(let i = 2; i < points.length; i += 2) {
            c.lineTo(points[i], points[i + 1]);
        }
        c.closePath();
        if(fill) {
            c.fillStyle = fill;
            c.fill();
        }
        if(stroke) {
            c.strokeStyle = stroke;
            c.lineWidth = width;
            c.stroke();
        }
    }

    rect(x, y, w, h, fill, stroke) {
        this.poly([x, y, x + w, y, x + w, y + h, x, y + h], fill, stroke);
    }

    text(x, y, s, color, size = 11, align = "left", mono = true) {
        const c = this.ctx;
        c.fillStyle = color;
        c.font = `${size}px ${mono ? "ui-monospace, Menlo, Consolas, monospace" : "system-ui, sans-serif"}`;
        c.textAlign = align;
        c.textBaseline = "middle";
        c.fillText(s, x, y);
    }

    textWidth(s, size = 11) {
        this.ctx.font = `${size}px ui-monospace, Menlo, Consolas, monospace`;
        return this.ctx.measureText(s).width;
    }

    clip(x, y, w, h) {
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(x, y, w, h);
        this.ctx.clip();
    }

    unclip() {
        this.ctx.restore();
    }
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);

class SvgPen {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.out = [];
        this.clips = 0;
    }

    line(x1, y1, x2, y2, color, width = 1, dash = null) {
        this.out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"` +
            (dash ? ` stroke-dasharray="${dash.join(" ")}"` : "") + "/>");
    }

    poly(points, fill, stroke, width = 1) {
        const p = [];
        for(let i = 0; i < points.length; i += 2) {
            p.push(`${+points[i].toFixed(2)},${+points[i + 1].toFixed(2)}`);
        }
        this.out.push(`<polygon points="${p.join(" ")}" fill="${fill || "none"}"` +
            (stroke ? ` stroke="${stroke}" stroke-width="${width}"` : "") + "/>");
    }

    rect(x, y, w, h, fill, stroke) {
        this.out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill || "none"}"` +
            (stroke ? ` stroke="${stroke}"` : "") + "/>");
    }

    text(x, y, s, color, size = 11, align = "left", mono = true) {
        const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
        this.out.push(`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" text-anchor="${anchor}" ` +
            `dominant-baseline="central" font-family="${mono ? "monospace" : "sans-serif"}">${esc(s)}</text>`);
    }

    textWidth(s, size = 11) {
        return s.length * size * 0.6;
    }

    clip(x, y, w, h) {
        const id = "c" + ++this.clips;
        this.out.push(`<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath><g clip-path="url(#${id})">`);
    }

    unclip() {
        this.out.push("</g>");
    }

    finish() {
        return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" ` +
            `height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">\n<rect width="100%" height="100%" fill="#ffffff"/>\n` +
            this.out.join("\n") + "\n</svg>\n";
    }
}

// PostScript in points, y up; drawing calls arrive in pixels, y down.
class PsPen {
    constructor(width, height, title) {
        this.width = width;
        this.height = height;
        this.title = title;
        this.out = [];
    }

    // PostScript has no transparency: blend "#rrggbbaa" colours with the white page.
    rgb(color) {
        const m = /^#(..)(..)(..)(..)?$/.exec(color);
        if(!m) {
            return "0 setgray";
        }
        const alpha = m[4] ? parseInt(m[4], 16) / 255 : 1;
        const v = m.slice(1, 4).map(x => 1 - alpha * (1 - parseInt(x, 16) / 255));
        return `${v.map(x => x.toFixed(3)).join(" ")} setrgbcolor`;
    }

    y(v) {
        return (this.height - v).toFixed(2);
    }

    line(x1, y1, x2, y2, color, width = 1, dash = null) {
        this.out.push(`${this.rgb(color)} ${width} setlinewidth [${dash ? dash.join(" ") : ""}] 0 setdash ` +
            `newpath ${x1.toFixed(2)} ${this.y(y1)} moveto ${x2.toFixed(2)} ${this.y(y2)} lineto stroke`);
    }

    poly(points, fill, stroke, width = 1) {
        const path = ["newpath"];
        for(let i = 0; i < points.length; i += 2) {
            path.push(`${points[i].toFixed(2)} ${this.y(points[i + 1])} ${i ? "lineto" : "moveto"}`);
        }
        path.push("closepath");
        if(fill) {
            this.out.push(`gsave ${path.join(" ")} ${this.rgb(fill)} fill grestore`);
        }
        if(stroke) {
            this.out.push(`${path.join(" ")} ${this.rgb(stroke)} ${width} setlinewidth [] 0 setdash stroke`);
        }
    }

    rect(x, y, w, h, fill, stroke) {
        this.poly([x, y, x + w, y, x + w, y + h, x, y + h], fill, stroke);
    }

    text(x, y, s, color, size = 11, align = "left", mono = true) {
        const font = mono ? "/Courier" : "/Helvetica";
        const str = "(" + String(s).replace(/[\\()]/g, c => "\\" + c) + ")";
        const shift = align === "center" ? `dup stringwidth pop 2 div neg 0 rmoveto` :
            align === "right" ? `dup stringwidth pop neg 0 rmoveto` : "";
        this.out.push(`${this.rgb(color)} ${font} findfont ${size} scalefont setfont ` +
            `${x.toFixed(2)} ${(this.height - y - size * 0.35).toFixed(2)} moveto ${str} ${shift} show`);
    }

    textWidth(s, size = 11) {
        return s.length * size * 0.6;
    }

    clip(x, y, w, h) {
        this.out.push(`gsave newpath ${x} ${this.y(y + h)} ${w} ${h} rectclip`);
    }

    unclip() {
        this.out.push("grestore");
    }

    finish() {
        return `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ${Math.ceil(this.width)} ${Math.ceil(this.height)}\n` +
            `%%Title: (${this.title.replace(/[()]/g, "")})\n%%Creator: IRSIM web analyzer\n%%EndComments\n` +
            this.out.join("\n") + "\nshowpage\n%%EOF\n";
    }
}

// ----- The analyzer window

export class Analyzer {
    constructor(app) {
        this.app = app;
        this.traces = [];              // {name, kind: "node" | "vector", bits: [node names], base}
        this.hist = new Map();         // node name -> {t: [], v: [], upTo}
        this.selected = null;
        this.marker = null;            // time (units) of the marker
        this.delta = null;             // time of the second (delta) marker
        this.view = null;              // [left, right] in units
        this.follow = true;            // Show the whole run until the user zooms or pans
        this.begin = 0;
        this.end = 0;
        this.opts = {base: "bin", scroll: true, step: null, sstep: null, nameLength: 0, title: DEFAULT_TITLE,
            banner: true, legend: true, times: true, outline: true};
        this.fw = null;
        this.fetching = null;
        if(!document.getElementById("an-styles")) {
            const style = document.createElement("style");
            style.id = "an-styles";
            style.textContent = STYLES;
            document.head.appendChild(style);
        }
        onLanguageChange(() => this.translate());
    }

    // The title as shown: the default one in the page's language, the user's as it is.
    shownTitle() {
        return this.opts.title === DEFAULT_TITLE ? t(DEFAULT_TITLE) : this.opts.title;
    }

    translate() {
        if(!this.fw) {
            return;
        }
        applyStatic(this.fw.body);
        this.titleEl.textContent = this.shownTitle();
        this.namesSig = null;
        this.draw();
    }

    get unit() {
        return this.app.session.unitsPerNs || 1000;
    }

    ns(t) {
        return t / this.unit;
    }

    isOpen() {
        return Boolean(this.fw);
    }

    // A new session: no traces, no history.
    reset() {
        this.traces = [];
        this.hist.clear();
        this.selected = null;
        this.marker = this.delta = null;
        this.view = null;
        this.follow = true;
        this.begin = this.end = 0;
        this.draw();
    }

    // ----- Calls from IRSIM (analyzer/webana.c)

    handle(op, args, replaying) {
        switch(op) {
        case "addNode":
        case "addVector": {
            const [name, ndigits] = args;
            if(!this.traces.some(t => t.name === name)) {
                this.traces.push({name, kind: op === "addNode" ? "node" : "vector", bits: [name],
                    base: DIGITS_TO_BASE[ndigits] || null});
                this.namesStale = true;
            } else if(DIGITS_TO_BASE[ndigits]) {
                this.traces.find(t => t.name === name).base = DIGITS_TO_BASE[ndigits];
            }
            break;
        }
        case "remove":
            this.removeTrace(args[0], true);
            break;
        case "clear":
            this.traces = [];
            this.selected = null;
            break;
        case "show":
            if(!replaying) {
                this.open();
            }
            break;
        case "restart":
            this.hist.clear();
            this.namesStale = true;
            break;
        case "times":
            this.begin = args[0];
            this.end = Math.max(this.end, args[2]);
            break;
        case "time":
            this.advance(args[0]);
            break;
        }
        this.scheduleRefresh();
    }

    // The simulation reached time t: follow it if Scroll is on.
    advance(t) {
        const old = this.end;
        this.end = t;
        if(this.follow) {
            this.fullView();
        } else if(this.view && this.opts.scroll && t > old) {
            const [left, right] = this.view;
            if(right >= old - 1) {
                const width = right - left;
                this.view = width >= t - this.begin ? [this.begin, Math.max(t, this.begin + width)] : [t - width, t];
            }
        }
    }

    // ----- Window

    open() {
        if(this.fw) {
            this.fw.raise();
            this.scheduleRefresh();
            return;
        }
        const desktop = this.app.desktop;
        const width = Math.min(820, desktop.clientWidth - 24), height = Math.min(420, desktop.clientHeight - 24);
        this.fw = new FloatingWindow(desktop, {
            title: "Analyzer",
            x: Math.max(8, desktop.clientWidth - width - 12), y: 10, width, height,
            onClose: () => this.close(),
        });
        const body = document.createElement("div");
        body.className = "an-body";
        body.innerHTML = '<div class="an-top"><span class="an-title"></span></div>' +
            '<div class="an-scroll"><div class="an-scope"><div class="an-names" role="listbox" data-i18n-aria-label="Traces"></div>' +
            '<canvas class="an-display" tabindex="0" data-i18n-aria-label="Waveforms"></canvas><div class="an-values" data-i18n-aria-label="Values at the marker"></div></div>' +
            '<div class="an-empty" hidden data-i18n="No traces. Add some with Window > Manage Traces, or the ana command (for example: ana A B Y)."></div></div>' +
            '<div class="an-times" aria-live="polite"><span></span><span></span><span></span></div>' +
            '<div class="an-slide"><button type="button" data-act="full" data-i18n-title="Show all (v)">⤢</button>' +
            '<button type="button" data-act="begin" data-i18n-title="To the beginning">⏮</button>' +
            '<button type="button" data-act="left" data-i18n-title="Step left (←; Shift: further)">◀</button>' +
            '<canvas class="an-slider" data-i18n-aria-label="View position: click to centre, right-drag or Shift-drag an edge to resize"></canvas>' +
            '<button type="button" data-act="right" data-i18n-title="Step right (→; Shift: further)">▶</button>' +
            '<button type="button" data-act="end" data-i18n-title="To the end">⏭</button></div>';
        applyStatic(body);
        this.fw.body.appendChild(body);
        const top = body.querySelector(".an-top");
        top.prepend(menuBar(this.menus(), "Analyzer menu", {onDone: () => this.display.focus({preventScroll: true})}));
        this.titleEl = body.querySelector(".an-title");
        this.titleEl.textContent = this.shownTitle();
        this.names = body.querySelector(".an-names");
        this.values = body.querySelector(".an-values");
        this.display = body.querySelector(".an-display");
        this.slider = body.querySelector(".an-slider");
        this.emptyEl = body.querySelector(".an-empty");
        this.timeEls = [...body.querySelectorAll(".an-times span")];
        this.scroller = body.querySelector(".an-scroll");
        body.querySelector(".an-slide").addEventListener("click", event => {
            const act = event.target.closest("button")?.dataset.act;
            if(act) {
                this.action(act, event.shiftKey);
            }
        });
        this.listen();
        new ResizeObserver(() => this.draw()).observe(this.scroller);
        this.namesStale = true;
        this.scheduleRefresh();
    }

    close() {
        this.fw?.remove();
        this.fw = null;
    }

    // ----- Data

    scheduleRefresh() {
        if(this.refreshQueued) {
            return;
        }
        this.refreshQueued = true;
        requestAnimationFrame(() => {
            this.refreshQueued = false;
            this.refresh();
        });
    }

    // Fetch what's new in every traced node's history, then redraw.
    async refresh() {
        if(this.fetching) {
            this.refetch = true;
            return;
        }
        const session = this.app.session;
        if(!session.started || session.busy) {
            this.draw();
            return;
        }
        this.fetching = (async () => {
            if(this.namesStale) {
                this.namesStale = false;
                await this.resolveVectors();
            }
            const nodes = [...new Set(this.traces.flatMap(t => t.bits))];
            const groups = new Map();
            for(const name of nodes) {
                const since = this.hist.get(name)?.upTo ?? -1;
                if(!groups.has(since)) {
                    groups.set(since, []);
                }
                groups.get(since).push(name);
            }
            for(const [since, names] of groups) {
                const text = await session.history(names, since);
                for(const line of text.split("\n")) {
                    if(!line) {
                        continue;
                    }
                    const [name, list] = line.split("\t");
                    const nums = list.trim() ? list.trim().split(" ").map(Number) : [];
                    let h = this.hist.get(name);
                    if(!h || since < 0) {
                        h = {t: [], v: [], upTo: -1};
                        this.hist.set(name, h);
                    }
                    for(let i = 0; i < nums.length; i += 2) {
                        // Entries before "since" are known. One at "since" itself may be new: inputs
                        // set with h, l or x take effect at the start of the next step, which is the
                        // time of the last fetch.
                        if(h.t.length && nums[i] < since) {
                            continue;
                        }
                        if(h.t.length && nums[i] === h.t[h.t.length - 1]) {
                            h.v[h.v.length - 1] = nums[i + 1];
                        } else {
                            h.t.push(nums[i]);
                            h.v.push(nums[i + 1]);
                        }
                    }
                    h.upTo = session.time;
                }
            }
            this.end = Math.max(this.end, session.time);
            if(this.follow) {
                this.fullView();
            }
        })();
        try {
            await this.fetching;
        } catch(e) {
            // The session restarted; the next refresh fetches again.
        }
        this.fetching = null;
        this.draw();
        this.app.traceManager?.refresh();
        if(this.refetch) {
            this.refetch = false;
            this.scheduleRefresh();
        }
    }

    // Vectors' bits come from IRSIM's vector list.
    async resolveVectors() {
        if(!this.traces.some(t => t.kind === "vector")) {
            return;
        }
        const {vectors} = await this.app.session.names();
        const map = new Map(vectors.split("\n").filter(Boolean).map(l => {
            const [name, ...bits] = l.split("\t");
            return [name, bits];
        }));
        for(const t of this.traces) {
            if(t.kind === "vector" && map.has(t.name)) {
                t.bits = map.get(t.name);
            }
        }
    }

    // ----- Trace list

    traceBase(t) {
        return t.base || this.opts.base;
    }

    valueText(t, time) {
        if(t.kind === "node") {
            return nodeText(bitAt(this.hist.get(t.name), time));
        }
        return vectorText(t.bits.map(b => bitAt(this.hist.get(b), time)), this.traceBase(t));
    }

    shownName(name) {
        const n = this.opts.nameLength;
        return n > 0 && name.length > n ? "…" + name.slice(-n) : name;
    }

    removeTrace(name, fromIrsim) {
        this.traces = this.traces.filter(t => t.name !== name);
        if(this.selected === name) {
            this.selected = null;
        }
        if(!fromIrsim) {
            this.draw();
            this.app.traceManager?.refresh();
        }
    }

    select(name) {
        this.selected = name;
        this.draw();
    }

    moveTrace(name, toIndex) {
        const i = this.traces.findIndex(t => t.name === name);
        if(i < 0) {
            return;
        }
        const [t] = this.traces.splice(i, 1);
        this.traces.splice(Math.max(0, Math.min(this.traces.length, toIndex)), 0, t);
        this.draw();
    }

    // ----- View

    fullView() {
        const end = Math.max(this.end, this.begin + 1);
        this.view = [this.begin, end];
        this.follow = true;
    }

    ensureView() {
        if(!this.view) {
            this.fullView();
        }
    }

    setView(left, right) {
        const minWidth = 1;
        if(right - left < minWidth) {
            right = left + minWidth;
        }
        this.view = [left, right];
        this.follow = false;
        this.draw();
    }

    zoom(factor, about) {
        this.ensureView();
        const [l, r] = this.view;
        const c = about ?? (this.marker ?? (l + r) / 2);
        this.setView(c - (c - l) * factor, c + (r - c) * factor);
    }

    stepSize(shift) {
        const width = this.view[1] - this.view[0];
        const set = shift ? this.opts.sstep : this.opts.step;
        return set ? set * this.unit : width * (shift ? 0.5 : 0.1);
    }

    action(act, shift) {
        this.ensureView();
        const [l, r] = this.view, w = r - l;
        switch(act) {
        case "full":
            this.fullView();
            break;
        case "begin":
            this.view = [this.begin, this.begin + w];
            this.follow = false;
            break;
        case "end":
            this.view = [Math.max(this.begin, this.end - w), Math.max(this.end, this.begin + w)];
            this.follow = false;
            break;
        case "left":
        case "right": {
            const d = this.stepSize(shift) * (act === "left" ? -1 : 1);
            this.view = [l + d, r + d];
            this.follow = false;
            break;
        }
        }
        this.draw();
    }

    zoomToDelta() {
        if(this.marker !== null && this.delta !== null && this.marker !== this.delta) {
            this.setView(Math.min(this.marker, this.delta), Math.max(this.marker, this.delta));
        }
    }

    // ----- Menus

    menus() {
        const zoom = [
            {label: "In", action: () => this.zoom(0.5)},
            {label: "Out", action: () => this.zoom(2)},
            {label: "Full", action: () => this.action("full")},
        ];
        const base = () => {
            const sel = this.traces.find(t => t.name === this.selected);
            const current = sel && sel.kind === "vector" ? this.traceBase(sel) : this.opts.base;
            return BASES.map(([key, label]) => ({label, checked: () => key === current, action: () => {
                if(sel && sel.kind === "vector") {
                    sel.base = key;
                } else {
                    this.opts.base = key;
                    for(const t of this.traces) {
                        t.base = null;
                    }
                }
                this.draw();
            }}));
        };
        const number = async (title, label, value, apply) => {
            const v = await ask({title, fields: [{name: "v", label, value: value ?? ""}]});
            if(v) {
                apply(v.v);
                this.draw();
            }
        };
        const windowMenu = () => [
            {label: "Manage Traces", action: () => this.app.openTraceManager()},
            {label: "Name Length", action: () => number("Name length", "Characters of each name to show (0: all)",
                this.opts.nameLength, v => {
                    this.opts.nameLength = Math.max(0, parseInt(v, 10) || 0);
                })},
            {label: "Scroll", checked: () => this.opts.scroll, action: () => {
                this.opts.scroll = !this.opts.scroll;
            }},
            {label: "Scroll Step", action: () => number("Scroll step", "Step for ← and → in ns (empty: a tenth of the view)",
                this.opts.step, v => {
                    this.opts.step = parseFloat(v) > 0 ? parseFloat(v) : null;
                })},
            {label: "Shift Step", action: () => number("Shift step", "Step for Shift+← and Shift+→ in ns (empty: half the view)",
                this.opts.sstep, v => {
                    this.opts.sstep = parseFloat(v) > 0 ? parseFloat(v) : null;
                })},
            "-",
            {label: "Move To…", action: () => number("Move to", "Time at the left edge, in ns",
                this.view ? formatNs(this.ns(this.view[0])) : "", v => {
                    const t = parseFloat(v) * this.unit;
                    if(Number.isFinite(t)) {
                        this.ensureView();
                        const w = this.view[1] - this.view[0];
                        this.view = [t, t + w];
                        this.follow = false;
                    }
                })},
            {label: "Set Width…", action: () => number("Set width", "Width of the view, in ns",
                this.view ? formatNs(this.ns(this.view[1] - this.view[0])) : "", v => {
                    const w = parseFloat(v) * this.unit;
                    if(w > 0) {
                        this.ensureView();
                        this.view = [this.view[0], this.view[0] + w];
                        this.follow = false;
                    }
                })},
            "-",
            {label: "Remove Selected Trace", disabled: !this.selected, action: () => this.removeTrace(this.selected)},
            {label: "Clear All Traces", action: () => this.app.run("clear")},
        ];
        const print = [
            {label: "File…", action: () => this.printDialog()},
            {label: "Title…", action: async () => {
                const v = await ask({title: "Title", fields: [{name: "t", label: "Title", value: this.shownTitle()}]});
                if(v) {
                    // The default title, left as it is, stays the default (and follows the language).
                    this.opts.title = !v.t || v.t === t(DEFAULT_TITLE) ? DEFAULT_TITLE : v.t;
                    this.titleEl.textContent = this.shownTitle();
                }
            }},
            "-",
            ...["banner", "legend", "times", "outline"].map(key => ({label: key[0].toUpperCase() + key.slice(1),
                checked: () => this.opts[key], action: () => {
                    this.opts[key] = !this.opts[key];
                }})),
        ];
        return [["Zoom", zoom], ["Base", base], ["Window", windowMenu], ["Print", print]];
    }

    async printDialog() {
        const v = await ask({title: "Print to file", message: "Banner, Legend, Times and Outline in the Print menu choose what goes on the page.",
            fields: [{name: "format", label: "Format", options: [["ps", "PostScript (.ps)"], ["svg", "SVG (.svg)"], ["png", "PNG image (.png)"]]},
                {name: "name", label: "File name", value: (this.app.projectName || "analyzer")}], ok: "Save"});
        if(!v) {
            return;
        }
        const name = (v.name || "analyzer").replace(/\.(ps|svg|png)$/i, "") + "." + v.format;
        const blob = await this.exportFigure(v.format);
        this.app.saveBlob(name, blob);
    }

    // ----- Mouse and keys

    timeAt(x) {
        const [l, r] = this.view;
        return l + (x / Math.max(1, this.display.clientWidth)) * (r - l);
    }

    listen() {
        const d = this.display;
        const point = e => {
            const rect = d.getBoundingClientRect();
            return {x: e.clientX - rect.left, y: e.clientY - rect.top};
        };
        let drag = null;
        d.addEventListener("contextmenu", e => e.preventDefault());
        d.addEventListener("pointerenter", () => {
            if(!document.activeElement?.matches("input, textarea, select")) {
                d.focus({preventScroll: true});        // Tk: focus follows the pointer
            }
        });
        d.addEventListener("pointerdown", e => {
            this.ensureView();
            const p = point(e);
            d.focus({preventScroll: true});
            if(e.button === 1) {
                e.preventDefault();
                this.marker = this.delta = null;
                this.draw();
                return;
            }
            const isDelta = e.button === 2 || (e.button === 0 && e.shiftKey);
            if(e.button !== 0 && !isDelta) {
                return;
            }
            e.preventDefault();
            d.setPointerCapture(e.pointerId);
            drag = isDelta ? "delta" : "marker";
            if(drag === "marker") {
                const row = Math.floor((p.y - RULER) / ROW);
                if(this.traces[row]) {
                    this.selected = this.traces[row].name;
                }
                this.marker = this.timeAt(p.x);
            } else {
                this.delta = this.timeAt(p.x);
            }
            this.draw();
        });
        d.addEventListener("pointermove", e => {
            if(!drag) {
                return;
            }
            const t = this.timeAt(point(e).x);
            if(drag === "marker") {
                this.marker = t;
            } else {
                this.delta = t;
            }
            this.draw();
        });
        const up = () => {
            drag = null;
        };
        d.addEventListener("pointerup", up);
        d.addEventListener("pointercancel", up);
        d.addEventListener("wheel", e => {
            if(!this.view) {
                return;
            }
            if(e.ctrlKey || e.metaKey) {
                e.preventDefault();
                this.zoom(Math.exp(e.deltaY * 0.005), this.timeAt(point(e).x));
            } else if(e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                e.preventDefault();
                const [l, r] = this.view, dt = ((e.deltaX || e.deltaY) / d.clientWidth) * (r - l);
                this.view = [l + dt, r + dt];
                this.follow = false;
                this.draw();
            }
        }, {passive: false});
        d.addEventListener("keydown", e => {
            this.ensureView();
            const keys = {
                ArrowLeft: () => this.action("left", e.shiftKey),
                ArrowRight: () => this.action("right", e.shiftKey),
                z: () => (this.delta !== null && this.marker !== null ? this.zoomToDelta() : this.zoom(2)),
                Z: () => this.zoom(0.5),
                v: () => this.action("full"),
                Escape: () => {
                    this.marker = this.delta = null;
                    this.draw();
                },
                Delete: () => this.selected && this.removeTrace(this.selected),
                Backspace: () => this.selected && this.removeTrace(this.selected),
                ArrowUp: () => this.selectStep(-1),
                ArrowDown: () => this.selectStep(1),
            };
            const fn = keys[e.key];
            if(fn && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                fn();
            }
        });

        // Names: click selects, drag reorders, the × removes.
        let moving = null;
        this.names.addEventListener("pointerdown", e => {
            const row = e.target.closest(".an-name");
            if(!row || e.button !== 0) {
                return;
            }
            if(e.target.closest(".an-x")) {
                this.removeTrace(row.dataset.name);
                return;
            }
            this.select(row.dataset.name);
            moving = {name: row.dataset.name, y: e.clientY, moved: false};
            this.names.setPointerCapture(e.pointerId);
        });
        this.names.addEventListener("pointermove", e => {
            if(!moving) {
                return;
            }
            const rect = this.names.getBoundingClientRect();
            const index = Math.floor((e.clientY - rect.top - RULER) / ROW);
            if(Math.abs(e.clientY - moving.y) > 4) {
                moving.moved = true;
            }
            const current = this.traces.findIndex(t => t.name === moving.name);
            if(moving.moved && index !== current && index >= 0 && index < this.traces.length) {
                this.moveTrace(moving.name, index);
            }
        });
        const stop = () => {
            moving = null;
        };
        this.names.addEventListener("pointerup", stop);
        this.names.addEventListener("pointercancel", stop);

        // Slider.
        let slide = null;
        this.slider.addEventListener("contextmenu", e => e.preventDefault());
        this.slider.addEventListener("pointerdown", e => {
            this.ensureView();
            e.preventDefault();
            this.slider.setPointerCapture(e.pointerId);
            const resize = e.button === 2 || e.shiftKey;
            const t = this.sliderTime(e);
            if(resize) {
                const [l, r] = this.view;
                slide = {edge: Math.abs(t - l) < Math.abs(t - r) ? 0 : 1};
            } else {
                slide = {edge: -1};
            }
            this.slideTo(t, slide);
        });
        this.slider.addEventListener("pointermove", e => {
            if(slide) {
                this.slideTo(this.sliderTime(e), slide);
            }
        });
        const endSlide = () => {
            slide = null;
        };
        this.slider.addEventListener("pointerup", endSlide);
        this.slider.addEventListener("pointercancel", endSlide);
    }

    selectStep(step) {
        const i = this.traces.findIndex(t => t.name === this.selected);
        const next = this.traces[Math.max(0, Math.min(this.traces.length - 1, i + step))];
        if(next) {
            this.select(next.name);
        }
    }

    sliderRange() {
        const [l, r] = this.view;
        return [Math.min(this.begin, l), Math.max(this.end, r, this.begin + 1)];
    }

    sliderTime(e) {
        const rect = this.slider.getBoundingClientRect();
        const [a, b] = this.sliderRange();
        return a + ((e.clientX - rect.left) / Math.max(1, rect.width)) * (b - a);
    }

    slideTo(t, slide) {
        const [l, r] = this.view;
        this.follow = false;
        if(slide.edge < 0) {
            const w = r - l;
            this.view = [t - w / 2, t + w / 2];
        } else if(slide.edge === 0) {
            this.view = [Math.min(t, r - 1), r];
        } else {
            this.view = [l, Math.max(t, l + 1)];
        }
        this.draw();
    }

    // ----- Drawing

    colors() {
        return {
            bg: cssVar("--panel", "#ffffff"), fg: cssVar("--fg", "#1d1d1f"), grid: cssVar("--rule", "#dddddd"),
            muted: cssVar("--muted", "#5f6368"), accent: cssVar("--accent", "#4c26b8"), x: cssVar("--an-x", "#c5221f"),
            marker: cssVar("--an-marker", "#c5221f"), delta: cssVar("--an-delta", "#1a73e8"),
            input: cssVar("--an-input", "#1e6b3a"), select: cssVar("--an-select", "#ffd27a"),
        };
    }

    draw() {
        if(!this.fw || this.fw.geometry.collapsed || !this.display) {
            return;
        }
        this.ensureView();
        this.emptyEl.hidden = this.traces.length > 0;
        this.drawNames();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(10, this.display.clientWidth);
        const height = RULER + Math.max(1, this.traces.length) * ROW;
        this.display.style.height = height + "px";
        this.display.width = Math.round(width * dpr);
        this.display.height = Math.round(height * dpr);
        const ctx = this.display.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const c = this.colors();
        ctx.fillStyle = c.bg;
        ctx.fillRect(0, 0, width, height);
        const pen = new CanvasPen(ctx);
        this.drawWaves(pen, 0, 0, width, c, true);
        this.drawMarkers(pen, 0, height, width, c);
        this.drawTimes();
        this.drawSlider(c);
    }

    drawNames() {
        const sig = this.traces.map(t => t.name).join("\n") + "|" + this.selected + "|" + this.opts.nameLength;
        if(sig !== this.namesSig) {
            this.namesSig = sig;
            this.names.textContent = "";
            for(const trace of this.traces) {
                const row = document.createElement("div");
                row.className = "an-name" + (trace.name === this.selected ? " selected" : "");
                row.dataset.name = trace.name;
                row.setAttribute("role", "option");
                row.setAttribute("aria-selected", String(trace.name === this.selected));
                row.title = trace.kind === "vector" ? t("{name} (vector: {bits})", {name: trace.name, bits: trace.bits.join(" ")}) : trace.name;
                row.textContent = this.shownName(trace.name);
                const x = document.createElement("button");
                x.type = "button";
                x.className = "an-x";
                x.textContent = "✕";
                x.title = t("Remove from the analyzer");
                x.setAttribute("aria-label", t("Remove {name}", {name: trace.name}));
                row.appendChild(x);
                this.names.appendChild(row);
            }
        }
        const at = this.marker;
        const vsig = this.traces.map(t => (at === null ? "" : this.valueText(t, at))).join("\n");
        if(vsig !== this.valuesSig || this.values.childElementCount !== this.traces.length) {
            this.valuesSig = vsig;
            this.values.textContent = "";
            for(const text of vsig.split("\n").slice(0, this.traces.length)) {
                const cell = document.createElement("div");
                cell.className = "an-value";
                cell.textContent = text;
                this.values.appendChild(cell);
            }
        }
    }

    // Grid, ruler and the traces between x0 and x0 + width (pen coordinates).
    drawWaves(pen, x0, y0, width, c, screen) {
        const [l, r] = this.view, span = r - l;
        const xOf = t => x0 + ((t - l) / span) * width;
        const height = Math.max(1, this.traces.length) * ROW;

        // Time ruler and grid: about one tick every 90 px.
        const stepNs = niceStep(this.ns(span) / Math.max(1, width / 90));
        const first = Math.ceil(this.ns(l) / stepNs) * stepNs;
        for(let ns = first; ns <= this.ns(r) + 1e-9; ns += stepNs) {
            const x = xOf(ns * this.unit);
            pen.line(x, y0 + RULER - 4, x, y0 + RULER + height, c.grid, 1);
            const label = trimNs(ns, stepNs);
            if(x + 3 + pen.textWidth(label, 10) <= x0 + width) {
                pen.text(x + 3, y0 + 8, label, c.muted, 10, "left");
            }
        }
        pen.line(x0, y0 + RULER - 0.5, x0 + width, y0 + RULER - 0.5, c.grid, 1);
        // Time beyond the simulation so far is shaded.
        const endX = xOf(this.end);
        if(endX < x0 + width) {
            pen.rect(Math.max(x0, endX), y0 + RULER, x0 + width - Math.max(x0, endX), height, c.grid + "55");
        }

        pen.clip(x0, y0 + RULER, width, height);
        this.traces.forEach((t, i) => {
            const top = y0 + RULER + i * ROW + 4, bottom = y0 + RULER + (i + 1) * ROW - 5, mid = (top + bottom) / 2;
            if(screen && t.name === this.selected) {
                pen.rect(x0, top - 3, width, ROW - 1, c.select + "33");
            }
            pen.line(x0, y0 + RULER + (i + 1) * ROW - 0.5, x0 + width, y0 + RULER + (i + 1) * ROW - 0.5, c.grid, 1);
            if(t.kind === "node") {
                this.drawNode(pen, t, xOf, l, r, top, bottom, mid, c);
            } else {
                this.drawVector(pen, t, xOf, l, r, top, bottom, mid, c);
            }
        });
        pen.unclip();
    }

    // Segments of a node's history overlapping [l, r]: [{from, to, v}].
    segments(h, l, r) {
        const out = [];
        if(!h || !h.t.length) {
            return [{from: l, to: Math.min(r, this.end), v: 1}];
        }
        let i = Math.max(0, indexAt(h, l));
        const stop = Math.min(r, this.end);
        for(; i < h.t.length && h.t[i] <= stop; i++) {
            const from = Math.max(l, h.t[i]), to = Math.min(stop, i + 1 < h.t.length ? h.t[i + 1] : stop);
            if(to >= from) {
                out.push({from, to, v: h.v[i]});
            }
        }
        return out;
    }

    drawNode(pen, t, xOf, l, r, top, bottom, mid, c) {
        let lastY = null;
        for(const s of this.segments(this.hist.get(t.name), l, r)) {
            const x1 = xOf(s.from), x2 = xOf(s.to), v = s.v & 3;
            const color = s.v & 4 ? c.input : c.fg;
            if(v === 1) {
                pen.rect(x1, top, Math.max(1, x2 - x1), bottom - top, c.x + "40", c.x);
                lastY = null;
                continue;
            }
            const y = v === 3 ? top : v === 0 ? bottom : mid;
            if(lastY !== null && lastY !== y) {
                pen.line(x1, lastY, x1, y, color, 1.4);
            }
            pen.line(x1, y, x2, y, color, 1.4, v === 2 ? [3, 3] : null);
            lastY = y;
        }
    }

    drawVector(pen, t, xOf, l, r, top, bottom, mid, c) {
        // Merge the bits' change times inside the view, then draw one bus segment per value.
        const times = new Set([l]);
        for(const b of t.bits) {
            const h = this.hist.get(b);
            if(!h) {
                continue;
            }
            for(let i = Math.max(0, indexAt(h, l)); i < h.t.length && h.t[i] <= r; i++) {
                if(h.t[i] > l) {
                    times.add(h.t[i]);
                }
            }
        }
        const stop = Math.min(r, this.end);
        const list = [...times].filter(x => x <= stop).sort((a, b) => a - b);
        let prev = null;
        const segs = [];
        for(let i = 0; i < list.length; i++) {
            const text = this.valueText(t, list[i]);
            if(prev && prev.text === text) {
                prev.to = i + 1 < list.length ? list[i + 1] : stop;
                continue;
            }
            prev = {from: list[i], to: i + 1 < list.length ? list[i + 1] : stop, text};
            segs.push(prev);
        }
        for(const s of segs) {
            const x1 = xOf(s.from), x2 = xOf(s.to), slant = Math.min(3, (x2 - x1) / 2);
            const unknown = /X/.test(s.text);
            const color = unknown ? c.x : c.fg;
            pen.poly([x1, mid, x1 + slant, top, x2 - slant, top, x2, mid, x2 - slant, bottom, x1 + slant, bottom],
                unknown ? c.x + "30" : null, color, 1.2);
            const w = pen.textWidth(s.text, 11);
            if(w + 8 < x2 - x1) {
                pen.text((x1 + x2) / 2, mid, s.text, color, 11, "center");
            }
        }
    }

    drawMarkers(pen, x0, height, width, c) {
        const [l, r] = this.view;
        const xOf = t => x0 + ((t - l) / (r - l)) * width;
        if(this.marker !== null && this.delta !== null) {
            const a = xOf(Math.min(this.marker, this.delta)), b = xOf(Math.max(this.marker, this.delta));
            pen.rect(a, RULER, b - a, height - RULER, c.delta + "1f");
        }
        if(this.marker !== null) {
            pen.line(xOf(this.marker), 0, xOf(this.marker), height, c.marker, 1.2);
        }
        if(this.delta !== null) {
            pen.line(xOf(this.delta), 0, xOf(this.delta), height, c.delta, 1.2, [4, 3]);
        }
    }

    drawTimes() {
        const [l, r] = this.view;
        this.timeEls[0].textContent = formatNs(this.ns(l));
        this.timeEls[2].textContent = formatNs(this.ns(r));
        let mid = "";
        if(this.marker !== null) {
            mid = formatNs(this.ns(this.marker));
            if(this.delta !== null) {
                mid = t("{marker} {delta} (delta = {difference})", {marker: mid, delta: formatNs(this.ns(this.delta)),
                    difference: formatNs(this.ns(this.delta - this.marker))});
            }
        }
        this.timeEls[1].textContent = mid ? mid + " ns" : t("now {time} ns", {time: formatNs(this.ns(this.end))});
    }

    drawSlider(c) {
        const s = this.slider, dpr = window.devicePixelRatio || 1;
        const w = Math.max(10, s.clientWidth), h = Math.max(10, s.clientHeight);
        s.width = Math.round(w * dpr);
        s.height = Math.round(h * dpr);
        const ctx = s.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const [a, b] = this.sliderRange(), [l, r] = this.view;
        ctx.fillStyle = c.grid;
        ctx.fillRect(0, h / 2 - 3, w, 6);
        const x1 = ((l - a) / (b - a)) * w, x2 = ((r - a) / (b - a)) * w;
        ctx.fillStyle = c.accent;
        ctx.fillRect(x1, 2, Math.max(4, x2 - x1), h - 4);
    }

    // ----- Export (Print > File)

    figure(pen, width, c) {
        const nameWidth = this.opts.legend ? Math.max(60, ...this.traces.map(t => pen.textWidth(this.shownName(t.name), 11) + 16)) : 0;
        let y = 10;
        if(this.opts.banner) {
            // PostScript's fonts have no Japanese: the default title stays in English there.
            pen.text(10, y + 8, pen instanceof PsPen ? this.opts.title : this.shownTitle(), c.fg, 14, "left", false);
            pen.text(width - 10, y + 8, new Date().toLocaleString(), c.muted, 10, "right", false);
            y += 26;
        }
        const waveW = width - nameWidth - 20, x0 = 10 + nameWidth;
        const height = RULER + this.traces.length * ROW;
        if(this.opts.legend) {
            this.traces.forEach((t, i) => pen.text(14, y + RULER + i * ROW + ROW / 2, this.shownName(t.name), c.fg, 11));
        }
        this.drawWaves(pen, x0, y, waveW, c, false);
        if(this.opts.outline) {
            pen.rect(x0, y + RULER, waveW, height - RULER, null, c.fg);
        }
        y += height;
        if(this.opts.times) {
            const [l, r] = this.view;
            pen.text(x0, y + 10, formatNs(this.ns(l)) + " ns", c.muted, 10, "left");
            pen.text(x0 + waveW, y + 10, formatNs(this.ns(r)) + " ns", c.muted, 10, "right");
            y += 20;
        }
        return y + 10;
    }

    async exportFigure(format) {
        this.ensureView();
        const c = {bg: "#ffffff", fg: "#1d1d1f", grid: "#d8d8d8", muted: "#5f6368", accent: "#4c26b8", x: "#c5221f",
            marker: "#c5221f", delta: "#1a73e8", input: "#1e6b3a", select: "#ffd27a"};
        const width = 900;
        const probe = new SvgPen(width, 10);
        const height = this.figure(probe, width, c);
        if(format === "svg") {
            const pen = new SvgPen(width, height);
            this.figure(pen, width, c);
            return new Blob([pen.finish()], {type: "image/svg+xml"});
        }
        if(format === "ps") {
            const pen = new PsPen(width * 0.75, height * 0.75, this.opts.title);
            pen.out.push("0.75 0.75 scale");
            pen.height = height;
            this.figure(pen, width, c);
            pen.height = height * 0.75;
            return new Blob([pen.finish()], {type: "application/postscript"});
        }
        const canvas = document.createElement("canvas");
        canvas.width = width * 2;
        canvas.height = height * 2;
        const ctx = canvas.getContext("2d");
        ctx.scale(2, 2);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        this.figure(new CanvasPen(ctx), width, c);
        return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    }
}

function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
    for(const m of [1, 2, 5, 10]) {
        if(m * p >= raw) {
            return m * p;
        }
    }
    return 10 * p;
}

function trimNs(ns, step) {
    const digits = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
    return ns.toFixed(digits);
}
