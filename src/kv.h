/*
 * kv.h: kart-specific routines
 */

#ifndef KV_H
#define	KV_H

#include <stdint.h>
#include <stdio.h>

#include "compat.h"
#include "img.h"

#define	KV_FRAMERATE		29.97
#define	KV_THRESHOLD_CHAR	0.23
#define	KV_THRESHOLD_TRACK	0.20
#define	KV_THRESHOLD_ITEM	0.154
#define	KV_THRESHOLD_LAKITU	0.154
#define	KV_MIN_RACE_FRAMES	(2 * KV_FRAMERATE)	/* 2 seconds */

#define KV_MAXPLAYERS	4

typedef enum {
	KVI_NONE,
	KVI_BOX
} kv_itembox_t;

typedef struct {
	char		kp_character[32];	/* name, "" = unknown */
	double		kp_charscore;		/* score for character match */
	char		kp_item[32];		/* item, "" = unknown */
	double		kp_itemscore;		/* score for item match */
	short		kp_place;		/* 1-4, 0 = unknown */
	double		kp_placescore;		/* score for pos match */
	short		kp_lapnum;		/* 1-3, 0 = unknown, 4 = done */
	kv_itembox_t	kp_itembox;		/* item box state */
} kv_player_t;

typedef enum {
	KVE_RACE_START = 0x1,			/* race is starting */
	KVE_RACE_DONE  = 0x2,			/* race has ended */
} kv_events_t;

typedef struct {
	kv_events_t	ks_events;		/* active events */
	unsigned short	ks_nplayers;		/* number of active players */
	char		ks_track[32];		/* name, "" = unknown */
	double		ks_trackscore;		/* score for track match */
	kv_player_t	ks_players[KV_MAXPLAYERS];	/* player details */
} kv_screen_t;

typedef enum {
	KV_IDENT_START   = 0x1,
	KV_IDENT_TRACK   = 0x2,
	KV_IDENT_CHARS   = 0x4,
	KV_IDENT_ITEM	 = 0x8,
	KV_IDENT_ALL     = KV_IDENT_START | KV_IDENT_TRACK | KV_IDENT_CHARS |
	    KV_IDENT_ITEM,
	KV_IDENT_NOTRACK = KV_IDENT_ALL & (~KV_IDENT_TRACK),
} kv_ident_t;

int kv_init(const char *);
void kv_ident(img_t *, kv_screen_t *, kv_ident_t);
void kv_ident_matches(kv_screen_t *, const char *, double);
int kv_screen_compare(kv_screen_t *, kv_screen_t *, kv_screen_t *);
int kv_screen_invalid(kv_screen_t *, kv_screen_t *, kv_screen_t *);

typedef void (*kv_emit_f)(const char *, int, int, kv_screen_t *, kv_screen_t *,
    FILE *);

void kv_screen_print(const char *, int, int, kv_screen_t *, kv_screen_t *,
    FILE *);
void kv_screen_json(const char *, int, int, kv_screen_t *, kv_screen_t *,
    FILE *);

struct kv_vidctx;
typedef struct kv_vidctx kv_vidctx_t;
kv_vidctx_t *kv_vidctx_init(const char *, kv_emit_f, const char *);
void kv_vidctx_frame(const char *, int, int, img_t *, kv_vidctx_t *);
void kv_vidctx_free(kv_vidctx_t *);


#endif
