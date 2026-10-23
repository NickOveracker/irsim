// SPDX-License-Identifier: GPL-2.0-or-later
// IRSIM in the browser: the console, the session (session.js, worker.js),
// the analyzer (analyzer.js), the trace manager (tracemgr.js), a Files
// window, and projects (files, folders, archives, a folder on disk or the
// browser's storage).

import {Session} from "./session.js";
import {Analyzer, formatNs} from "./analyzer.js";
import {TraceManager} from "./tracemgr.js";
import {FloatingWindow, topEdgeResizer, paneResizer} from "./floating-window.js";
import {menuBar, closeMenus} from "./menu.js";
import {ask, setHomeFocus} from "./dialog.js";
import {readArchive, isArchive, stripCommonFolder, cleanPath, writeTarGz} from "./archive.js";
import {receiveProject} from "./handoff.js";
import {diskSupported, DiskStore, BrowserStore, recentProjects, reopen, forget} from "./storage.js";
import {t, register, applyStatic, languageButton, onLanguageChange} from "./i18n.js";

const $ = selector => document.querySelector(selector);
const desktop = $("#desktop");
const log = $("#log");
const commandInput = $("#command");
const statusEl = $("#status");

// The page's text in Japanese (i18n.js); the English is in the code.  IRSIM's own output,
// commands, node names and file names stay as they are.
register({
    // Menus and windows
    "Page menu": "ページメニュー",
    // The page (index.html)
    "switch-level simulator · WebAssembly": "スイッチレベルシミュレーター · WebAssembly",
    "Help": "ヘルプ",
    "Stop": "停止",
    "Stop the command that is running": "実行中のコマンドを停止します",
    "Loading…": "読み込み中…",
    "Support on Ko-fi": "Ko-fi で支援",
    "IRSIM windows": "IRSIM のウィンドウ",
    "IRSIM console": "IRSIM のコンソール",
    "Show or hide the console": "コンソールの表示／非表示",
    "Project": "プロジェクト",
    "Examples": "サンプル",
    "Windows": "ウィンドウ",
    "About": "情報",
    "Files": "ファイル",
    "Analyzer": "アナライザー",
    "Manage Traces": "トレースの管理",
    "Resize the console": "コンソールのサイズを変更",
    "Resize the file list": "ファイル一覧の幅を変更",
    "Open files…": "ファイルを開く…",
    "Open folder (copy)…": "フォルダーを開く（コピー）…",
    "Work in a folder on disk…": "ディスク上のフォルダーで作業…",
    "Open a folder; files IRSIM writes and your edits are saved into it":
        "フォルダーを開きます。IRSIM が書き出すファイルと編集内容はそこに保存されます",
    "Save project to a folder on disk…": "プロジェクトをディスク上のフォルダーに保存…",
    "Copy this project into a folder and keep working there": "このプロジェクトをフォルダーにコピーし、そこで作業を続けます",
    "Keep project in browser storage": "プロジェクトをブラウザーのストレージに保存",
    "Saves into this browser (private to this site) and keeps it there":
        "このブラウザー内（このサイト専用）に保存し、以後もそこに保存します",
    "Needs Chrome, Edge or another Chromium browser (the File System Access API)":
        "Chrome、Edge などの Chromium 系ブラウザーが必要です（File System Access API）",
    "Reopen {name} (folder)": "{name} を再び開く（フォルダー）",
    "Reopen {name} (browser storage)": "{name} を再び開く（ブラウザーのストレージ）",
    "Forget recent projects…": "最近のプロジェクトを消去…",
    "Forget the recent projects? Folders on disk are not touched.":
        "最近のプロジェクトの一覧を消去しますか？ディスク上のフォルダーには手を加えません。",
    "Forget the recent projects? This deletes {names} from browser storage. Folders on disk are not touched.":
        "最近のプロジェクトの一覧を消去しますか？ブラウザーのストレージから {names} を削除します。ディスク上のフォルダーには手を加えません。",
    "Simulation setup…": "シミュレーションの設定…",
    "Restart simulation": "シミュレーションを再起動",
    "Download project (.tar.gz)": "プロジェクトをダウンロード（.tar.gz）",
    "Mirror full adder, sized for speed (default)": "ミラー型全加算器、速度重視のサイズ（既定）",
    "4×4 multiplier, sized for speed (vectors)": "4×4 乗算器、速度重視のサイズ（ベクトル）",
    "D flip-flop (clock)": "D フリップフロップ（クロック）",
    "C-element": "C 素子",
    "Inverter": "インバーター",
    "C-element, Stixu's own IRSIM export": "C 素子（Stixu 自身の IRSIM 書き出し）",
    "Inverter, Stixu's own IRSIM export": "インバーター（Stixu 自身の IRSIM 書き出し）",
    "4-bit counter, from Magic's tutorial 11": "4 ビットカウンター（Magic のチュートリアル 11 より）",
    "OpenRAM's D flip-flop (TSMC 0.35 µm parameters)": "OpenRAM の D フリップフロップ（TSMC 0.35 µm のパラメーター）",
    "IRSIM (Open Circuit Design)": "IRSIM（Open Circuit Design）",
    "IRSIM upstream source": "IRSIM の本家のソース",
    "IRSIM license (GPL 2)": "IRSIM のライセンス（GPL 2）",
    "Web app license (GPL 2 or later)": "ウェブアプリのライセンス（GPL 2 以降）",
    "Emscripten runtime license (MIT)": "Emscripten ランタイムのライセンス（MIT）",
    "This web app's source": "このウェブアプリのソース",
    // Dialogs
    "Simulation setup": "シミュレーションの設定",
    "IRSIM restarts with these files.": "IRSIM をこれらのファイルで再起動します。",
    "Parameter file (.prm)": "パラメーターファイル（.prm）",
    "{name} (project)": "{name}（プロジェクト）",
    "{name} (built in)": "{name}（組み込み）",
    "Network files (.sim), separated by spaces": "ネットワークファイル（.sim、空白区切り）",
    "Command file to run first (optional)": "最初に実行するコマンドファイル（任意）",
    "Stack series transistors (-s)": "直列トランジスタをまとめて扱う（-s）",
    "no": "いいえ",
    "yes": "はい",
    "Restart": "再起動",
    "New file": "新しいファイル",
    "File name": "ファイル名",
    "Create": "作成",
    // The Files window
    "Save": "保存",
    "Write the file (Ctrl+S)": "ファイルを書き込みます（Ctrl+S）",
    "Run": "実行",
    "Run it as a command file": "コマンドファイルとして実行します",
    "New…": "新規…",
    "Download": "ダウンロード",
    "Project files": "プロジェクトのファイル",
    "File contents": "ファイルの内容",
    "({n} bytes: too big to show)": "（{n} バイト。大きすぎて表示できません）",
    // The console and status
    "Running {command}…": "{command} を実行中…",
    "Ready": "準備完了",
    "no circuit": "回路なし",
    " · not saved to {where}!": " · {where} に保存できていません！",
    " · kept in {where}": " · {where} に保存中",
    " · in memory only": " · メモリ上のみ",
    "The session stays open in the browser; Project > Restart simulation starts it again.":
        "セッションはブラウザー内で開いたままです。「プロジェクト」>「シミュレーションを再起動」で起動し直せます。",
    "No circuit is running: open one from Examples or Project.":
        "実行中の回路がありません。「サンプル」か「プロジェクト」から開いてください。",
    "Couldn't load the parameter file {url}: HTTP {status}": "パラメーターファイル {url} を読み込めませんでした：HTTP {status}",
    "The project has no .sim file to simulate. Add one (Project > Open files) or choose one in Project > Simulation setup.":
        "このプロジェクトにはシミュレーションする .sim ファイルがありません。追加する（「プロジェクト」>「ファイルを開く」）か、" +
        "「プロジェクト」>「シミュレーションの設定」で選んでください。",
    "\"{path}\": IRSIM can't take file names with spaces; please rename it.":
        "「{path}」：IRSIM は空白を含むファイル名を扱えません。名前を変更してください。",
    "IRSIM could not start on these files.": "これらのファイルでは IRSIM を起動できませんでした。",
    "No files to load.": "読み込むファイルがありません。",
    "Opened {name}: {files}": "{name} を開きました：{files}",
    "Opened {name}: no files yet": "{name} を開きました：まだファイルはありません",
    "Loading {name}…": "{name} を読み込み中…",
    "Couldn't load the example {url}: HTTP {status}": "サンプル {url} を読み込めませんでした：HTTP {status}",
    "Restarting the simulation.": "シミュレーションを再起動します。",
    "Saved {files} to {where}": "{files} を {where} に保存しました",
    "Couldn't save to {where}: {why}": "{where} に保存できませんでした：{why}",
    "Reading {where}…": "{where} を読み込み中…",
    "Working in {where}: files IRSIM writes and your edits are saved there.":
        "{where} で作業しています。IRSIM が書き出すファイルと編集内容はそこに保存されます。",
    "Saved 1 file to {where}; later changes go there too.": "1 個のファイルを {where} に保存しました。以後の変更もそこに保存されます。",
    "Saved {n} files to {where}; later changes go there too.": "{n} 個のファイルを {where} に保存しました。以後の変更もそこに保存されます。",
    "Saved 1 file to {name}": "1 個のファイルを {name} に保存しました",
    "Saved {n} files to {name}": "{n} 個のファイルを {name} に保存しました",
    "Wrote {path}": "{path} を書き込みました",
    "Wrote {path} (Project > Restart simulation reads it again)":
        "{path} を書き込みました（「プロジェクト」>「シミュレーションを再起動」で読み込み直されます）",
    "From the {app} app: {name}": "{app} アプリから：{name}",
    "Drop .sim, .prm and .cmd files, a folder, or a .zip / .tar.gz to open it":
        ".sim、.prm、.cmd ファイル、フォルダー、または .zip / .tar.gz をドロップすると開きます",
    "IRSIM 9.7, Copyright (C) 1988, 1990 Stanford University; changed for this WebAssembly build in 2026 (the changes are listed in the source, About > This web app's source).":
        "IRSIM 9.7、Copyright (C) 1988, 1990 Stanford University。2026 年にこの WebAssembly 版のために変更されています（変更点はソースに記載。「情報」>「このウェブアプリのソース」）。",
    "IRSIM comes with ABSOLUTELY NO WARRANTY. It is free software: you may redistribute it under the terms of the GNU General Public License; About > IRSIM license shows a copy.":
        "IRSIM は完全に無保証です。IRSIM はフリーソフトウェアであり、GNU 一般公衆利用許諾書（GPL）の条件のもとで再頒布できます。その写しは「情報」>「IRSIM のライセンス」にあります。",
});

topEdgeResizer($("#console"), desktop, {label: "Resize the console"});

const EXAMPLES = {
    full_adder: "Mirror full adder, sized for speed (default)",
    mult4: "4×4 multiplier, sized for speed (vectors)",
    dff: "D flip-flop (clock)",
    c_element: "C-element",
    inverter: "Inverter",
    stixu_c_element: "C-element, Stixu's own IRSIM export",
    stixu_inverter: "Inverter, Stixu's own IRSIM export",
    tut11a: {label: "4-bit counter, from Magic's tutorial 11", files: ["tut11a.sim", "tut11a.cmd", "counter.cmd", "README.txt", "LICENSE"],
        cmd: "counter.cmd"},
    openram_dff: {label: "OpenRAM's D flip-flop (TSMC 0.35 µm parameters)", files: ["dff.sim", "dff.cmd", "README.txt", "LICENSE"],
        prm: "tsmc35.20.n98t.3.3"},
};
const exampleLabel = example => example.label || example;
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
        statusEl.textContent = t("Running {command}…", {command: session.current});
        return;
    }
    if(!project) {
        statusEl.textContent = t("Ready");
        return;
    }
    const where = project.store ? t(project.syncError ? " · not saved to {where}!" : " · kept in {where}", {where: project.store.label}) :
        t(" · in memory only");
    const circuit = session.started ? project.setup.sims.join(" ") : t("no circuit");
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
        print(t("The session stays open in the browser; Project > Restart simulation starts it again."), "info");
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
        print(t("No circuit is running: open one from Examples or Project."), "error");
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
            throw new Error(t("Couldn't load the parameter file {url}: HTTP {status}", {url, status: response.status}));
        }
        return {path: `/prm/${setup.prm}.prm`, data: new Uint8Array(await response.arrayBuffer())};
    }
    return null;
}

// Start IRSIM on the project's files with its setup.
async function startSimulation() {
    analyzer.reset();
    if(!project.setup.sims.length) {
        print(t("The project has no .sim file to simulate. Add one (Project > Open files) or choose one in Project > Simulation setup."), "error");
        session.started = false;
        updateStatus();
        return;
    }
    for(const path of [project.setup.prm, ...project.setup.sims]) {
        if(/\s/.test(path)) {
            print(t("\"{path}\": IRSIM can't take file names with spaces; please rename it.", {path}), "error");
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
        print(t("IRSIM could not start on these files."), "error");
    } else {
        traceManager.reload();
        if(project.setup.cmd) {
            await run(`@ ${project.setup.cmd}`);
        }
    }
    updateStatus();
}

let currentRun = null;

async function loadProject(name, files, store = null, setup = {}) {
    files = store ? files.filter(f => f.path) : stripCommonFolder(files.filter(f => f.path));
    name = name.replace(/\.(zip|tar|tgz|tar\.gz|sim|cmd|prm)$/i, "").replace(/[^\w.-]+/g, "_") || "project";
    if(!files.length && !store) {
        print(t("No files to load."), "error");
        return false;
    }
    const defaults = defaultSetup(name, files);
    project = {name, files, store, synced: new Map(), setup: {...defaults, prm: setup.prm || defaults.prm, cmd: setup.cmd || defaults.cmd}};
    document.title = `${name} · IRSIM`;
    print(files.length ? t("Opened {name}: {files}", {name, files: files.map(f => f.path).join(", ")}) : t("Opened {name}: no files yet", {name}), "info");
    currentRun = startSimulation();
    await currentRun;
    return true;
}

// An example is <name>.sim and <name>.cmd in examples/, or a folder, examples/<name>/, of the
// files it lists, with the setup it gives (a built-in parameter file, the command file to run).
async function loadExample(name) {
    statusEl.textContent = t("Loading {name}…", {name});
    const example = EXAMPLES[name];
    const paths = example.files ? example.files.map(f => [`examples/${name}/${f}`, f]) :
        ["sim", "cmd"].map(ext => [`examples/${name}.${ext}`, `${name}.${ext}`]);
    const files = [];
    for(const [path, file] of paths) {
        const url = here(path);
        const response = await fetch(url);
        if(!response.ok) {
            throw new Error(t("Couldn't load the example {url}: HTTP {status}", {url, status: response.status}));
        }
        files.push({path: file, data: new Uint8Array(await response.arrayBuffer())});
    }
    await loadProject(name, files, null, {prm: example.prm, cmd: example.cmd});
}

async function setupDialog() {
    if(!project) {
        return;
    }
    const paths = project.files.map(f => f.path);
    const prms = [...paths.filter(p => /\.prm$/i.test(p)).map(p => [p, t("{name} (project)", {name: p})]),
        ...BUILT_IN_PRMS.map(p => [p, t("{name} (built in)", {name: p})])];
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
        print(t("Restarting the simulation."), "info");
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
            print(t("Saved {files} to {where}", {files: written.join(", "), where: current.store.label}), "info");
            filesWindow.refresh();
        }
    } catch(error) {
        current.syncError = error;
        print(t("Couldn't save to {where}: {why}", {where: current.store.label, why: error.message || error}), "error");
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
    statusEl.textContent = t("Reading {where}…", {where: store.label});
    const files = await store.readAll();
    if(await loadProject(store.name, files, store)) {
        print(t("Working in {where}: files IRSIM writes and your edits are saved there.", {where: store.label}), "info");
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
    print(t(files.length === 1 ? "Saved 1 file to {where}; later changes go there too." : "Saved {n} files to {where}; later changes go there too.",
        {n: files.length, where: store.label}), "info");
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
    print(t(files.length === 1 ? "Saved 1 file to {name}" : "Saved {n} files to {name}", {n: files.length, name: project.name + ".tar.gz"}), "info");
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
            items.push({label: t(entry.kind === "disk" ? "Reopen {name} (folder)" : "Reopen {name} (browser storage)", {name: entry.name}),
                action: () => attempt(async () => openStore(await reopen(entry)))});
        }
        items.push({label: "Forget recent projects…", action: () => attempt(async () => {
            const stored = recent.filter(e => e.kind === "browser").map(e => e.name);
            const question = stored.length ? t("Forget the recent projects? This deletes {names} from browser storage. Folders on disk are not touched.",
                {names: stored.join(", ")}) : t("Forget the recent projects? Folders on disk are not touched.");
            if(window.confirm(question)) {
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
        this.fw.body.innerHTML = '<div class="files-body"><ul class="files-list" role="listbox" data-i18n-aria-label="Project files"></ul>' +
            '<div class="files-edit"><div class="files-bar"><button type="button" data-act="save" data-i18n="Save" data-i18n-title="Write the file (Ctrl+S)"></button>' +
            '<button type="button" data-act="run" data-i18n="Run" data-i18n-title="Run it as a command file"></button>' +
            '<button type="button" data-act="new" data-i18n="New…"></button><button type="button" data-act="download" data-i18n="Download"></button><span></span></div>' +
            '<textarea spellcheck="false" data-i18n-aria-label="File contents"></textarea></div></div>';
        applyStatic(this.fw.body);
        this.list = this.fw.body.querySelector(".files-list");
        paneResizer(this.list, {label: "Resize the file list", storageKey: "irsim-files-list-width"});
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
        this.text.value = !data ? "" : big ? t("({n} bytes: too big to show)", {n: data.length}) : decoder.decode(data);
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
        print(t(/\.(sim|prm)$/i.test(this.path) ? "Wrote {path} (Project > Restart simulation reads it again)" : "Wrote {path}", {path: this.path}), "info");
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
            statusEl.textContent = t("Reading {where}…", {where: list[0].name});
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
    const control = event.target.closest("button, input[type=checkbox], label, #kofi");
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
    ["Examples", Object.entries(EXAMPLES).map(([name, example]) => ({label: exampleLabel(example), action: () => attempt(() => loadExample(name))}))],
    ["Windows", windowsMenu],
    ["About", [
        {label: "IRSIM (Open Circuit Design)", href: "https://opencircuitdesign.com/irsim/"},
        {label: "IRSIM upstream source", href: "https://github.com/RTimothyEdwards/irsim"},
        "-",
        {label: "IRSIM license (GPL 2)", href: "https://github.com/NickOveracker/irsim/blob/wasm/COPYRIGHT"},
        {label: "Web app license (GPL 2 or later)", href: "https://github.com/NickOveracker/irsim/blob/wasm/licenses/GPL-2.0.txt"},
        {label: "Emscripten runtime license (MIT)", href: "https://github.com/NickOveracker/irsim/blob/wasm/licenses/emscripten-LICENSE"},
        "-",
        {label: "This web app's source", href: "https://github.com/NickOveracker/irsim/tree/wasm"},
    ]],
], "Page menu", {onDone: home}));

window.addEventListener("resize", () => analyzer.draw());

// The notice the GNU General Public License asks for when an interactive program starts:
// copyright, no warranty, redistribution, and where the licence is.
function announce() {
    print(t("IRSIM 9.7, Copyright (C) 1988, 1990 Stanford University; changed for this WebAssembly build in 2026 (the " +
        "changes are listed in the source, About > This web app's source)."), "info");
    print(t("IRSIM comes with ABSOLUTELY NO WARRANTY. It is free software: you may redistribute it under the terms of the " +
        "GNU General Public License; About > IRSIM license shows a copy."), "info");
}

// The page's static text, the language button, and what to redo when the language changes.
applyStatic();
$("#help-toggle").before(languageButton());
const dropText = () => (desktop.dataset.drop = t("Drop .sim, .prm and .cmd files, a folder, or a .zip / .tar.gz to open it"));
dropText();
onLanguageChange(() => {
    dropText();
    updateStatus();
    if(filesWindow.text?.readOnly) {
        filesWindow.show(filesWindow.path);
    }
});

async function start() {
    const handed = receiveProject();
    refreshRecent();
    announce();
    // A project from another of the apps (Magic's Open in the IRSIM App), or an example.
    const sent = await handed;
    if(sent) {
        print(t("From the {app} app: {name}", {app: sent.from, name: sent.name}), "info");
        await loadProject(sent.name, sent.files, null, sent.setup);
    } else {
        const name = new URLSearchParams(location.search).get("example");
        await loadExample(EXAMPLES[name] ? name : DEFAULT_EXAMPLE);
    }
    home();
}

start().catch(error => print(String(error.message || error), "error"));

// For tests and the browser console.
window.irsimApp = {run, session, analyzer, traceManager, filesWindow, loadProject, keepProject, openStore, BrowserStore,
    recentProjects, get project() {
        return project;
    }};
