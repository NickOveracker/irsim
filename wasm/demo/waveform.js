// Waveforms for IRSIM in the browser: a parser for IRSIM's trace output, an SVG waveform view, and a floating
// window (movable, resizable, collapsible, overlapping) to show it in. No dependencies.
//
// IRSIM's "t" (trace) command prints every transition of the traced nodes, for example
//     @ 50.52ns Y: 0 -> 1
//     @ 50.00ns input A: -> 1
// and each step ends with "time = 100.000ns".
(function(global) {
    "use strict";

    const SVG = "http://www.w3.org/2000/svg";

    // ----- Parsing

    // Signals in trace order (or the given order of names), each {name, input, initial, changes: [{t, v}]},
    // plus the simulated end time. Times are in ns; values are "0", "1" or "X".
    function parseTrace(text, order) {
        const byName = new Map();
        const transition = /@\s*([0-9.]+)ns\s+(input\s+)?([^\s:]+):\s*([01X]?)\s*->\s*([01X])/;
        const stepEnd = /time\s*=\s*([0-9.]+)ns/;
        let end = 0;

        text.split("\n").forEach(function(line) {
            const m = transition.exec(line);
            const s = stepEnd.exec(line);
            if(m) {
                const t = parseFloat(m[1]), name = m[3];
                if(!byName.has(name)) {
                    byName.set(name, {name: name, input: Boolean(m[2]), initial: m[4] || "X", changes: [],});
                }
                byName.get(name).changes.push({t: t, v: m[5],});
                end = Math.max(end, t);
            } else if(s) {
                end = Math.max(end, parseFloat(s[1]));
            }
        });

        const named = (order || []).filter(name => byName.has(name)).map(name => byName.get(name));
        const rest = Array.from(byName.values()).filter(signal => named.indexOf(signal) < 0);
        return {signals: named.concat(rest), end: end,};
    }

    // The value of a signal at time t: the last change at or before t.
    function valueAt(signal, t) {
        let lo = 0, hi = signal.changes.length - 1, found = -1;
        while(lo <= hi) {
            const mid = (lo + hi) >> 1;
            if(signal.changes[mid].t <= t) {
                found = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return found < 0 ? signal.initial : signal.changes[found].v;
    }

    // Tick spacing of 1, 2 or 5 times a power of ten, giving roughly the wanted number of ticks.
    function niceStep(span, ticks) {
        const raw = span / Math.max(1, ticks), power = Math.pow(10, Math.floor(Math.log10(raw)));
        const scaled = raw / power;
        return power * (scaled < 1.5 ? 1 : scaled < 3.5 ? 2 : scaled < 7.5 ? 5 : 10);
    }

    function formatTime(t, step) {
        const digits = Math.max(0, Math.min(4, -Math.floor(Math.log10(step))));
        return t.toFixed(digits) + " ns";
    }

    function svg(tag, attrs, parent) {
        const el = document.createElementNS(SVG, tag);
        Object.keys(attrs || {}).forEach(key => el.setAttribute(key, attrs[key]));
        if(parent) {
            parent.appendChild(el);
        }
        return el;
    }

    // ----- Waveform view

    class WaveformView {
        constructor(container) {
            this.container = container;
            this.trace = {signals: [], end: 0,};
            this.view = {t0: 0, t1: 1,};
            this.cursor = null;

            this.toolbar = document.createElement("div");
            this.toolbar.className = "wf-toolbar";
            [["−", "Zoom out", () => this.zoom(1.5)], ["+", "Zoom in", () => this.zoom(1 / 1.5)], ["Fit", "Show everything", () => this.fit()],]
                .forEach(([text, label, action]) => {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.textContent = text;
                    button.title = label;
                    button.setAttribute("aria-label", label);
                    button.onclick = action;
                    this.toolbar.appendChild(button);
                });
            this.readout = document.createElement("span");
            this.readout.className = "wf-readout";
            this.toolbar.appendChild(this.readout);

            this.plot = svg("svg", {class: "wf-svg", tabindex: "0", role: "img",});
            container.appendChild(this.toolbar);
            container.appendChild(this.plot);

            this.listen();
            new ResizeObserver(() => this.render()).observe(this.plot);
        }

        setTrace(trace) {
            this.trace = trace;
            this.plot.setAttribute("aria-label", trace.signals.length ?
                `Waveforms of ${trace.signals.map(s => s.name).join(", ")} from 0 to ${trace.end} ns` : "No traced signals");
            this.fit();
        }

        fit() {
            this.view = {t0: 0, t1: Math.max(this.trace.end, 1e-3),};
            this.render();
        }

        // Zoom by factor about time t (the middle of the view by default), within the traced span.
        zoom(factor, t) {
            const span = this.view.t1 - this.view.t0, end = Math.max(this.trace.end, 1e-3);
            const at = t === undefined ? (this.view.t0 + this.view.t1) / 2 : t;
            const newSpan = Math.min(end, Math.max(end * 1e-6, span * factor));
            const t0 = at - (at - this.view.t0) * newSpan / span;
            this.setView(t0, t0 + newSpan);
        }

        pan(dt) {
            this.setView(this.view.t0 + dt, this.view.t1 + dt);
        }

        setView(t0, t1) {
            const span = t1 - t0, end = Math.max(this.trace.end, 1e-3);
            const start = Math.min(Math.max(0, t0), Math.max(0, end - span));
            this.view = {t0: start, t1: start + span,};
            this.render();
        }

        geometry() {
            const longest = Math.max(1, ...this.trace.signals.map(signal => signal.name.length));
            const width = this.plot.clientWidth, names = Math.min(220, 32 + 7.5 * (longest + 4)), axis = 24, row = 30;
            return {width: width, names: names, axis: axis, row: row, plotWidth: Math.max(10, width - names - 8),
                height: axis + row * this.trace.signals.length + 8,};
        }

        timeAt(x) {
            const g = this.geometry();
            return this.view.t0 + (x - g.names) / g.plotWidth * (this.view.t1 - this.view.t0);
        }

        listen() {
            const plot = this.plot;
            let drag = null;

            plot.addEventListener("wheel", function(event) {
                event.preventDefault();
                const rect = plot.getBoundingClientRect();
                this.zoom(event.deltaY > 0 ? 1.25 : 0.8, this.timeAt(event.clientX - rect.left));
            }.bind(this), {passive: false,});

            plot.addEventListener("pointerdown", function(event) {
                drag = {x: event.clientX, t0: this.view.t0, t1: this.view.t1,};
                plot.setPointerCapture(event.pointerId);
            }.bind(this));
            plot.addEventListener("pointermove", function(event) {
                const rect = plot.getBoundingClientRect(), g = this.geometry();
                if(drag) {
                    const dt = (event.clientX - drag.x) / g.plotWidth * (drag.t1 - drag.t0);
                    this.setView(drag.t0 - dt, drag.t1 - dt);
                }
                const x = event.clientX - rect.left;
                this.cursor = x >= g.names ? this.timeAt(x) : null;
                this.render();
            }.bind(this));
            plot.addEventListener("pointerup", () => { drag = null; });
            plot.addEventListener("pointercancel", () => { drag = null; });
            plot.addEventListener("pointerleave", () => { if(!drag) { this.cursor = null; this.render(); } });
            plot.addEventListener("dblclick", () => this.fit());

            plot.addEventListener("keydown", function(event) {
                const span = this.view.t1 - this.view.t0;
                const actions = {"+": () => this.zoom(1 / 1.5), "=": () => this.zoom(1 / 1.5), "-": () => this.zoom(1.5),
                    "0": () => this.fit(), "Home": () => this.fit(), "ArrowLeft": () => this.pan(-span / 10), "ArrowRight": () => this.pan(span / 10),};
                if(actions[event.key]) {
                    event.preventDefault();
                    actions[event.key]();
                }
            }.bind(this));
        }

        render() {
            const plot = this.plot, g = this.geometry(), view = this.view, trace = this.trace;
            const x = t => g.names + (t - view.t0) / (view.t1 - view.t0) * g.plotWidth;
            plot.textContent = "";
            plot.setAttribute("height", g.height);
            plot.setAttribute("viewBox", `0 0 ${g.width} ${g.height}`);
            if(!trace.signals.length) {
                svg("text", {x: 12, y: 20, class: "wf-name",}, plot).textContent = "No traced signals. Add \"t node…\" to the commands.";
                this.readout.textContent = "";
                return;
            }

            const defs = svg("defs", {}, plot);
            const pattern = svg("pattern", {id: "wf-x-" + this.uid(), width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)",}, defs);
            svg("line", {x1: 0, y1: 0, x2: 0, y2: 6, class: "wf-x-hatch",}, pattern);
            const clip = svg("clipPath", {id: "wf-clip-" + this.uid(),}, defs);
            svg("rect", {x: g.names, y: 0, width: g.plotWidth, height: g.height,}, clip);

            // Time axis.
            const step = niceStep(view.t1 - view.t0, g.plotWidth / 90);
            for(let t = Math.ceil(view.t0 / step) * step; t <= view.t1 + 1e-9; t += step) {
                svg("line", {x1: x(t), y1: g.axis - 4, x2: x(t), y2: g.height, class: "wf-grid",}, plot);
                if(x(t) + 48 <= g.width) {
                    svg("text", {x: x(t) + 3, y: g.axis - 8, class: "wf-tick",}, plot).textContent = formatTime(t, step);
                }
            }

            const lanes = svg("g", {"clip-path": `url(#wf-clip-${this.uid()})`,}, plot);
            trace.signals.forEach(function(signal, i) {
                const top = g.axis + i * g.row + 6, bottom = top + g.row - 12, mid = (top + bottom) / 2;
                const name = svg("text", {x: 8, y: mid + 4, class: "wf-name" + (signal.input ? " wf-input" : ""),}, plot);
                name.textContent = signal.name + (this.cursor === null ? "" : " = " + valueAt(signal, this.cursor));

                // Segments of constant value over the view: from each change (or the start) to the next.
                const points = [{t: 0, v: signal.initial,}].concat(signal.changes);
                let d = "", joined = false;
                points.forEach(function(point, k) {
                    const from = Math.max(point.t, view.t0), to = Math.min(k + 1 < points.length ? points[k + 1].t : trace.end, view.t1);
                    if(to <= from) {
                        return;   // outside the view, or an instant (such as an input's start value at 0 ns)
                    }
                    if(point.v === "X") {
                        svg("rect", {x: x(from), y: top, width: Math.max(0.5, x(to) - x(from)), height: bottom - top,
                            class: "wf-x", fill: `url(#wf-x-${this.uid()})`,}, lanes);
                        joined = false;   // the line restarts after an unknown stretch
                        return;
                    }
                    const y = point.v === "1" ? top : bottom;
                    d += `${joined ? "L" : "M"}${x(from)},${y}L${x(to)},${y}`;
                    joined = true;
                }.bind(this));
                svg("path", {d: d, class: "wf-line" + (signal.input ? " wf-input" : ""),}, lanes);
            }.bind(this));

            if(this.cursor !== null && this.cursor >= view.t0 && this.cursor <= view.t1) {
                svg("line", {x1: x(this.cursor), y1: g.axis - 4, x2: x(this.cursor), y2: g.height, class: "wf-cursor",}, plot);
                this.readout.textContent = formatTime(this.cursor, step / 100);
            } else {
                this.readout.textContent = `${formatTime(view.t0, step)} – ${formatTime(view.t1, step)}`;
            }
        }

        uid() {
            if(!this.id) {
                WaveformView.count = (WaveformView.count || 0) + 1;
                this.id = WaveformView.count;
            }
            return this.id;
        }
    }

    // ----- Floating window

    // A window inside the page: drag it by the title bar, resize it from the right edge, bottom edge or corner,
    // collapse it to its title bar, and close it. Clicking a window brings it to the front. With the title bar
    // focused, arrow keys move it and Shift+arrow keys resize it. Its geometry is remembered per id.
    class FloatingWindow {
        constructor(options) {
            FloatingWindow.addStyles();
            this.id = options.id;
            this.onClose = options.onClose || null;
            this.min = {width: 220, height: 120,};

            const el = this.element = document.createElement("section");
            el.className = "fw-window";
            el.setAttribute("role", "dialog");
            el.setAttribute("aria-label", options.title);
            el.innerHTML = '<header class="fw-header" tabindex="0"><span class="fw-title"></span>' +
                '<button type="button" class="fw-button fw-collapse" aria-label="Collapse" title="Collapse">▾</button>' +
                '<button type="button" class="fw-button fw-close" aria-label="Close" title="Close">✕</button></header>' +
                '<div class="fw-body"></div>' +
                '<div class="fw-resize fw-e" data-edge="e"></div><div class="fw-resize fw-s" data-edge="s"></div>' +
                '<div class="fw-resize fw-se" data-edge="se"></div>';
            el.querySelector(".fw-title").textContent = options.title;
            this.header = el.querySelector(".fw-header");
            this.body = el.querySelector(".fw-body");
            document.body.appendChild(el);

            const saved = this.load();
            this.geometry = saved || {x: options.x, y: options.y, width: options.width, height: options.height, collapsed: false,};
            this.apply();
            this.listen();
            this.bringToFront();
        }

        static addStyles() {
            if(document.getElementById("fw-styles")) {
                return;
            }
            const style = document.createElement("style");
            style.id = "fw-styles";
            style.textContent = `
.fw-window { position: fixed; display: flex; flex-direction: column; box-sizing: border-box; min-width: 0;
  background: var(--fw-bg, #fff); color: var(--fw-fg, #1d1d1f); border: 1px solid var(--fw-rule, #ccc);
  border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.25); overflow: hidden; }
.fw-window[hidden] { display: none; }
.fw-header { display: flex; align-items: center; gap: 6px; padding: 6px 8px 6px 12px; cursor: move; user-select: none;
  touch-action: none; background: var(--fw-head, #f1eff7); border-bottom: 1px solid var(--fw-rule, #ccc); font-weight: 600; }
.fw-header:focus-visible { outline: 2px solid var(--fw-accent, #4C26B8); outline-offset: -2px; }
.fw-title { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fw-button { border: 0; background: none; color: inherit; font: inherit; width: 28px; height: 26px; border-radius: 6px; cursor: pointer; }
.fw-button:hover, .fw-button:focus-visible { background: var(--fw-rule, #ddd); }
.fw-body { flex: 1; overflow: auto; min-height: 0; }
.fw-window.fw-collapsed .fw-body, .fw-window.fw-collapsed .fw-resize { display: none; }
.fw-window.fw-collapsed .fw-header { border-bottom: 0; }
.fw-resize { position: absolute; touch-action: none; }
.fw-e { top: 0; right: 0; width: 8px; height: 100%; cursor: ew-resize; }
.fw-s { left: 0; bottom: 0; height: 8px; width: 100%; cursor: ns-resize; }
.fw-se { right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 55%, var(--fw-rule, #aaa) 55%, var(--fw-rule, #aaa) 62%, transparent 62%, transparent 72%, var(--fw-rule, #aaa) 72%, var(--fw-rule, #aaa) 79%, transparent 79%); }
.wf-toolbar { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--fw-rule, #ccc); }
.wf-toolbar button { font: inherit; min-width: 32px; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--fw-rule, #ccc);
  background: var(--fw-head, #f1eff7); color: inherit; cursor: pointer; }
.wf-readout { margin-left: auto; font: 12px ui-monospace, Menlo, monospace; color: var(--fw-muted, #5f6368); }
.wf-svg { display: block; width: 100%; touch-action: none; cursor: crosshair; }
.wf-svg:focus-visible { outline: 2px solid var(--fw-accent, #4C26B8); outline-offset: -2px; }
.wf-name { font: 12px ui-monospace, Menlo, monospace; fill: var(--fw-fg, #1d1d1f); }
.wf-name.wf-input { fill: var(--fw-accent, #4C26B8); }
.wf-tick { font: 10px ui-monospace, Menlo, monospace; fill: var(--fw-muted, #5f6368); }
.wf-grid { stroke: var(--fw-rule, #ddd); stroke-width: 1; }
.wf-line { fill: none; stroke: var(--fw-fg, #1d1d1f); stroke-width: 1.6; }
.wf-line.wf-input { stroke: var(--fw-accent, #4C26B8); }
.wf-x { stroke: var(--fw-x, #c5221f); stroke-width: 1; }
.wf-x-hatch { stroke: var(--fw-x, #c5221f); stroke-width: 1.5; }
.wf-cursor { stroke: var(--fw-x, #c5221f); stroke-width: 1; stroke-dasharray: 3 3; }
@media (prefers-color-scheme: dark) {
  .fw-window { --fw-bg: #1f2023; --fw-fg: #e8e8e8; --fw-rule: #3a3d42; --fw-head: #2a2b30; --fw-muted: #a0a4a8; --fw-accent: #A68CFF; --fw-x: #f27b74; }
}`;
            document.head.appendChild(style);
        }

        static nextZ() {
            FloatingWindow.z = (FloatingWindow.z || 1000) + 1;
            return FloatingWindow.z;
        }

        bringToFront() {
            this.element.style.zIndex = FloatingWindow.nextZ();
        }

        show() {
            this.element.hidden = false;
            this.bringToFront();
        }

        close() {
            this.element.hidden = true;
            if(this.onClose) {
                this.onClose();
            }
        }

        setCollapsed(collapsed) {
            this.geometry.collapsed = collapsed;
            this.apply();
            this.save();
        }

        // Keep at least part of the title bar on screen, and the window no smaller than its minimum.
        clamp() {
            const g = this.geometry, vw = window.innerWidth, vh = window.innerHeight;
            g.width = Math.max(this.min.width, Math.min(g.width, vw));
            g.height = Math.max(this.min.height, Math.min(g.height, vh));
            g.x = Math.min(Math.max(g.x, 60 - g.width), vw - 60);
            g.y = Math.min(Math.max(g.y, 0), vh - 36);
        }

        apply() {
            this.clamp();
            const g = this.geometry, el = this.element, collapsed = g.collapsed;
            el.style.left = g.x + "px";
            el.style.top = g.y + "px";
            el.style.width = g.width + "px";
            el.style.height = collapsed ? "auto" : g.height + "px";
            el.classList.toggle("fw-collapsed", collapsed);
            const button = el.querySelector(".fw-collapse");
            button.textContent = collapsed ? "▸" : "▾";
            button.setAttribute("aria-label", collapsed ? "Expand" : "Collapse");
            button.title = button.getAttribute("aria-label");
            button.setAttribute("aria-expanded", String(!collapsed));
        }

        listen() {
            const el = this.element;
            el.addEventListener("pointerdown", () => this.bringToFront(), true);
            el.querySelector(".fw-close").onclick = () => this.close();
            el.querySelector(".fw-collapse").onclick = () => this.setCollapsed(!this.geometry.collapsed);
            this.header.addEventListener("dblclick", event => {
                if(!event.target.closest(".fw-button")) {
                    this.setCollapsed(!this.geometry.collapsed);
                }
            });

            this.drag(this.header, function(start, dx, dy) {
                this.geometry.x = start.x + dx;
                this.geometry.y = start.y + dy;
            }.bind(this), event => !event.target.closest(".fw-button"));
            el.querySelectorAll(".fw-resize").forEach(function(handle) {
                const edge = handle.dataset.edge;
                this.drag(handle, function(start, dx, dy) {
                    if(edge.indexOf("e") >= 0) {
                        this.geometry.width = start.width + dx;
                    }
                    if(edge.indexOf("s") >= 0) {
                        this.geometry.height = start.height + dy;
                    }
                }.bind(this));
            }.bind(this));

            this.header.addEventListener("keydown", function(event) {
                const steps = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],};
                const step = steps[event.key];
                if(!step || event.target !== this.header) {
                    return;
                }
                event.preventDefault();
                const g = this.geometry, amount = event.altKey ? 1 : 16;
                if(event.shiftKey) {
                    g.width += step[0] * amount;
                    g.height += step[1] * amount;
                } else {
                    g.x += step[0] * amount;
                    g.y += step[1] * amount;
                }
                this.apply();
                this.save();
            }.bind(this));

            window.addEventListener("resize", () => this.apply());
        }

        // Pointer dragging on a handle: update(startGeometry, dx, dy) on each move. Works for mouse, touch and pen.
        drag(handle, update, accept) {
            let start = null;
            handle.addEventListener("pointerdown", function(event) {
                if(event.button !== 0 || (accept && !accept(event))) {
                    return;
                }
                event.preventDefault();
                start = {px: event.clientX, py: event.clientY, x: this.geometry.x, y: this.geometry.y,
                    width: this.geometry.width, height: this.geometry.height,};
                handle.setPointerCapture(event.pointerId);
            }.bind(this));
            handle.addEventListener("pointermove", function(event) {
                if(start) {
                    update(start, event.clientX - start.px, event.clientY - start.py);
                    this.apply();
                }
            }.bind(this));
            const stop = function() {
                if(start) {
                    start = null;
                    this.save();
                }
            }.bind(this);
            handle.addEventListener("pointerup", stop);
            handle.addEventListener("pointercancel", stop);
        }

        load() {
            try {
                const saved = JSON.parse(window.localStorage.getItem("fw-window:" + this.id));
                return saved && Number.isFinite(saved.x) ? saved : null;
            } catch(e) {
                return null;
            }
        }

        save() {
            try {
                window.localStorage.setItem("fw-window:" + this.id, JSON.stringify(this.geometry));
            } catch(e) {
                // Storage blocked: the window still works, it just won't remember where it was.
            }
        }
    }

    global.IrsimWaveforms = {parseTrace: parseTrace, valueAt: valueAt, WaveformView: WaveformView, FloatingWindow: FloatingWindow,};
})(window);
