// SPDX-License-Identifier: GPL-2.0-or-later
// An interactive IRSIM session running in worker.js.
//
// Commands run one at a time, in order.  Output and analyzer calls arrive
// while a command runs (onOutput, onAnalyzer).  Simulation is deterministic,
// so a command that runs too long can be stopped by ending the worker and
// replaying the commands before it in a fresh one (stop()).  The same
// recovery follows "exit" or a crash.

import {t, maybe, register} from "./i18n.js";

// The session's messages in Japanese (i18n.js).  What IRSIM prints stays as it is.
register({
    "No circuit is loaded.": "回路が読み込まれていません。",
    "IRSIM is not running": "IRSIM が動いていません",
    "the worker failed": "ワーカーが異常終了しました",
    "IRSIM exited ({line}).": "IRSIM が終了しました（{line}）。",
    "IRSIM stopped: {why}.": "IRSIM が停止しました：{why}。",
    "{message} Restarting and replaying 1 command…": "{message}再起動して、1 個のコマンドを再実行します…",
    "{message} Restarting and replaying {n} commands…": "{message}再起動して、{n} 個のコマンドを再実行します…",
    "Back at {time} ns, as before \"{line}\".": "「{line}」の前と同じ {time} ns に戻りました。",
    "Stopped \"{line}\".": "「{line}」を停止しました。",
});

export class Session {
    constructor({onOutput, onAnalyzer, onState}) {
        this.onOutput = onOutput;
        this.onAnalyzer = onAnalyzer;
        this.onState = onState || (() => {});
        this.worker = null;
        this.pending = new Map();
        this.nextId = 1;
        this.queue = Promise.resolve();
        this.log = [];               // Commands run so far, for replay
        this.files = [];             // The files the session started with
        this.args = "";
        this.busy = false;
        this.replaying = false;
        this.time = 0;
        this.unitsPerNs = 1000;
    }

    spawn() {
        this.worker?.terminate();
        this.pending.clear();
        const worker = this.worker = new Worker(new URL("worker.js", import.meta.url));
        worker.onmessage = event => {
            const m = event.data;
            if(worker !== this.worker) {
                return;
            }
            if(m.type === "out") {
                if(!this.replaying) {
                    this.onOutput(m.text, m.error);
                }
            } else if(m.type === "ana") {
                this.onAnalyzer(m.op, m.args, this.replaying);
            } else if(m.type === "ended") {
                this.endedEarly = m.error || "IRSIM exited";
            } else if(m.type === "reply") {
                const p = this.pending.get(m.id);
                this.pending.delete(m.id);
                if(p) {
                    m.error ? p.reject(new Error(maybe(m.error))) : p.resolve(m);
                }
            }
        };
        worker.onerror = event => {
            this.endedEarly = event.message || t("the worker failed");
            for(const p of this.pending.values()) {
                p.reject(new Error(this.endedEarly));
            }
            this.pending.clear();
        };
    }

    request(message, transfer) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, {resolve, reject});
            this.worker.postMessage({...message, id}, transfer || []);
        });
    }

    // files: [{path, data: Uint8Array}] relative to the working folder (or absolute);
    // args: IRSIM's command line, e.g. "/prm/scmos100.prm circuit.sim".
    async start(files, args) {
        this.files = files.map(f => ({path: f.path, data: f.data.slice()}));
        this.args = args;
        this.log = [];
        this.spawn();
        this.endedEarly = null;
        const reply = await this.request({type: "start", files: this.files, args});
        this.time = reply.time;
        this.unitsPerNs = reply.unitsPerNs;
        this.started = reply.ok;
        this.onState();
        return reply.ok;
    }

    // Run one command line; resolves with {ret, ms, time} once it has finished.
    run(line) {
        const job = this.queue.then(() => this.runNow(line));
        this.queue = job.catch(() => {});
        return job;
    }

    async runNow(line) {
        if(!this.worker || !this.started) {
            throw new Error(t("No circuit is loaded."));
        }
        this.busy = true;
        this.current = line;
        this.onState();
        try {
            const reply = await this.request({type: "command", line});
            if(this.endedEarly) {
                const why = this.endedEarly;
                await this.recover(line, why === "IRSIM exited" ? t("IRSIM exited ({line}).", {line}) : t("IRSIM stopped: {why}.", {why}));
                return {ret: -1, ended: true};
            }
            this.log.push(line);
            this.time = reply.time ?? this.time;
            return reply;
        } finally {
            this.busy = false;
            this.current = null;
            this.onState();
        }
    }

    // Start again with the same files and replay every command that finished.
    async recover(dropped, message) {
        const log = this.log.slice();
        this.onOutput(t(log.length === 1 ? "{message} Restarting and replaying 1 command…" : "{message} Restarting and replaying {n} commands…",
            {message, n: log.length}), true);
        this.replaying = true;
        try {
            this.spawn();
            this.endedEarly = null;
            const reply = await this.request({type: "start", files: this.files, args: this.args});
            this.unitsPerNs = reply.unitsPerNs;
            for(const line of log) {
                await this.request({type: "command", line});
            }
            this.log = log;
            this.time = (await this.request({type: "command", line: "|"})).time ?? 0;
        } finally {
            this.replaying = false;
        }
        this.onAnalyzer("restart", [-1, -1], false);
        this.onOutput(t("Back at {time} ns, as before \"{line}\".", {time: (this.time / this.unitsPerNs).toFixed(3), line: dropped}), false);
    }

    // Stop the command that is running (by restarting and replaying).
    async stop() {
        if(!this.busy) {
            return;
        }
        const line = this.current;
        for(const p of this.pending.values()) {
            p.reject(new Error("stopped"));
        }
        this.pending.clear();
        this.queue = Promise.resolve();
        await this.recover(line, t("Stopped \"{line}\".", {line}));
        this.busy = false;
        this.onState();
    }

    history(names, since) {
        return this.request({type: "history", names, since}).then(r => r.text);
    }

    names() {
        return this.request({type: "names"});
    }

    listFiles() {
        return this.request({type: "files"}).then(r => r.files);
    }

    readFile(path) {
        return this.request({type: "read", path}).then(r => r.data);
    }

    writeFile(path, data) {
        this.remember(path, data);
        return this.request({type: "write", path, data});
    }

    // Keep a file's latest contents for replays (files IRSIM wrote, or edits).
    remember(path, data) {
        const file = this.files.find(f => f.path === path);
        if(file) {
            file.data = data.slice();
        } else {
            this.files.push({path, data: data.slice()});
        }
    }
}
