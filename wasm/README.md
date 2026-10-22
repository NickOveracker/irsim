# IRSIM for WebAssembly

A headless build of IRSIM 9.7 for the browser (and Node.js), made with [Emscripten](https://emscripten.org).
It has no Tcl interpreter, no X11 analyzer window and no threads, so it runs in a plain Web Worker and needs
no special server headers. Commands are the classic (non-Tcl) IRSIM commands: `h`, `l`, `s`, `d`, `stepsize`,
`vector`, `relax`, `faultsim` and so on. Watch commands that exist only in the Tcl or Magic builds (`w`,
`watchnode`) are not available; use `d` after each step instead.

## Building

```sh
source /path/to/emsdk/emsdk_env.sh
./wasm/build.sh
```

This writes `wasm/irsim.js` (a module factory named `createIrsim`) and `wasm/irsim.wasm`, about 210 KB, and copies
them into `wasm/demo/`, where they are committed so that the demo works on GitHub Pages. The demo reads its
technology file from `lib/prm/scmos100.prm`.

## Using it

Each run is a fresh module instance. Files go into Emscripten's in-memory filesystem, commands come from stdin:

```js
const irsim = await createIrsim({
    print: line => output.push(line),
    printErr: line => output.push(line),
    stdin: () => (bytes.length ? bytes.shift() : null),   // the command script, ending with "exit"
});
irsim.FS.writeFile("/tech.prm", prmText);
irsim.FS.writeFile("/circuit.sim", simText);
irsim.callMain(["/tech.prm", "/circuit.sim"]);
```

`run-node.js` does the same in Node.js. `demo/` is a small page that runs IRSIM in a Web Worker. Serve the
repository root over HTTP (for example `python3 -m http.server`, then open `/wasm/demo/`), since browsers don't
start workers from `file://` pages and the demo reads `lib/prm/` from two folders up.

## Checks

The WebAssembly build and a native headless build (same sources, gcc) give identical output on 86 circuits
exported from the Stixu stick-diagram editor (https://stixu.io), including two 4x4 multipliers of 338 and 376
transistors. The native results also match the unmodified Tcl build of IRSIM on the circuits compared.

## Source changes this build needed

WebAssembly checks function signatures at run time, so mismatched K&R declarations that happen to work on
x86-64 fail here. Fixing them turned up several real bugs, which are separate commits on this branch:

* `config.c`: `resist_copy()` takes the address of each resistance table entry, but was passed the entries
  themselves, so it read garbage when a parameter file left a transistor type without resistances.
* `rsim.c`: an `assertWhen` record was freed with `Ffree(p)`, without the size `Ffree` needs.
* `net_macros.h`: `NEW_SUBCKT` called `Falloc` without its second argument.
* `incsim.c`: `WarnTooManyParallel()` was called without the two node names it prints.
* `faultsim.c`, `binsim.c`: times and node indices were cast to 32-bit types where 64-bit ones are expected.
* `rsim.c`: `relax` treated its argument backwards: `relax l` randomised and `relax r` set nodes low.
* `globals.h`: `lprintf` and `rsimerror` are variadic and now have real prototypes in every build.
