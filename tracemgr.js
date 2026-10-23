// SPDX-License-Identifier: GPL-2.0-or-later
// Manage Traces: the web counterpart of the Tk "IRSIM node and vector lists"
// window (.nodelist in tcltk/irsim.tcl.in).  Click a node or vector on the
// left to add it to the analyzer (through IRSIM's own "ana" command); click
// one on the right to take it out.

import {FloatingWindow} from "./floating-window.js";
import {t, register, applyStatic, onLanguageChange} from "./i18n.js";

// This window's text in Japanese (i18n.js), here rather than in an app, since the Magic app
// loads this file too.  Node and vector names stay as they are.
register({
    "IRSIM node and vector lists": "IRSIM のノードとベクトルの一覧",
    "Filter (a * wildcard is fine)": "絞り込み（* ワイルドカード可）",
    "Filter names": "名前の絞り込み",
    "Add every node that matches the filter": "絞り込みに一致するノードをすべて追加します",
    "Add matching": "一致するものを追加",
    "Nodes": "ノード",
    "Nodes in Analyzer": "アナライザー内のノード",
    "Vectors": "ベクトル",
    "Vectors in Analyzer": "アナライザー内のベクトル",
    "… {n} more (use the filter)": "… ほか {n} 個（絞り込みを使ってください）",
});

const STYLES = `
.tm-body { display: flex; flex-direction: column; height: 100%; font-size: 12px; }
.tm-bar { display: flex; gap: 6px; align-items: center; padding: 6px; border-bottom: 1px solid var(--rule); }
.tm-bar input { flex: 1; min-width: 0; font: 12px var(--mono); color: inherit; background: var(--log-bg);
  border: 1px solid var(--rule); border-radius: 4px; padding: 3px 6px; }
.tm-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 6px; padding: 6px; }
.tm-pane { display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--rule); border-radius: 6px; overflow: hidden; }
.tm-pane h3 { margin: 0; padding: 3px 8px; font-size: 12px; background: var(--head); border-bottom: 1px solid var(--rule); }
.tm-list { flex: 1; overflow: auto; margin: 0; padding: 2px 0; list-style: none; font: 12px var(--mono); }
.tm-list li { padding: 1px 8px; cursor: pointer; white-space: nowrap; }
.tm-list li:hover, .tm-list li:focus { background: var(--accent-soft); outline: none; }
.tm-list li.tm-more { color: var(--muted); cursor: default; }
`;

const LIMIT = 2000;

export class TraceManager {
    constructor(app) {
        this.app = app;
        this.fw = null;
        this.names = null;
        if(!document.getElementById("tm-styles")) {
            const style = document.createElement("style");
            style.id = "tm-styles";
            style.textContent = STYLES;
            document.head.appendChild(style);
        }
        onLanguageChange(() => {
            if(this.fw) {
                applyStatic(this.fw.body);
                this.refresh();
            }
        });
    }

    isOpen() {
        return Boolean(this.fw);
    }

    open() {
        if(this.fw) {
            this.fw.raise();
            this.reload();
            return;
        }
        const desktop = this.app.desktop;
        this.fw = new FloatingWindow(desktop, {
            title: "IRSIM node and vector lists",
            x: 16, y: Math.min(140, desktop.clientHeight - 300), width: Math.min(460, desktop.clientWidth - 32), height: 360,
            onClose: () => this.close(),
            topmost: true,
        });
        const body = document.createElement("div");
        body.className = "tm-body";
        body.innerHTML = '<div class="tm-bar"><input type="search" data-i18n-placeholder="Filter (a * wildcard is fine)" data-i18n-aria-label="Filter names">' +
            '<button type="button" data-act="all" data-i18n-title="Add every node that matches the filter" data-i18n="Add matching"></button></div>' +
            '<div class="tm-grid">' +
            '<section class="tm-pane"><h3 data-i18n="Nodes"></h3><ul class="tm-list" data-list="nodes"></ul></section>' +
            '<section class="tm-pane"><h3 data-i18n="Nodes in Analyzer"></h3><ul class="tm-list" data-list="usednodes"></ul></section>' +
            '<section class="tm-pane"><h3 data-i18n="Vectors"></h3><ul class="tm-list" data-list="vectors"></ul></section>' +
            '<section class="tm-pane"><h3 data-i18n="Vectors in Analyzer"></h3><ul class="tm-list" data-list="usedvectors"></ul></section></div>';
        applyStatic(body);
        this.fw.body.appendChild(body);
        this.filter = body.querySelector("input");
        this.filter.addEventListener("input", () => this.refresh());
        body.querySelector("[data-act=all]").addEventListener("click", () => {
            const free = this.matching(this.names?.nodes || []).filter(n => !this.inAnalyzer(n));
            if(free.length) {
                this.app.run("ana " + free.slice(0, 200).join(" "));
            }
        });
        body.addEventListener("click", event => this.choose(event.target.closest("li[data-name]")));
        body.addEventListener("keydown", event => {
            if(event.key === "Enter") {
                this.choose(event.target.closest("li[data-name]"));
            }
        });
        this.reload();
    }

    close() {
        this.fw?.remove();
        this.fw = null;
    }

    // Names come from IRSIM; read them again after a new circuit or new vectors.
    async reload() {
        if(!this.app.session.started) {
            return;
        }
        const {nodes, vectors} = await this.app.session.names();
        this.names = {
            nodes: nodes.split("\n").filter(Boolean).map(l => l.split("\t")[0]).sort((a, b) => a.localeCompare(b, undefined, {numeric: true})),
            vectors: vectors.split("\n").filter(Boolean).map(l => l.split("\t")[0]).sort(),
        };
        this.refresh();
    }

    inAnalyzer(name) {
        return this.app.analyzer.traces.some(t => t.name === name);
    }

    matching(list) {
        const f = this.filter?.value.trim();
        if(!f) {
            return list;
        }
        const re = new RegExp("^" + f.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + (f.includes("*") ? "$" : ""), "i");
        return list.filter(n => re.test(n));
    }

    refresh() {
        if(!this.fw || !this.names) {
            return;
        }
        const traces = this.app.analyzer.traces;
        const fill = (key, items) => {
            const ul = this.fw.body.querySelector(`[data-list=${key}]`);
            ul.textContent = "";
            for(const name of items.slice(0, LIMIT)) {
                const li = document.createElement("li");
                li.dataset.name = name;
                li.dataset.kind = key;
                li.tabIndex = 0;
                li.textContent = name;
                ul.appendChild(li);
            }
            if(items.length > LIMIT) {
                const li = document.createElement("li");
                li.className = "tm-more";
                li.textContent = t("… {n} more (use the filter)", {n: items.length - LIMIT});
                ul.appendChild(li);
            }
        };
        fill("nodes", this.matching(this.names.nodes.filter(n => !this.inAnalyzer(n))));
        fill("usednodes", traces.filter(t => t.kind === "node").map(t => t.name));
        fill("vectors", this.matching(this.names.vectors.filter(n => !this.inAnalyzer(n))));
        fill("usedvectors", traces.filter(t => t.kind === "vector").map(t => t.name));
    }

    choose(li) {
        if(!li) {
            return;
        }
        const name = li.dataset.name;
        if(li.dataset.kind === "nodes" || li.dataset.kind === "vectors") {
            this.app.run(`ana ${name}`);
        } else {
            this.app.analyzer.removeTrace(name);
        }
    }
}
