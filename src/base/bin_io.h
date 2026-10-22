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
 * Macros to read/write machine-independent binary files.
 */


/*
 * Extract NBYTES from byte stream BUFF (least significant byte first) and
 * place result in NUM.  NBYTES may be up to sizeof(Ulong): times are Ulong,
 * which is 8 bytes (loctypes.h), so the old 1..4 byte limit lost them.
 */
#define UnpackBytes( BUFF, NUM, NBYTES )			\
  {								\
    register unsigned char  *B_S = (unsigned char *) (BUFF);	\
    register Ulong          RES = 0;				\
    register int            B_I;				\
								\
    for( B_I = (NBYTES) - 1; B_I >= 0; B_I-- )			\
	RES = (RES << 8) | B_S[B_I];				\
    NUM = RES;							\
  }								\


/*
 * Pack NBYTES from NUM into byte stream pointed to by BUFF, least
 * significant byte first.  NBYTES may be up to sizeof(Ulong).
 */
#define	PackBytes( BUFF, NUM, NBYTES )				\
  {								\
    register Ulong          B_T = (Ulong) (NUM);		\
    register unsigned char  *B_S = (unsigned char *) (BUFF);	\
    register int            B_I;				\
								\
    for( B_I = 0; B_I < (NBYTES); B_I++ )			\
      {								\
	B_S[B_I] = B_T & 0x0ff;					\
	B_T >>= 8;						\
      }								\
  }								\

