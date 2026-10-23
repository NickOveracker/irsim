# IRSIM for WebAssembly

IRSIM 9.7 compiled to WebAssembly with [Emscripten](https://emscripten.org), and a web app around it with the
features of IRSIM's Tcl/Tk front end: an interactive console, the logic analyzer, and the node and vector lists.
It has no Tcl interpreter and no threads, so it runs in a plain Web Worker and needs no special server headers.

The app is at https://irsim.stixu.io/ and is what this folder holds; IRSIM's own source, with its
original README and native build, is in `src/`.

## Building

```sh
source /path/to/emsdk/emsdk_env.sh
./build.sh
```

This builds the sources in `src/` and writes `irsim.js` (a module factory named `createIrsim`) and `irsim.wasm`, about
215 KB, next to the web app, where they are committed so that the app works on GitHub Pages. Serve the repository
root over HTTP (for example `python3 -m http.server`, then open `/`): browsers don't start workers from `file://`
pages, and the app reads the parameter files in `src/lib/prm/`. The old addresses, `/web/` and `/wasm/demo/`,
redirect there.

## The web app

| File | Role |
| --- | --- |
| `index.html`, `app.js` | The page: console with history, Project / Examples / Windows / About menus, the Files window, projects, help. |
| `worker.js`, `session.js` | IRSIM in a Web Worker, one command at a time. Output and analyzer calls stream to the page while a command runs. |
| `analyzer.js` | The logic analyzer, after the Tk analyzer in `src/tcltk/irsim.tcl.in`. |
| `tracemgr.js` | Manage Traces: the Tk "IRSIM node and vector lists" window. |
| `menu.js`, `dialog.js`, `floating-window.js`, `archive.js`, `storage.js` | Menus, dialogs, windows, .zip/.tar.gz, project storage (shared with the Magic web app). |
| `examples/` | Circuits from the Stixu stick-diagram editor (https://stixu.io): Magic-extracted netlists with command files, and two of Stixu's own IRSIM exports. |

* **Console.** Every IRSIM command, typed as at the `irsim>` prompt, plus the Tcl front end's `w`/`watchnode`,
  `unwatchnode` and `watchtime`. **Stop** ends a command that runs too long: IRSIM starts again and replays the
  commands before it, which gives back the same state, since the simulation is deterministic. `exit` and crashes
  recover the same way.
* **Analyzer.** IRSIM itself decides what to show: `ana` (with wildcards, vectors and `-b`/`-o`/`-h`) goes through
  IRSIM's analyzer interface, implemented by `src/analyzer/webana.c`, and the waveforms come from IRSIM's node histories
  (`irsim_web_history`), not from parsing printed output.
  * Menus as in Tk: Zoom (In, Out, Full), Base (Binary, Octal, Unsigned and Signed Decimal, Hex, for the selected
    trace or all), Window (Manage Traces, Name Length, Scroll, Scroll Step, Shift Step, plus the X11 analyzer's
    Move To and Set Width), Print (File, Title, Banner, Legend, Times, Outline).
  * Print > File saves PostScript, SVG or PNG.
  * Names (click selects, drag reorders, ✕ removes), the waveforms, and the values at the marker; the left,
    marker/delta and right times; a slider with Full, begin, step and end buttons.
  * Mouse and keys as in Tk: button 1 sets the marker, button 3 (or Shift) drags the delta marker, button 2 or
    Escape clears them, `z` zooms to the marked interval; arrows and Shift+arrows step, `z`/`Z` zoom out/in, `v`
    shows everything; Ctrl+wheel zooms at the pointer.
* **Projects.** Open .sim, .prm and .cmd files, a folder, or one .zip/.tar/.tar.gz (or drop them on the page).
  IRSIM starts with the project's .prm (or a built-in one from `src/lib/prm`) and .sim, then runs the .cmd file of the
  same name. Simulation setup chooses the files and `-s`. Projects can be kept in a folder on disk (Chromium
  browsers) or in the browser's storage; files IRSIM writes (logfile, dumph, wnet…) and edits in the Files window go
  there.

## Using the module directly

The session API (what the app uses):

```js
const irsim = await createIrsim({print, printErr});
irsim.irsimAna = {addNode(name, digits) {}, addVector(name, digits) {}, remove(name) {}, clear() {},
    show() {}, restart(first, last) {}, times(first, step, last) {}, time(t) {}};   // optional
irsim.FS.writeFile("/tech.prm", prmText);
irsim.FS.writeFile("/circuit.sim", simText);
irsim.ccall("irsim_web_start_line", "number", ["string"], ["/tech.prm /circuit.sim"]);
irsim.ccall("irsim_web_command", "number", ["string"], ["h A"]);
irsim.ccall("irsim_web_history", "string", ["string", "number"], ["A Y", -1]);  // "A\t0 1 0 4 ...\n"
```

`irsim_web_nodes`, `irsim_web_vectors`, `irsim_web_time` and `irsim_web_units_per_ns` list names and give the
time. Histories list `time value` pairs, with value 0 low, 1 X, 2 high impedance, 3 high, plus 4 for inputs.

The one-shot use still works, for example in Node.js (`run-node.js`) or by posting `{prm, sim, commands}` to
`worker.js`, which answers `{output, ms}`:

```js
const irsim = await createIrsim({print, printErr, stdin: () => (bytes.length ? bytes.shift() : null)});
irsim.FS.writeFile("/tech.prm", prmText);
irsim.FS.writeFile("/circuit.sim", simText);
irsim.callMain(["/tech.prm", "/circuit.sim"]);    // commands from stdin, ending with "exit"
```

## Checks

* The WebAssembly build and a native headless build give identical output on 86 circuits exported from Stixu,
  including two 4x4 multipliers of 338 and 376 transistors. The native results also match the unmodified Tcl build
  of IRSIM on the circuits compared.
* Every command in IRSIM's command table was run, with typical arguments, against the 4x4 multiplier, without a
  crash.
* The examples' results were checked: the full adder's sum and carry, and all seven of the multiplier's products.

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
* `rsim.c`: `apply()` calls the vector function with two arguments, but `dvec` (used by `d` on a vector) and
  `do_cpath` (used by `path`) took one.
* `walk_net()` callbacks that took one argument where it passes two: `backToTime`, `clear_input` (used by `<`),
  `mark_del_alias`, `clear_visited`, `capsummer`, `seed_fault`, `clear_node_flags`, `fix_inc_nodes`,
  `fix_fault_nodes`.
* `sim.c`: the power node was created with the name list instead of its first name, so its name was the bytes of
  a pointer (`d` and node lists showed garbage; lookups still worked through the power-name check).
* `rsim.c`: `evstats` before `histev on` walked an event table that is NULL rather than empty (a crash natively,
  an endless loop here).
* `tpos.c`: names by transistor position (`@=d535,82`, which Magic's `simcmd` and rsim tool send) were compared
  with positions the `.sim` reader had converted from lambda to centimicrons, so none was ever found.
* `bin_io.h`: the byte packing macros handle 1 to 4 bytes, but times are 8-byte `Ulong`, so `dumph` wrote half of
  each time and `readh` read 0 and rejected every dump ("incompatible or bad history dump"), natively too.
