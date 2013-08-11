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
#define	KV_THRESHOLD_ITEMFRAME	0.16
#define	KV_THRESHOLD_ITEM	0.12
#define	KV_THRESHOLD_LAKITU	0.154
#define	KV_MIN_RACE_FRAMES	(2 * KV_FRAMERATE)	/* 2 seconds */

#define KV_MAXPLAYERS	4

typedef enum {
	KVI_NONE,		/* no item box at all */
	KVI_UNKNOWN,		/* unrecognized item box */
	KVI_BLANK,		/* empty item box (e.g., when flashing) */

	KVI_BANANA,		/* single banana peel */
	KVI_BANANA_BUNCH,	/* banana bunch */
	KVI_BLUESHELL,		/* blue shell */
	KVI_FAKE,		/* fake question mark box */
	KVI_GHOST,		/* ghost */
	KVI_GREENSHELL,		/* single green shell */
	KVI_3GREENSHELLS,	/* three green shells */
	KVI_LIGHTNING,		/* lightning */
	KVI_MUSHROOM,		/* single mushroom */
	KVI_2MUSHROOMS,		/* two mushrooms (not an actual item) */
	KVI_3MUSHROOMS,		/* three mushrooms */
	KVI_REDSHELL,		/* single red shell */
	KVI_3REDSHELLS,		/* three red shells */
	KVI_STAR,		/* star */
	KVI_SUPER_MUSHROOM,	/* super mushroom */
} kv_item_t;

typedef struct {
	char		kp_character[32];	/* name, "" = unknown */
	double		kp_charscore;		/* score for character match */
	kv_item_t	kp_item;		/* item state */
	double		kp_itemscore;		/* score for item match */
	short		kp_place;		/* 1-4, 0 = unknown */
	double		kp_placescore;		/* score for pos match */
	short		kp_lapnum;		/* 1-3, 0 = unknown, 4 = done */
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

typedef enum {
	KVF_NONE = 0,
	KVF_COMPARE_ITEMS = 0x1,
} kv_flags_t;

int kv_init(const char *);
void kv_ident(img_t *, kv_screen_t *, kv_ident_t);
void kv_ident_matches(kv_screen_t *, const char *, double);
int kv_screen_compare(kv_screen_t *, kv_screen_t *, kv_screen_t *, kv_flags_t);
int kv_screen_invalid(kv_screen_t *, kv_screen_t *, kv_screen_t *);
const char *kv_item_label(kv_item_t);

typedef void (*kv_emit_f)(const char *, int, int, kv_screen_t *, kv_screen_t *,
    FILE *);

void kv_screen_print(const char *, int, int, kv_screen_t *, kv_screen_t *,
    FILE *);
void kv_screen_json(const char *, int, int, kv_screen_t *, kv_screen_t *,
    FILE *);

struct kv_vidctx;
typedef struct kv_vidctx kv_vidctx_t;
kv_vidctx_t *kv_vidctx_init(const char *, kv_emit_f, const char *, kv_flags_t);
void kv_vidctx_frame(const char *, int, int, img_t *, kv_vidctx_t *);
void kv_vidctx_free(kv_vidctx_t *);

#endif
