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
 * An interactive IRSIM session for the web build.  irsim_web_start() does
 * what main() in irsim.c does up to the command prompt; after that the page
 * sends one command line at a time to irsim_web_command(), which is what
 * input() does for each line typed at "irsim>".  The irsim_web_* queries
 * give the page the node and vector names and the node histories that the
 * analyzer draws.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <emscripten/emscripten.h>

#include "defs.h"
#include "net.h"
#include "globals.h"
#include "rsim.h"
#ifdef USER_SUBCKT
#include "../usersubckt/subckt.h"
#endif

extern char *filename;
extern int lineno;
extern int targc;
extern char *first_file;
extern void parse_line();
extern int exec_cmd();
extern int finput();
extern Bits *GetVectorList();

/* Next history entry, skipping punted events (NEXTH in base/hist.c). */
private hptr nextHist( h )
  hptr  h;
  {
    for( h = h->next; h->punt; h = h->next );
    return( h );
  }

private int webStarted = FALSE;

/*
 * Start a session: argv as on the command line ("[-s] prm_file sim_file...
 * [-cmd_file...]").  Returns 0 on success.
 */
EMSCRIPTEN_KEEPALIVE int
irsim_web_start( argc, argv )
  int   argc;
  char  **argv;
  {
    int  i, arg1, has_param_file;

    if( webStarted )
	return( -1 );
    InitSignals();
    InitUsage();
    InitThevs();
    InitCAD();
    InitCmdPath();
    init_hist();
    (void) fprintf( stdout, "*** IRSIM %s.%s *** @ %s\n",
		IRSIM_VERSION, IRSIM_REVISION, IRSIM_DATE);

    filename = "*initialization*";
    for( arg1 = 1; arg1 < argc and argv[arg1][0] == '-'; arg1++ )
      {
	if( argv[arg1][1] == 's' )
	    stack_txtors = TRUE;
	else
	    Usage( "unknown switch: %s\n", argv[arg1] );
      }

    has_param_file = (arg1 < argc) ? config( argv[arg1++] ) : -1;

    for( i = arg1; i < argc; i += 1 )
      {
	if( argv[i][0] != '-' and argv[i][0] != '+' )
	  {
	    rd_network( argv[i], (char *)NULL, has_param_file );
	    if( first_file == NULL )
		first_file = BaseName( argv[i] );
	  }
      }

    if( first_file == NULL )
      {
	(void) fprintf( stderr, "No network, no work.\n" );
	fflush( stdout );
	fflush( stderr );
	return( 1 );
      }

    ConnectNetwork();
    InitTimes(sim_time0, stepsize, cur_delta, 0);
    init_commands();
    init_event();

    filename = "command line";
    lineno = 1;
    for( i = arg1; i < argc; i++ )
	if( argv[i][0] == '-' and not finput( &argv[i][1] ) )
	    rsimerror( filename, lineno, "cannot open %s for input\n",
	       &argv[i][1] );

    debug = 0;
    filename = "tty";
    lineno = 0;
    webStarted = TRUE;
    fflush( stdout );
    fflush( stderr );
    return( 0 );
  }

/*
 * The same, with the arguments in one string separated by spaces
 * (file names with spaces are not supported).
 */
EMSCRIPTEN_KEEPALIVE int
irsim_web_start_line( line )
  char  *line;
  {
    static char  copy[ LSIZE ];
    char         *argv[ MAXARGS ], *p;
    int          argc = 0;

    (void) strncpy( copy, line, LSIZE - 1 );
    copy[ LSIZE - 1 ] = '\0';
    argv[ argc++ ] = "irsim";
    for( p = strtok( copy, " \t\n" ); p != NULL and argc < MAXARGS - 1;
      p = strtok( NULL, " \t\n" ) )
	argv[ argc++ ] = p;
    argv[ argc ] = NULL;
    return( irsim_web_start( argc, argv ) );
  }

/*
 * Run one command line.  Returns what input() would act on: 0 normally,
 * -1 for "q" (quit).  "exit" ends the program, as it does in IRSIM.
 */
EMSCRIPTEN_KEEPALIVE int
irsim_web_command( text )
  char  *text;
  {
    static char  line[ LSIZE ];
    int          ret = 0;

    if( not webStarted )
	return( -2 );
    (void) strncpy( line, text, LSIZE - 2 );
    line[ LSIZE - 2 ] = '\0';
    (void) strcat( line, "\n" );
    if( logfile != NULL )
	(void) fputs( line, logfile );

    lineno += 1;
    lineno += contline;
    parse_line( line, LSIZE );
    if( targc != 0 )
	ret = exec_cmd();
    int_received = 0;
    fflush( stdout );
    fflush( stderr );
    if( logfile != NULL )
	fflush( logfile );
    return( ret );
  }

/* ------------------------------------------------------------------------
 * Queries.  Each returns text in a buffer that stays valid until the next
 * query.
 * ------------------------------------------------------------------------
 */

private char  *webText = NULL;
private int   webLen = 0, webSize = 0;

private void webReset()
  {
    if( webText == NULL )
      {
	webSize = 8192;
	webText = malloc( webSize );
      }
    webLen = 0;
    webText[0] = '\0';
  }

private void webAppend( const char *fmt, ... )
  {
    va_list  args;
    int      n;

    va_start( args, fmt );
    n = vsnprintf( NULL, 0, fmt, args );
    va_end( args );
    if( webLen + n + 1 > webSize )
      {
	while( webLen + n + 1 > webSize )
	    webSize *= 2;
	webText = realloc( webText, webSize );
      }
    va_start( args, fmt );
    vsnprintf( webText + webLen, n + 1, fmt, args );
    va_end( args );
    webLen += n;
  }

/* The current simulation time, in IRSIM's internal units (ps). */
EMSCRIPTEN_KEEPALIVE double
irsim_web_time()
  {
    return( (double) cur_delta );
  }

/* Time units per ns, for converting the times the queries return. */
EMSCRIPTEN_KEEPALIVE double
irsim_web_units_per_ns()
  {
    return( ns2d( 1.0 ) );
  }

private int webNodeName( n, arg )
  nptr  n;
  char  *arg;
  {
    if( not (n->nflags & (ALIAS | DELETED)) )
	webAppend( "%s\t%d\n", n->nname, (n->nflags & POWER_RAIL) ? 1 : 0 );
    return( FALSE );
  }

/* Every node: "<name><TAB><1 if a power rail>" per line. */
EMSCRIPTEN_KEEPALIVE const char *
irsim_web_nodes()
  {
    webReset();
    if( webStarted )
	walk_net( webNodeName, (char *) NULL );
    return( webText );
  }

/* Every vector: "<name><TAB><bit node>..." per line, most significant bit first. */
EMSCRIPTEN_KEEPALIVE const char *
irsim_web_vectors()
  {
    Bits  *b;
    int   i;

    webReset();
    if( webStarted )
	for( b = GetVectorList(); b != NULL; b = b->next )
	  {
	    webAppend( "%s", b->name );
	    for( i = 0; i < b->nbits; i++ )
		webAppend( "\t%s", b->nodes[i]->nname );
	    webAppend( "\n" );
	  }
    return( webText );
  }

private void webHistory( n, since )
  nptr    n;
  double  since;
  {
    hptr  h, prev = NULL;

    /* Transitions after "since", preceded by the last one at or before it. */
    for( h = &(n->head); h != last_hist; h = nextHist( h ) )
      {
	if( (double) h->time > since )
	  {
	    if( prev != NULL )
	      {
		webAppend( " %.0f %d", (double) prev->time,
		  (prev->inp ? 4 : 0) | prev->val );
		prev = NULL;
	      }
	    webAppend( " %.0f %d", (double) h->time, (h->inp ? 4 : 0) | h->val );
	  }
	else
	    prev = h;
      }
    if( prev != NULL )
	webAppend( " %.0f %d", (double) prev->time, (prev->inp ? 4 : 0) | prev->val );
  }

/*
 * Histories for the nodes named in "names" (separated by spaces):
 * "<name><TAB><time> <value> <time> <value>...\n" per node, with the
 * value 0 low, 1 X, 2 high-impedance, 3 high, plus 4 when the node was
 * an input.  Only transitions after "since" are listed, preceded by the
 * entry in effect at that time.  Unknown names give an empty list.
 */
EMSCRIPTEN_KEEPALIVE const char *
irsim_web_history( names, since )
  char    *names;
  double  since;
  {
    static char  buf[ 512 ];
    char         *p, *q;
    nptr         n;

    webReset();
    if( not webStarted )
	return( webText );
    for( p = names; *p != '\0'; p = q )
      {
	while( *p == ' ' ) p++;
	for( q = p; *q != '\0' and *q != ' '; q++ );
	if( q == p or q - p >= (int) sizeof( buf ) )
	    continue;
	(void) strncpy( buf, p, q - p );
	buf[ q - p ] = '\0';
	webAppend( "%s\t", buf );
	if( (n = find( buf )) != NULL )
	  {
	    while( n->nflags & ALIAS )
		n = n->nlink;
	    webHistory( n, since );
	  }
	webAppend( "\n" );
      }
    return( webText );
  }
