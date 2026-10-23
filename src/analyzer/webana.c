/*
 *     *********************************************************************
 *     * Copyright (C) 1988, 1990 Stanford University.                     *
 *     * Permission to use, copy, modify, and distribute this              *
 *     * software and its documentation for any purpose and without        *
 *     * fee is hereby granted, provided that the above copyright          *
 *     * notice appear in all copies.  Stanford University                 *
 *     * makes no representations about the suitability of this            *
 *     * software for any purpose.  It is provided "as is" without         *
 *     * express or implied warranty.  Export of this software outside     *
 *     * of the United States of America may require an export license.    *
 *     *********************************************************************
 */

/*
 * This file was written for the WebAssembly fork of IRSIM, drawing on
 * noana.c, the analyzer interface it implements, whose notice is above.  Like IRSIM, it is
 * distributed under the GNU General Public License (the file COPYRIGHT at the
 * top of the repository), WITHOUT ANY WARRANTY.
 */

/*
 * Changes in the WebAssembly fork.
 * Added in the WebAssembly fork of IRSIM, https://github.com/NickOveracker/irsim
 * (branch wasm), on 2026-10-23.  Changes, with their dates:
 *   2026-10-23  Add an interactive session and a web analyzer interface
 * End of the changes notice.
 */

/*
 * The analyzer interface for the web build.  In place of the X11 analyzer
 * (or the "no analyzer" stubs of noana.c), every call is passed on to the
 * JavaScript object Module.irsimAna, which draws the traces in the page.
 * IRSIM still parses the "ana" command itself (wildcards, vectors, the
 * -b/-o/-h digit options); this file only reports what it decided.
 * Without a Module.irsimAna (batch runs, Node) the calls do nothing.
 */

#include <stdio.h>
#include <emscripten/emscripten.h>
#include "defs.h"
#include "net.h"

extern void lprintf(FILE *, ...);

typedef Ulong  TimeType;

EM_JS(void, webAnaAddNode, (const char *name, int ndigits), {
    if(Module.irsimAna) Module.irsimAna.addNode(UTF8ToString(name), ndigits);
});
EM_JS(void, webAnaAddVector, (const char *name, int ndigits), {
    if(Module.irsimAna) Module.irsimAna.addVector(UTF8ToString(name), ndigits);
});
EM_JS(void, webAnaRemove, (const char *name), { if(Module.irsimAna) Module.irsimAna.remove(UTF8ToString(name)); });
EM_JS(void, webAnaClear, (void), { if(Module.irsimAna) Module.irsimAna.clear(); });
EM_JS(void, webAnaShow, (void), { if(Module.irsimAna) Module.irsimAna.show(); });
EM_JS(void, webAnaRestart, (double first, double last), { if(Module.irsimAna) Module.irsimAna.restart(first, last); });
EM_JS(void, webAnaTime, (double t), { if(Module.irsimAna) Module.irsimAna.time(t); });
EM_JS(void, webAnaTimes, (double first, double step, double last), {
    if(Module.irsimAna) Module.irsimAna.times(first, step, last);
});

public int AddNode( nd, flag )
  nptr  nd;
  int   *flag;
  {
    webAnaAddNode( nd->nname, flag ? *flag : 0 );
    return( 1 );
  }

public int AddVector( vec, flag )
  bptr  vec;
  int   *flag;
  {
    webAnaAddVector( vec->name, flag ? *flag : 0 );
    return( 1 );
  }

/* Vector display offsets (ana -off n) are not supported; accept them. */
public int OffsetNode( nd, flag )  nptr  nd; int *flag;  { return( 1 ); }
public int OffsetVector( vec, flag )  bptr  vec; int *flag;  { return( 1 ); }

public void DisplayTraces( isMapped )
  int  isMapped;
  {
    webAnaShow();
  }

public void StopAnalyzer()  {}

/* History changed under the analyzer's feet (back, flush, readh, net update). */
public void RestartAnalyzer( first_time, last_time, same_hist )
  Ulong  first_time, last_time;
  int   same_hist;
  {
    webAnaRestart( (double) first_time, (double) last_time );
  }

public void ClearTraces()  { webAnaClear(); }

public void RemoveVector( b )  bptr  b;  { webAnaRemove( b->name ); }

public void RemoveNode( n )  nptr  n;  { webAnaRemove( n->nname ); }

/* Nodes deleted by a network update: the page drops traces that no longer resolve. */
public void RemoveAllDeleted()  { webAnaRestart( -1.0, -1.0 ); }

public void UpdateWindow( endT )
  TimeType  endT;
  {
    webAnaTime( (double) endT );
  }

public void TerminateAnalyzer()  {}

public int InitDisplay( fname, display_unit )
  char  *fname;
  char  *display_unit;
  {
    return( TRUE );
  }

public void InitTimes( firstT, stepsize, lastT, reInit )
  TimeType  firstT, stepsize, lastT;
  int  reInit;
  {
    webAnaTimes( (double) firstT, (double) stepsize, (double) lastT );
  }

public void EnableInput()  {}
public void DisableInput() {}
