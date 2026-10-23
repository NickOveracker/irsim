// SPDX-License-Identifier: GPL-2.0-or-later
// IRSIM in a Web Worker.
//
// Session protocol (the web app, session.js):
//   {type: "start", id, files: [{path, data}], args}  start "irsim <args>" in /work
//   {type: "command", id, line}                       run one command line
//   {type: "history", id, names, since}               node histories (irsim_web_history)
//   {type: "names", id}                               node and vector names
//   {type: "files", id}                               [{path, mtime, size}] under /work
//   {type: "read", id, path} / {type: "write", id, path, data}
// The worker answers {type: "reply", id, ...}, and while a command runs it
// streams {type: "out", text, error} and {type: "ana", op, args} (the analyzer
// calls from analyzer/webana.c).  "exit" or a crash ends with {type: "ended"}.
//
// One-shot protocol (kept for existing callers): {prm, sim, commands} ->
// {output, ms}, a fresh IRSIM per message, as before.

importScripts("irsim.js");

let irsim = null;
let lastTime = -1, timeQueued = false;

function post(message) {
    self.postMessage(message);
}

// Simulation-time updates come once per step; pass on at most one per 50 ms.
function postTime() {
    if(!timeQueued) {
        timeQueued = true;
        setTimeout(() => {
            timeQueued = false;
        }, 50);
        post({type: "ana", op: "time", args: [lastTime]});
    }
}

const analyzer = {
    addNode: (name, ndigits) => post({type: "ana", op: "addNode", args: [name, ndigits]}),
    addVector: (name, ndigits) => post({type: "ana", op: "addVector", args: [name, ndigits]}),
    remove: name => post({type: "ana", op: "remove", args: [name]}),
    clear: () => post({type: "ana", op: "clear", args: []}),
    show: () => post({type: "ana", op: "show", args: []}),
    restart: (first, last) => post({type: "ana", op: "restart", args: [first, last]}),
    times: (first, step, last) => post({type: "ana", op: "times", args: [first, step, last]}),
    time: t => {
        lastTime = t;
        postTime();
    },
};

function mkdirs(path) {
    let dir = "";
    for(const part of path.split("/").filter(Boolean).slice(0, -1)) {
        dir += "/" + part;
        try {
            irsim.FS.mkdir(dir);
        } catch(e) {
            // Exists already
        }
    }
}

function listFiles(root, prefix = "", files = []) {
    for(const name of irsim.FS.readdir(root)) {
        if(name === "." || name === "..") {
            continue;
        }
        const path = root + "/" + name, stat = irsim.FS.stat(path);
        if(irsim.FS.isDir(stat.mode)) {
            listFiles(path, prefix + name + "/", files);
        } else {
            files.push({path: prefix + name, mtime: stat.mtime.getTime(), size: stat.size});
        }
    }
    return files;
}

function ended(error) {
    if(irsim) {
        irsim = null;
        post({type: "ended", error: error ? String(error.message || error) : null});
    }
}

// Run fn; IRSIM's exit() and aborts end the session.
function guarded(fn) {
    try {
        return fn();
    } catch(error) {
        ended(/ExitStatus|exit\(/.test(String(error)) ? null : error);
        return null;
    }
}

async function start(message) {
    irsim = await createIrsim({
        print: text => post({type: "out", text}),
        printErr: text => post({type: "out", text, error: true}),
        onExit: () => ended(null),
        onAbort: reason => ended(new Error(String(reason))),
    });
    irsim.irsimAna = analyzer;
    irsim.FS.mkdir("/work");
    for(const file of message.files) {
        const path = file.path.startsWith("/") ? file.path : "/work/" + file.path;
        mkdirs(path);
        irsim.FS.writeFile(path, file.data);
    }
    irsim.FS.chdir("/work");
    const ok = guarded(() => irsim.ccall("irsim_web_start_line", "number", ["string"], [message.args]));
    return {ok: ok === 0, time: irsim ? irsim.ccall("irsim_web_time", "number", [], []) : 0,
        unitsPerNs: irsim ? irsim.ccall("irsim_web_units_per_ns", "number", [], []) : 1000};
}

function handle(message) {
    switch(message.type) {
    case "command": {
        const t0 = performance.now();
        const ret = guarded(() => irsim.ccall("irsim_web_command", "number", ["string"], [message.line]));
        return {ret, ms: performance.now() - t0, time: irsim ? irsim.ccall("irsim_web_time", "number", [], []) : null};
    }
    case "history":
        return {text: irsim.ccall("irsim_web_history", "string", ["string", "number"],
            [message.names.join(" "), message.since])};
    case "names":
        return {nodes: irsim.ccall("irsim_web_nodes", "string", [], []),
            vectors: irsim.ccall("irsim_web_vectors", "string", [], [])};
    case "files":
        return {files: listFiles("/work")};
    case "read":
        return {data: irsim.FS.readFile("/work/" + message.path)};
    case "write":
        mkdirs("/work/" + message.path);
        irsim.FS.writeFile("/work/" + message.path, message.data);
        return {};
    }
    throw new Error("unknown request " + message.type);
}

// The original one-shot protocol: a fresh IRSIM for each job.
async function batch(job) {
    const lines = [], t0 = performance.now();
    const input = Array.from(new TextEncoder().encode(job.commands + "\nexit\n"));
    const one = await createIrsim({
        print: text => lines.push(text),
        printErr: text => lines.push(text),
        stdin: () => (input.length ? input.shift() : null),
    });
    one.FS.writeFile("/tech.prm", job.prm);
    one.FS.writeFile("/circuit.sim", job.sim);
    try {
        one.callMain(["/tech.prm", "/circuit.sim"]);
    } catch(e) {
        if(!/ExitStatus|exit/i.test(String(e))) {
            lines.push("Error: " + e);
        }
    }
    post({output: lines.join("\n"), ms: performance.now() - t0});
}

self.onmessage = async event => {
    const message = event.data;
    if(!message.type) {
        return batch(message);
    }
    try {
        if(message.type === "start") {
            post({type: "reply", id: message.id, ...(await start(message))});
        } else if(!irsim) {
            post({type: "reply", id: message.id, error: "IRSIM is not running"});
        } else {
            const reply = handle(message);
            if(message.type === "command" && lastTime >= 0) {
                post({type: "ana", op: "time", args: [lastTime]});
            }
            post({type: "reply", id: message.id, ...reply});
        }
    } catch(error) {
        post({type: "reply", id: message.id, error: String(error.message || error)});
    }
};
