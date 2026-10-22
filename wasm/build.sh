#!/bin/sh
# Build IRSIM to WebAssembly (headless: no Tcl, no X11 analyzer, no threads).
# Needs the Emscripten SDK on the PATH (source emsdk_env.sh). Writes wasm/irsim.js and wasm/irsim.wasm,
# and copies them, with the scmos100 parameter file, into wasm/demo/.
set -e
cd "$(dirname "$0")/.."
DEFS='-DCAD_DIR="/irsim" -DBIN_DIR="/irsim" -DPACKAGE_NAME="irsim" -DPACKAGE_VERSION="9.7" -DIRSIM_VERSION="9.7" -DIRSIM_REVISION="121" -DIRSIM_DATE="wasm"
 -DSTDC_HEADERS=1 -DHAVE_SYS_TYPES_H=1 -DHAVE_SYS_STAT_H=1 -DHAVE_STDLIB_H=1 -DHAVE_STRING_H=1 -DHAVE_MEMORY_H=1 -DHAVE_STRINGS_H=1
 -DHAVE_INTTYPES_H=1 -DHAVE_STDINT_H=1 -DHAVE_UNISTD_H=1 -DSIZEOF_VOID_P=4 -DSIZEOF_UNSIGNED_INT=4 -DSIZEOF_UNSIGNED_LONG=4
 -DSIZEOF_UNSIGNED_LONG_LONG=8 -DHAVE_SETENV=1 -DHAVE_PUTENV=1 -DHAVE_DIRENT_H=1 -DHAVE_LIMITS_H=1 -DHAVE_VA_COPY=1 -DHAVE___VA_COPY=1
 -DFAULT_SIM=1 -DPOWER_EST=1 -DUSER_SUBCKT=1 -DSTATS=1 -DCL_STATS=1 -DRANDOM=1 -DX_DISPLAY_MISSING=1 -DLINUX=1 -DSYSV=1 -DISC=1
 -DSHDLIB_EXT="" -DNDEBUG'
SRCS="base/access.c base/binsim.c base/cad_dir.c base/config.c base/conn_list.c base/eval.c base/fio.c base/hist_io.c base/hist.c
 base/intr.c base/mem.c base/netupdate.c base/network.c base/newrstep.c base/nsubrs.c base/parallel.c base/prints.c base/rsim.c
 base/sched.c base/sim.c base/sstep.c base/stack.c base/tpos.c base/usage.c analyzer/noana.c faultsim/faultsim.c faultsim/incsim.c
 usersubckt/subckt.c usersubckt/user.c irsim/irsim.c"
emcc -std=gnu89 -w -O2 $DEFS -Ibase -Ianalyzer $SRCS -o wasm/irsim.js \
  -sMODULARIZE=1 -sEXPORT_NAME=createIrsim -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 \
  -sEXPORTED_RUNTIME_METHODS=FS,callMain -sFORCE_FILESYSTEM=1
# The demo page loads the module and a technology file from its own folder.
cp wasm/irsim.js wasm/irsim.wasm lib/prm/scmos100.prm wasm/demo/
ls -la wasm/irsim.js wasm/irsim.wasm
