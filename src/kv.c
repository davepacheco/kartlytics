/*
 * kv.c: kart-specific routines
 */

#include <assert.h>
#include <dirent.h>
#include <err.h>

#include "kv.h"
extern int kv_debug;

/*
 * All masks are loaded by kv_init() and cached in kv_masks.
 */
typedef struct {
	char		km_name[64];
	img_t		*km_image;
} kv_mask_t;

#define	KV_MAX_MASKS	128
static kv_mask_t kv_masks[KV_MAX_MASKS];
static int kv_nmasks = 0;

#define KV_MASK_CHAR(s)		(s[0] == 'c')
#define KV_MASK_TRACK(s)	(s[0] == 't')
#define	KV_MASK_LAKITU(s)	(s[0] == 'l')

int
kv_init(const char *dirname)
{
	img_t *mask;
	kv_mask_t *kmp;
	DIR *maskdir;
	struct dirent *entp;
	char maskname[PATH_MAX];
	char maskdirname[PATH_MAX];

	if (kv_nmasks > 0)
		/* already initialized */
		return (0);

	/*
	 * For now, rather than explicitly enumerate the masks and check each
	 * one, we iterate the masks we have, see which ones match this image,
	 * and update the screen info accordingly.
	 */
	(void) snprintf(maskdirname, sizeof (maskdirname),
	    "%s/../assets/masks", dirname);

	if ((maskdir = opendir(maskdirname)) == NULL) {
		warn("failed to opendir %s", maskdirname);
		return (-1);
	}

	while ((entp = readdir(maskdir)) != NULL) {
		if (kv_nmasks == KV_MAX_MASKS) {
			warnx("too many masks (over %d)", KV_MAX_MASKS);
			(void) closedir(maskdir);
			return (-1);
		}

		if (strncmp(entp->d_name, "char_", sizeof ("char_") - 1) != 0 &&
		    strncmp(entp->d_name, "pos", sizeof ("pos") - 1) != 0 &&
		    strncmp(entp->d_name, "lakitu_start",
		    sizeof ("lakitu_start") - 1) != 0 &&
		    strncmp(entp->d_name, "track_", sizeof ("track_") - 1) != 0)
			continue;

		if (kv_debug > 2)
			(void) printf("reading mask %-20s: ", entp->d_name);

		(void) snprintf(maskname, sizeof (maskname), "%s/%s",
		    maskdirname, entp->d_name);

		if ((mask = img_read(maskname)) == NULL) {
			warnx("failed to read %s", maskname);
			(void) closedir(maskdir);
			return (-1);
		}

		kmp = &kv_masks[kv_nmasks++];
		kmp->km_image = mask;
		(void) strlcpy(kmp->km_name, entp->d_name,
		    sizeof (kmp->km_name));

		if (kv_debug > 2)
			(void) printf("bounded [%d, %d] to [%d, %d]\n",
			    mask->img_minx, mask->img_miny, mask->img_maxx,
			    mask->img_maxy);
	}

	(void) closedir(maskdir);
	return (0);
}

int
kv_ident(img_t *image, kv_screen_t *ksp, boolean_t do_all)
{
	int i;
	double score, checkthresh;
	kv_mask_t *kmp;

	bzero(ksp, sizeof (*ksp));

	for (i = 0; i < kv_nmasks; i++) {
		kmp = &kv_masks[i];

		if (!do_all &&
		    (KV_MASK_CHAR(kmp->km_name) || KV_MASK_TRACK(kmp->km_name)))
			continue;

		score = img_compare(image, kmp->km_image);

		if (kv_debug > 1)
			(void) printf("mask %s: %f\n", kmp->km_name, score);

		if (KV_MASK_CHAR(kmp->km_name))
			checkthresh = KV_THRESHOLD_CHAR;
		else if (KV_MASK_LAKITU(kmp->km_name))
			checkthresh = KV_THRESHOLD_LAKITU;
		else
			checkthresh = KV_THRESHOLD_TRACK;

		if (score > checkthresh)
			continue;

		kv_ident_matches(ksp, kmp->km_name, score);
	}

	return (0);
}

/*
 * Update the screen state (ksp) to reflect that a mask matched this frame.
 */
void
kv_ident_matches(kv_screen_t *ksp, const char *mask, double score)
{
	unsigned int pos, square;
	char *p;
	kv_player_t *kpp;
	char buf[64];

	if (kv_debug > 1)
		(void) printf("%s matches\n", mask);

	(void) strlcpy(buf, mask, sizeof (buf));

	if (strncmp(buf, "track_", sizeof ("track_") - 1) == 0) {
		(void) strtok(buf + sizeof ("track_"), "_.");
		(void) strlcpy(ksp->ks_track, buf + sizeof ("track_") - 1,
		    sizeof (ksp->ks_track));
		return;
	}

	if (sscanf(buf, "pos%u_square%u.png", &pos, &square) == 2 &&
	    pos <= KV_MAXPLAYERS && square <= KV_MAXPLAYERS) {
		if (square > ksp->ks_nplayers)
			ksp->ks_nplayers = square;

		ksp->ks_players[square - 1].kp_place = pos;
		return;
	}

	if (strncmp(buf, "char_", sizeof ("char_") - 1) == 0) {
		p = strchr(buf + sizeof ("char_") - 1, '_');
		if (p == NULL)
			return;

		*p = '\0';
		if (sscanf(p + 1, "%u", &square) != 1 ||
		    square > KV_MAXPLAYERS)
			return;

		kpp = &ksp->ks_players[square - 1];

		if (kpp->kp_character[0] != '\0' && kpp->kp_charscore < score)
			return;

		if (square > ksp->ks_nplayers)
			ksp->ks_nplayers = square;

		(void) strlcpy(kpp->kp_character, buf + sizeof ("char_") - 1,
		    sizeof (kpp->kp_character));
		kpp->kp_charscore = score;
		return;
	}

	if (strncmp(buf, "lakitu_start", sizeof ("lakitu_start") - 1) == 0) {
		ksp->ks_events |= KVE_RACE_START;
		return;
	}
}

/*
 * Returns whether the given screen is invalid for the same race as pksp.  This
 * is used to skip frames that show transient invalid state.
 */
int
kv_screen_invalid(kv_screen_t *ksp, kv_screen_t *pksp)
{
	int i, j;

	/*
	 * The number of players shouldn't actually change during a race, but we
	 * can fail to detect the correct number of players when the position
	 * numerals are transitioning.
	 */
	if (ksp->ks_nplayers != pksp->ks_nplayers)
		return (1);

	for (i = 0; i < ksp->ks_nplayers; i++) {
		if (ksp->ks_players[i].kp_place == 0)
			return (1);
	}

	for (i = 0; i < ksp->ks_nplayers; i++) {
		for (j = i + 1; j < ksp->ks_nplayers; j++) {
			if (ksp->ks_players[i].kp_place ==
			    ksp->ks_players[j].kp_place)
				return (1);
		}
	}

	return (0);
}

/*
 * Returns true if the two game states are logically different.  Two game states
 * are different if the players' positions or lap numbers have changed.  We
 * ignore changes in the track and characters, since those are only sometimes
 * detected properly.  Higher-level code should be checking whether the race has
 * changed by looking for the race start event.
 */
int
kv_screen_compare(kv_screen_t *ksp, kv_screen_t *pksp)
{
	int i;
	kv_player_t *kpp, *pkpp;

	for (i = 0; i < ksp->ks_nplayers; i++) {
		kpp = &ksp->ks_players[i];
		pkpp = &pksp->ks_players[i];

		if (kpp->kp_place != pkpp->kp_place ||
		    kpp->kp_lapnum != pkpp->kp_lapnum)
			return (1);
	}

	return (0);
}

/*
 * Print a given game state.
 */
void
kv_screen_print(kv_screen_t *ksp, FILE *out)
{
	int i;
	kv_player_t *kpp;

	assert(ksp->ks_nplayers <= KV_MAXPLAYERS);

	if (ksp->ks_events & KVE_RACE_START)
		(void) fprintf(out, "Race starting!\n");

	(void) fprintf(out, "%d players: %s\n", ksp->ks_nplayers,
	    ksp->ks_track[0] == '\0' ? "Unknown Track" : ksp->ks_track);

	if (ksp->ks_nplayers == 0)
		return;

	(void) fprintf(out, "%-8s    %-32s    %-4s    %-7s\n", "",
	    "Character", "Posn", "Lap");

	for (i = 0; i < ksp->ks_nplayers; i++) {
		(void) fprintf(out, "Player %d    ", i + 1);

		kpp = &ksp->ks_players[i];
		(void) fprintf(out, "%-32s    ", kpp->kp_character[0] == '\0' ?
		    "?" : kpp->kp_character);

		switch (kpp->kp_place) {
		case 0:
			(void) fprintf(out, "?   ");
			break;
		case 1:
			(void) fprintf(out, "1st ");
			break;
		case 2:
			(void) fprintf(out, "2nd ");
			break;
		case 3:
			(void) fprintf(out, "3rd ");
			break;
		case 4:
			(void) fprintf(out, "4th ");
			break;
		default:
			assert(0 && "invalid position");
		}

		(void) fprintf(out, "    ");

		switch (kpp->kp_lapnum) {
		case 0:
			(void) fprintf(out, "%-7s", "?");
			break;
		case 4:
			(void) fprintf(out, "%-7s", "Done");
			break;
		default:
			assert(kpp->kp_lapnum > 0 && kpp->kp_lapnum < 4);
			(void) fprintf(out, "Lap %d/3", kpp->kp_lapnum);
		}

		(void) fprintf(out, "\n");
	}
}
