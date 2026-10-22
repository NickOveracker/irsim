// Runs one IRSIM session per message: {prm: text, sim: text, commands: text} -> {output, ms}.
importScripts("irsim.js");

self.onmessage = async function(event) {
    const job = event.data, lines = [], t0 = performance.now();
    const input = Array.from(new TextEncoder().encode(job.commands + "\nexit\n"));
    const irsim = await createIrsim({
        print: text => lines.push(text),
        printErr: text => lines.push(text),
        stdin: () => (input.length ? input.shift() : null),
    });
    irsim.FS.writeFile("/tech.prm", job.prm);
    irsim.FS.writeFile("/circuit.sim", job.sim);
    try {
        irsim.callMain(["/tech.prm", "/circuit.sim"]);
    } catch(e) {
        if(!/ExitStatus|exit/i.test(String(e))) {
            lines.push("Error: " + e);
        }
    }
    self.postMessage({output: lines.join("\n"), ms: performance.now() - t0,});
};
