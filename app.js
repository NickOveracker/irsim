// IRSIM in the browser: the console, the session (session.js, worker.js),
// the analyzer (analyzer.js), the trace manager (tracemgr.js), a Files
// window, and projects (files, folders, archives, a folder on disk or the
// browser's storage).

import {Session} from "./session.js";
import {Analyzer, formatNs} from "./analyzer.js";
import {TraceManager} from "./tracemgr.js";
import {FloatingWindow} from "./floating-window.js";
import {menuBar, closeMenus} from "./menu.js";
import {ask, setHomeFocus} from "./dialog.js";
import {readArchive, isArchive, stripCommonFolder, cleanPath, writeTarGz} from "./archive.js";
import {diskSupported, DiskStore, BrowserStore, recentProjects, reopen, forget} from "./storage.js";

const $ = selector => document.querySelector(selector);
const desktop = $("#desktop");
const log = $("#log");
const commandInput = $("#command");
const statusEl = $("#status");

const EXAMPLES = {
    full_adder: "Mirror full adder, sized for speed (default)",
    mult4: "4×4 multiplier, sized for speed (vectors)",
    dff: "D flip-flop (clock)",
    c_element: "C-element",
    inverter: "Inverter",
    stixu_c_element: "C-element, Stixu's own IRSIM export",
    stixu_inverter: "Inverter, Stixu's own IRSIM export",
};
const DEFAULT_EXAMPLE = "full_adder";
const BUILT_IN_PRMS = ["scmos100", "scmos30", "scmos35", "scmos50_3v", "scmos50_5v", "scmos60", "scmos1_6um", "scmos2um",
    "amiabn.80.n99z.5", "amic5.30.n98s.3.3", "amicwl.50.n97l.5", "hpcmos10.20.n98v.3.3", "hpcmos14.30.n9ae.3.3",
    "hpcmos26.40.n88x.5", "orbit.60.n96e.5", "tsmc18.10.nxxx.1.8", "tsmc25.15.n99y.2.5", "tsmc35.20.n98t.3.3",
    "tsmc35p.20.n98tp.3.3"];
// Relative to this file rather than the page, so the address the page was opened with
// (with or without a trailing slash, or from another page) doesn't matter.
const here = path => new URL(path, import.meta.url);
const PRM_URL = name => here(`src/lib/prm/${name}.prm`);

let project = null;          // {name, files: [{path, data}], store, synced, setup: {prm, sims, cmd, stack}}

// ----- Output

function print(text, kind) {
    const line = document.createElement("div");
    line.className = "log-line" + (kind ? " log-" + kind : "");
    line.textContent = text;
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
    log.appendChild(line);
    while(log.childElementCount > 5000) {
        log.firstElementChild.remove();
    }
    if(atBottom) {
        log.scrollTop = log.scrollHeight;
    }
}

function saveBlob(name, blob) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

// ----- The session and its windows

const app = {
    desktop,
    print,
    saveBlob,
    get projectName() {
        return project ? project.name : "irsim";
    },
    run: line => run(line),
    openTraceManager: () => traceManager.open(),
};

const session = new Session({
    onOutput: (text, error) => print(text, error ? "error" : null),
    onAnalyzer: (op, args, replaying) => analyzer.handle(op, args, replaying),
    onState: () => updateStatus(),
});
app.session = session;
const analyzer = app.analyzer = new Analyzer(app);
const traceManager = app.traceManager = new TraceManager(app);

function updateStatus() {
    $("#stop").hidden = !session.busy;
    if(session.busy) {
        statusEl.textContent = `Running ${session.current}…`;
        return;
    }
    if(!project) {
        statusEl.textContent = "Ready";
        return;
    }
    const where = project.store ? (project.syncError ? ` · not saved to ${project.store.label}!` : ` · kept in ${project.store.label}`) :
        " · in memory only";
    const circuit = session.started ? project.setup.sims.join(" ") : "no circuit";
    statusEl.textContent = `${project.name}: ${circuit} · ${formatNs(session.time / session.unitsPerNs)} ns${where}`;
}

// Commands the Tcl version of IRSIM adds on top of the C commands.
function frontEnd(line) {
    const [cmd, ...args] = line.trim().split(/\s+/);
    if(cmd === "w" || cmd === "watchnode") {
        return args.length ? "ana " + args.join(" ") : "ana";
    }
    if(cmd === "watchtime") {
        analyzer.open();
        return null;
    }
    if(cmd === "unwatchnode") {
        for(const name of args) {
            analyzer.removeTrace(name);
        }
        return null;
    }
    if(cmd === "exit" || cmd === "q") {
        print("The session stays open in the browser; Project > Restart simulation starts it again.", "info");
        return null;
    }
    return line;
}

// Run a command line, echoed in the console.
async function run(line, {echo = true} = {}) {
    if(echo) {
        print("irsim> " + line, "command");
    }
    const real = frontEnd(line);
    if(real === null || !real.trim()) {
        return;
    }
    if(!session.started) {
        print("No circuit is running: open one from Examples or Project.", "error");
        return;
    }
    try {
        const reply = await session.run(real);
        if(!reply.ended && /^\s*(vector|set|ana|analyzer|clear)\b/.test(real)) {
            traceManager.reload();
        }
    } catch(error) {
        if(error.message !== "stopped") {
            print(String(error.message || error), "error");
        }
    }
    analyzer.scheduleRefresh();
    scheduleSync();
    updateStatus();
}

// ----- Projects

const decoder = new TextDecoder();

function defaultSetup(name, files) {
    const paths = files.map(f => f.path);
    const sims = paths.filter(p => /\.sim$/i.test(p));
    const prms = paths.filter(p => /\.prm$/i.test(p));
    const base = p => p.split("/").pop().replace(/\.\w+$/, "");
    const sim = sims.find(p => base(p) === name) || sims.find(p => paths.includes(p.replace(/\.sim$/i, ".cmd"))) || sims[0];
    const cmd = sim && paths.find(p => p === sim.replace(/\.sim$/i, ".cmd"));
    return {prm: prms[0] || "scmos100", sims: sim ? [sim] : [], cmd: cmd || "", stack: false};
}

async function prmFile(setup) {
    if(BUILT_IN_PRMS.includes(setup.prm)) {
        const url = PRM_URL(setup.prm);
        const response = await fetch(url);
        if(!response.ok) {
            throw new Error(`Couldn't load the parameter file ${url}: HTTP ${response.status}`);
        }
        return {path: `/prm/${setup.prm}.prm`, data: new Uint8Array(await response.arrayBuffer())};
    }
    return null;
}

// Start IRSIM on the project's files with its setup.
async function startSimulation() {
    analyzer.reset();
    if(!project.setup.sims.length) {
        print("The project has no .sim file to simulate. Add one (Project > Open files) or choose one in Project > Simulation setup.", "error");
        session.started = false;
        updateStatus();
        return;
    }
    for(const path of [project.setup.prm, ...project.setup.sims]) {
        if(/\s/.test(path)) {
            print(`"${path}": IRSIM can't take file names with spaces; please rename it.`, "error");
        }
    }
    const builtIn = await prmFile(project.setup);
    const files = builtIn ? [...project.files, builtIn] : project.files;
    const args = [project.setup.stack ? "-s" : "", builtIn ? builtIn.path : project.setup.prm, ...project.setup.sims].filter(Boolean).join(" ");
    print(`irsim ${args}`, "info");
    const ok = await session.start(files, args);
    project.synced = new Map((await session.listFiles()).map(f => [f.path, f.mtime]));
    filesWindow.refresh();
    if(!ok) {
        print("IRSIM could not start on these files.", "error");
    } else {
        traceManager.reload();
        if(project.setup.cmd) {
            await run(`@ ${project.setup.cmd}`);
        }
    }
    updateStatus();
}

let currentRun = null;

async function loadProject(name, files, store = null) {
    files = store ? files.filter(f => f.path) : stripCommonFolder(files.filter(f => f.path));
    name = name.replace(/\.(zip|tar|tgz|tar\.gz|sim|cmd|prm)$/i, "").replace(/[^\w.-]+/g, "_") || "project";
    if(!files.length && !store) {
        print("No files to load.", "error");
        return false;
    }
    project = {name, files, store, synced: new Map(), setup: defaultSetup(name, files)};
    document.title = `${name} · IRSIM`;
    print(`Opened ${name}: ${files.map(f => f.path).join(", ") || "no files yet"}`, "info");
    currentRun = startSimulation();
    await currentRun;
    return true;
}

async function loadExample(name) {
    statusEl.textContent = `Loading ${name}…`;
    const files = [];
    for(const ext of ["sim", "cmd"]) {
        const url = here(`examples/${name}.${ext}`);
        const response = await fetch(url);
        if(!response.ok) {
            throw new Error(`Couldn't load the example ${url}: HTTP ${response.status}`);
        }
        files.push({path: `${name}.${ext}`, data: new Uint8Array(await response.arrayBuffer())});
    }
    await loadProject(name, files);
}

async function setupDialog() {
    if(!project) {
        return;
    }
    const paths = project.files.map(f => f.path);
    const prms = [...paths.filter(p => /\.prm$/i.test(p)).map(p => [p, p + " (project)"]), ...BUILT_IN_PRMS.map(p => [p, p + " (built in)"])];
    const v = await ask({title: "Simulation setup", message: "IRSIM restarts with these files.", fields: [
        {name: "prm", label: "Parameter file (.prm)", options: prms},
        {name: "sims", label: "Network files (.sim), separated by spaces", value: project.setup.sims.join(" "),
            list: paths.filter(p => /\.sim$/i.test(p))},
        {name: "cmd", label: "Command file to run first (optional)", value: project.setup.cmd, list: paths.filter(p => /\.cmd$/i.test(p))},
        {name: "stack", label: "Stack series transistors (-s)", options: [["no", "no"], ["yes", "yes"]]},
    ], ok: "Restart"});
    if(v) {
        project.setup = {prm: v.prm, sims: v.sims.split(/\s+/).filter(Boolean), cmd: v.cmd, stack: v.stack === "yes"};
        await startSimulation();
    }
}

async function restart() {
    if(project) {
        print("Restarting the simulation.", "info");
        await startSimulation();
    }
}

// ----- Keeping projects (storage.js)

let syncTimer = null, syncing = false, syncAgain = false;

function scheduleSync() {
    if(!project || !project.store || syncTimer) {
        return;
    }
    syncTimer = setTimeout(() => {
        syncTimer = null;
        syncProject();
    }, 300);
}

// Copy files IRSIM wrote (and edits) into the project's store.
async function syncProject() {
    if(!project || !project.store || !session.started) {
        return;
    }
    if(syncing) {
        syncAgain = true;
        return;
    }
    syncing = true;
    const current = project;
    try {
        const written = [];
        for(const f of await session.listFiles()) {
            if(current.synced.get(f.path) !== f.mtime) {
                const data = await session.readFile(f.path);
                await current.store.write(f.path, data);
                session.remember(f.path, data);
                const known = current.files.find(x => x.path === f.path);
                known ? (known.data = data) : current.files.push({path: f.path, data});
                current.synced.set(f.path, f.mtime);
                written.push(f.path);
            }
        }
        current.syncError = null;
        if(written.length) {
            print(`Saved ${written.join(", ")} to ${current.store.label}`, "info");
            filesWindow.refresh();
        }
    } catch(error) {
        current.syncError = error;
        print(`Couldn't save to ${current.store.label}: ${error.message || error}`, "error");
    } finally {
        syncing = false;
        updateStatus();
        if(syncAgain) {
            syncAgain = false;
            syncProject();
        }
    }
}

// The project's files as they are now (including what IRSIM wrote).
async function currentFiles() {
    if(!session.started) {
        return project.files;
    }
    const files = [];
    for(const f of await session.listFiles()) {
        files.push({path: f.path, data: await session.readFile(f.path)});
    }
    return files;
}

let recent = [];

async function refreshRecent() {
    recent = await recentProjects();
}

async function openStore(store) {
    statusEl.textContent = `Reading ${store.label}…`;
    const files = await store.readAll();
    if(await loadProject(store.name, files, store)) {
        print(`Working in ${store.label}: files IRSIM writes and your edits are saved there.`, "info");
    }
    refreshRecent();
}

async function keepProject(store) {
    if(!project) {
        return;
    }
    const files = await currentFiles();
    for(const f of files) {
        await store.write(f.path, f.data);
    }
    project.store = store;
    project.files = files;
    project.synced = new Map((session.started ? await session.listFiles() : []).map(f => [f.path, f.mtime]));
    print(`Saved ${files.length} file${files.length === 1 ? "" : "s"} to ${store.label}; later changes go there too.`, "info");
    updateStatus();
    refreshRecent();
}

async function download() {
    if(!project) {
        return;
    }
    const files = await currentFiles();
    saveBlob(project.name + ".tar.gz", new Blob([await writeTarGz(files.map(f => ({path: project.name + "/" + f.path, data: f.data})))],
        {type: "application/gzip"}));
    print(`Saved ${files.length} file${files.length === 1 ? "" : "s"} to ${project.name}.tar.gz`, "info");
}

async function attempt(work) {
    try {
        await work();
    } catch(error) {
        if(error && error.name === "AbortError") {
            return;
        }
        print(String(error.message || error), "error");
        updateStatus();
    }
}

const NEEDS_CHROMIUM = "Needs Chrome, Edge or another Chromium browser (the File System Access API)";

function projectMenu() {
    const items = [
        {label: "Open files…", action: () => $("#pick-files").click()},
        {label: "Open folder (copy)…", action: () => $("#pick-folder").click()},
        "-",
        {label: "Work in a folder on disk…", disabled: !diskSupported, title: diskSupported ?
            "Open a folder; files IRSIM writes and your edits are saved into it" : NEEDS_CHROMIUM,
        action: () => attempt(async () => openStore(await DiskStore.pick()))},
        {label: "Save project to a folder on disk…", disabled: !diskSupported || !project, title: diskSupported ?
            "Copy this project into a folder and keep working there" : NEEDS_CHROMIUM,
        action: () => attempt(async () => keepProject(await DiskStore.pick()))},
        {label: "Keep project in browser storage", disabled: !project || project.store instanceof BrowserStore,
            title: "Saves into this browser (private to this site) and keeps it there",
            action: () => attempt(async () => keepProject(await BrowserStore.create(project.name)))},
    ];
    if(recent.length) {
        items.push("-");
        for(const entry of recent.slice(0, 8)) {
            items.push({label: `Reopen ${entry.name} (${entry.kind === "disk" ? "folder" : "browser storage"})`,
                action: () => attempt(async () => openStore(await reopen(entry)))});
        }
        items.push({label: "Forget recent projects…", action: () => attempt(async () => {
            const stored = recent.filter(e => e.kind === "browser").map(e => e.name);
            const warning = stored.length ? ` This deletes ${stored.join(", ")} from browser storage.` : "";
            if(window.confirm(`Forget the recent projects?${warning} Folders on disk are not touched.`)) {
                for(const entry of recent) {
                    await forget(entry.id);
                }
                await refreshRecent();
            }
        })});
    }
    items.push("-",
        {label: "Simulation setup…", disabled: !project, action: () => attempt(setupDialog)},
        {label: "Restart simulation", disabled: !project, action: () => attempt(restart)},
        "-",
        {label: "Download project (.tar.gz)", disabled: !project, action: () => attempt(download)});
    return items;
}

const windowsMenu = () => [
    {label: "Analyzer", checked: () => analyzer.isOpen(), action: () => (analyzer.isOpen() ? analyzer.close() : analyzer.open())},
    {label: "Manage Traces", checked: () => traceManager.isOpen(), action: () => (traceManager.isOpen() ? traceManager.close() : traceManager.open())},
    {label: "Files", checked: () => filesWindow.isOpen(), action: () => (filesWindow.isOpen() ? filesWindow.close() : filesWindow.open())},
];

// ----- Files window: view, edit and run the project's files

class FilesWindow {
    constructor() {
        this.fw = null;
        this.path = null;
    }

    isOpen() {
        return Boolean(this.fw);
    }

    open() {
        if(this.fw) {
            this.fw.raise();
            return;
        }
        this.fw = new FloatingWindow(desktop, {
            title: "Files", x: 16, y: 12, width: Math.min(560, desktop.clientWidth - 32), height: Math.min(340, desktop.clientHeight - 24),
            onClose: () => this.close(),
        });
        this.fw.body.innerHTML = '<div class="files-body"><ul class="files-list" role="listbox" aria-label="Project files"></ul>' +
            '<div class="files-edit"><div class="files-bar"><button type="button" data-act="save" title="Write the file (Ctrl+S)">Save</button>' +
            '<button type="button" data-act="run" title="Run it as a command file">Run</button>' +
            '<button type="button" data-act="new">New…</button><button type="button" data-act="download">Download</button><span></span></div>' +
            '<textarea spellcheck="false" aria-label="File contents"></textarea></div></div>';
        this.list = this.fw.body.querySelector(".files-list");
        this.text = this.fw.body.querySelector("textarea");
        this.label = this.fw.body.querySelector(".files-bar span");
        this.list.addEventListener("click", e => {
            const li = e.target.closest("li");
            if(li) {
                this.show(li.dataset.path);
            }
        });
        this.fw.body.querySelector(".files-bar").addEventListener("click", e => {
            const act = e.target.closest("button")?.dataset.act;
            if(act) {
                attempt(() => this[act]());
            }
        });
        this.text.addEventListener("keydown", e => {
            if(e.key === "s" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                attempt(() => this.save());
            }
        });
        this.refresh();
    }

    close() {
        this.fw?.remove();
        this.fw = null;
    }

    async refresh() {
        if(!this.fw || !project) {
            return;
        }
        const paths = session.started ? (await session.listFiles()).map(f => f.path) : project.files.map(f => f.path);
        paths.sort();
        this.list.textContent = "";
        for(const path of paths) {
            const li = document.createElement("li");
            li.dataset.path = path;
            li.textContent = path;
            li.setAttribute("role", "option");
            li.setAttribute("aria-selected", String(path === this.path));
            this.list.appendChild(li);
        }
        if(!this.path && paths.length) {
            this.show(project.setup.cmd || paths[0]);
        }
    }

    async show(path) {
        this.path = path;
        const data = session.started ? await session.readFile(path) : project.files.find(f => f.path === path)?.data;
        const big = data && data.length > 2e6;
        this.text.value = !data ? "" : big ? `(${data.length} bytes: too big to show)` : decoder.decode(data);
        this.text.readOnly = big;
        this.label.textContent = path;
        for(const li of this.list.children) {
            li.setAttribute("aria-selected", String(li.dataset.path === path));
        }
    }

    async save() {
        if(!this.path || this.text.readOnly) {
            return;
        }
        const data = new TextEncoder().encode(this.text.value);
        await session.writeFile(this.path, data);
        const known = project.files.find(f => f.path === this.path);
        known ? (known.data = data) : project.files.push({path: this.path, data});
        print(`Wrote ${this.path}${/\.(sim|prm)$/i.test(this.path) ? " (Project > Restart simulation reads it again)" : ""}`, "info");
        scheduleSync();
    }

    async run() {
        if(this.path) {
            await this.save();
            await run(`@ ${this.path}`);
        }
    }

    async new() {
        const v = await ask({title: "New file", fields: [{name: "path", label: "File name", value: "test.cmd"}], ok: "Create"});
        if(v && v.path) {
            const path = cleanPath(v.path);
            await session.writeFile(path, new Uint8Array());
            project.files.push({path, data: new Uint8Array()});
            await this.refresh();
            await this.show(path);
            this.text.focus();
        }
    }

    async download() {
        if(this.path) {
            const data = session.started ? await session.readFile(this.path) : project.files.find(f => f.path === this.path)?.data;
            saveBlob(this.path.split("/").pop(), new Blob([data || new Uint8Array()]));
        }
    }
}

const filesWindow = new FilesWindow();

// ----- Opening files

async function filesFromInput(fileList) {
    const files = [];
    for(const file of fileList) {
        files.push({path: cleanPath(file.webkitRelativePath || file.name), data: new Uint8Array(await file.arrayBuffer())});
    }
    return files;
}

async function openFiles(fileList, folderName) {
    try {
        const list = Array.from(fileList);
        if(list.length === 1 && isArchive(list[0].name)) {
            statusEl.textContent = `Reading ${list[0].name}…`;
            await loadProject(list[0].name, await readArchive(list[0].name, new Uint8Array(await list[0].arrayBuffer())));
            return;
        }
        const files = await filesFromInput(list);
        const sim = files.find(f => /\.sim$/i.test(f.path));
        const name = folderName || (sim ? sim.path.split("/").pop() : files[0]?.path.split("/")[0]) || "project";
        await loadProject(name, files);
    } catch(error) {
        print(String(error.message || error), "error");
        updateStatus();
    }
}

async function readEntry(entry, prefix) {
    if(entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        return [{path: cleanPath(prefix + file.name), data: new Uint8Array(await file.arrayBuffer())}];
    }
    const reader = entry.createReader(), files = [];
    for(;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if(!batch.length) {
            break;
        }
        for(const child of batch) {
            files.push(...await readEntry(child, prefix + entry.name + "/"));
        }
    }
    return files;
}

$("#pick-files").addEventListener("change", event => {
    openFiles(event.target.files);
    event.target.value = "";
});
$("#pick-folder").addEventListener("change", event => {
    const first = event.target.files[0];
    openFiles(event.target.files, first ? first.webkitRelativePath.split("/")[0] : null);
    event.target.value = "";
});
document.addEventListener("dragover", event => {
    if(event.dataTransfer?.types?.includes("Files")) {
        event.preventDefault();
        document.body.classList.add("dragging");
    }
});
document.addEventListener("dragleave", event => {
    if(!event.relatedTarget) {
        document.body.classList.remove("dragging");
    }
});
document.addEventListener("drop", async event => {
    if(!event.dataTransfer?.types?.includes("Files")) {
        return;
    }
    event.preventDefault();
    document.body.classList.remove("dragging");
    const entries = Array.from(event.dataTransfer.items || []).filter(i => i.kind === "file")
        .map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if(entries.length === 1 && entries[0].isDirectory) {
        await attempt(async () => loadProject(entries[0].name, await readEntry(entries[0], "")));
        return;
    }
    await openFiles(event.dataTransfer.files);
});

// ----- Command line

const history = [];
let historyIndex = 0;

commandInput.addEventListener("keydown", event => {
    if(event.key === "Enter") {
        const line = commandInput.value.trim();
        commandInput.value = "";
        if(line) {
            if(history[history.length - 1] !== line) {
                history.push(line);
            }
            historyIndex = history.length;
            run(line);
        }
    } else if(event.key === "ArrowUp" && historyIndex > 0) {
        commandInput.value = history[--historyIndex];
        event.preventDefault();
    } else if(event.key === "ArrowDown") {
        historyIndex = Math.min(history.length, historyIndex + 1);
        commandInput.value = history[historyIndex] || "";
        event.preventDefault();
    }
});

$("#stop").addEventListener("click", () => session.stop());
$("#console-toggle").addEventListener("click", () => {
    const collapsed = $("#console").classList.toggle("collapsed");
    $("#console-toggle").setAttribute("aria-expanded", String(!collapsed));
});

// ----- Help

function showHelp(show) {
    $("#help").hidden = !show;
    $("#help-toggle").setAttribute("aria-expanded", String(show));
}
$("#help-toggle").addEventListener("click", () => showHelp($("#help").hidden));
document.addEventListener("pointerdown", event => {
    if(!$("#help").hidden && !event.target.closest("#help, #help-toggle")) {
        showHelp(false);
    }
}, true);

// ----- Keyboard focus
//
// The command line is home: controls used with the mouse give the keyboard
// back to it (or leave it where the pointer put it, such as the analyzer's
// display); controls used with the keyboard keep focus.  Escape first closes
// the help or a menu.

function home() {
    commandInput.focus({preventScroll: true});
}

document.addEventListener("keydown", event => {
    if(event.key !== "Escape" || event.defaultPrevented) {
        return;
    }
    if(!$("#help").hidden) {
        event.preventDefault();
        const fromKeyboard = document.activeElement?.closest?.("#help, #help-toggle");
        showHelp(false);
        fromKeyboard ? $("#help-toggle").focus() : home();
    } else if(document.querySelector(".mb-menu")) {
        closeMenus();
    }
});
document.addEventListener("click", event => {
    const control = event.target.closest("button, input[type=checkbox], label");
    if(event.detail === 0 || !control || control.closest("dialog, .mb-menu, .mb-bar, #help, .files-bar, .command-row")) {
        return;
    }
    setTimeout(() => {
        const active = document.activeElement;
        if(active === document.body || active === control || control.contains(active)) {
            home();
        }
    }, 0);
});
setHomeFocus(home);

// ----- Start

$("#top-menus").appendChild(menuBar([
    ["Project", projectMenu],
    ["Examples", Object.entries(EXAMPLES).map(([name, label]) => ({label, action: () => attempt(() => loadExample(name))}))],
    ["Windows", windowsMenu],
    ["About", [
        {label: "IRSIM license (GPL 2)", href: "https://github.com/NickOveracker/irsim/blob/wasm/COPYRIGHT"},
        {label: "Emscripten runtime license (MIT)", href: "https://github.com/emscripten-core/emscripten/blob/main/LICENSE"},
        "-",
        {label: "Source code", href: "https://github.com/NickOveracker/irsim/tree/wasm"},
    ]],
    ["Ko-fi", "https://ko-fi.com/twentynine"],
], "Page menu", {onDone: home}));

window.addEventListener("resize", () => analyzer.draw());

async function start() {
    refreshRecent();
    const name = new URLSearchParams(location.search).get("example");
    await loadExample(EXAMPLES[name] ? name : DEFAULT_EXAMPLE);
    home();
}

start().catch(error => print(String(error.message || error), "error"));

// For tests and the browser console.
window.irsimApp = {run, session, analyzer, traceManager, filesWindow, loadProject, keepProject, openStore, BrowserStore,
    recentProjects, get project() {
        return project;
    }};
