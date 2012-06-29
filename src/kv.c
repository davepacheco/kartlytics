/*
 * kv.c: kart-specific routines
 */

#include <assert.h>
#include <dirent.h>
#include <err.h>
#include <stdlib.h>

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

#define	KV_STARTFRAMES	90

struct kv_vidctx {
	kv_screen_t 	kv_frame;	/* current frame state */
	kv_screen_t 	kv_pframe;      /* first frame matching current state */
	kv_screen_t 	kv_raceframe;   /* first frame state for this race */
	kv_screen_t	kv_startbuffer[KV_STARTFRAMES];
	int		kv_last_start;
	kv_emit_f	kv_emit;
	double		kv_framerate;
};

int
kv_init(const char *dirname)
{
	img_t *mask;
	kv_mask_t *kmp;
	DIR *maskdir;
	struct dirent *entp;
	char *p;
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

		p = entp->d_name + strlen(entp->d_name) - sizeof (".png") + 1;
		if (strcmp(p, ".png") != 0)
			continue;

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
	int i, ndone;
	double score, checkthresh;
	kv_mask_t *kmp;

	bzero(ksp, sizeof (*ksp));

	for (i = 0; i < kv_nmasks; i++) {
		kmp = &kv_masks[i];

		if (!do_all && KV_MASK_TRACK(kmp->km_name))
			continue;

		score = img_compare(image, kmp->km_image, NULL);

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

	ndone = 0;
	for (i = 0; i < ksp->ks_nplayers; i++) {
		if (ksp->ks_players[i].kp_lapnum == 4)
			ndone++;
	}

	if (ndone >= ksp->ks_nplayers - 1)
		ksp->ks_events |= KVE_RACE_DONE;

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
		if (ksp->ks_track[0] != '\0' && ksp->ks_trackscore < score)
			return;

		(void) strtok(buf + sizeof ("track_"), "_.");
		(void) strlcpy(ksp->ks_track, buf + sizeof ("track_") - 1,
		    sizeof (ksp->ks_track));
		ksp->ks_trackscore = score;
		return;
	}

	if (sscanf(buf, "pos%u_square%u", &pos, &square) == 2 &&
	    pos <= KV_MAXPLAYERS && square <= KV_MAXPLAYERS) {
		kpp = &ksp->ks_players[square - 1];

		if (square > ksp->ks_nplayers)
			ksp->ks_nplayers = square;
		else if (kpp->kp_place != 0 && kpp->kp_placescore < score)
			return;

		ksp->ks_players[square - 1].kp_place = pos;
		kpp->kp_placescore = score;

		if (strcmp(buf + sizeof ("pos1_square1") - 1,
		    "_final.png") == 0)
			kpp->kp_lapnum = 4;
		else if (kpp->kp_lapnum == 4)
			kpp->kp_lapnum = 0;

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
kv_screen_invalid(kv_screen_t *ksp, kv_screen_t *pksp, kv_screen_t *raceksp)
{
	int i, j;

	/*
	 * The number of players shouldn't actually change during a race, but we
	 * can fail to detect the correct number of players when the position
	 * numerals are transitioning.
	 */
	if (ksp->ks_nplayers != pksp->ks_nplayers)
		return (1);

	/*
	 * On most tracks, we ignore frames where we couldn't detect any
	 * players' ranks, but this would prohibit reporting results for Yoshi
	 * Valley until all players are done.  On the other hand, on Yoshi
	 * Valley, we ignore all frames until someone's finished.
	 */
	if (raceksp->ks_track[0] != 'y') {
		for (i = 0; i < ksp->ks_nplayers; i++) {
			if (ksp->ks_players[i].kp_place == 0)
				return (1);
		}
	} else {
		for (i = 0; i < ksp->ks_nplayers; i++) {
			if (ksp->ks_players[i].kp_lapnum == 4)
				break;
		}

		if (i == ksp->ks_nplayers)
			return (1);
	}

	for (i = 0; i < ksp->ks_nplayers; i++) {
		if (pksp->ks_players[i].kp_lapnum != 0 &&
		    ksp->ks_players[i].kp_lapnum == 0)
			return (1);
	}

	for (i = 0; i < ksp->ks_nplayers; i++) {
		if (raceksp->ks_track[0] == 'y' &&
		    ksp->ks_players[i].kp_place == 0)
			continue;

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
kv_screen_compare(kv_screen_t *ksp, kv_screen_t *pksp, kv_screen_t *raceksp)
{
	int i;
	kv_player_t *kpp, *pkpp;

	for (i = 0; i < ksp->ks_nplayers; i++) {
		kpp = &ksp->ks_players[i];
		pkpp = &pksp->ks_players[i];

		/*
		 * Ignore position changes in Yoshi Valley.
		 */
		if (kpp->kp_lapnum != pkpp->kp_lapnum ||
		    (raceksp->ks_track[0] != 'y' &&
		    kpp->kp_place != pkpp->kp_place))
			return (1);
	}

	return (0);
}

/*
 * Print a given frame state.  If raceksp is specified, it will be used to print
 * values that are unknown in the current frame.
 */
void
kv_screen_print(const char *source, int frame, int msec, kv_screen_t *ksp,
    kv_screen_t *raceksp, FILE *out)
{
	int i;
	kv_player_t *kpp;
	char *trackname, *charname;

	assert(ksp->ks_nplayers <= KV_MAXPLAYERS);

	(void) fprintf(out, "%s (time %dm:%02d.%03ds): ", source,
	    msec / MILLISEC / 60, msec / MILLISEC % 60, msec % MILLISEC);

	if (ksp->ks_events & KVE_RACE_START)
		(void) fprintf(out, "Race starting!\n");
	if (ksp->ks_events & KVE_RACE_DONE)
		(void) fprintf(out, "Race has finished.\n");

	trackname = ksp->ks_track;
	if (trackname[0] == '\0' && raceksp != NULL)
		trackname = raceksp->ks_track;
	if (trackname[0] == '\0')
		trackname = "Unknown Track";

	(void) fprintf(out, "%d players: %s\n", ksp->ks_nplayers, trackname);

	if (ksp->ks_nplayers == 0)
		return;

	(void) fprintf(out, "%-8s    %-32s    %-4s    %-7s\n", "",
	    "Character", "Posn", "Lap");

	for (i = 0; i < ksp->ks_nplayers; i++) {
		(void) fprintf(out, "Player %d    ", i + 1);

		kpp = &ksp->ks_players[i];
		charname = kpp->kp_character;
		if (charname[0] == '\0' && raceksp != NULL)
			charname = raceksp->ks_players[i].kp_character;
		if (charname[0] == '\0')
			charname = "?";

		(void) fprintf(out, "%-32s    ", charname);

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
			(void) fprintf(out, "%-7s", "");
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

	(void) fflush(out);
}

/*
 * Like kv_screen_print, but emits JSON.
 */
void
kv_screen_json(const char *source, int frame, int msec, kv_screen_t *ksp,
    kv_screen_t *raceksp, FILE *out)
{
	int i;
	kv_player_t *kpp;
	char *trackname, *charname;

	assert(ksp->ks_nplayers <= KV_MAXPLAYERS);

	(void) fprintf(out, "{ \"source\": \"%s\", \"time\": %d, \"frame\": %d, ",
	    source, msec, frame);

	if (ksp->ks_events & KVE_RACE_START)
		(void) fprintf(out, "\"start\": true, ");
	if (ksp->ks_events & KVE_RACE_DONE)
		(void) fprintf(out, "\"done\": true, ");

	trackname = ksp->ks_track;
	if (trackname[0] == '\0' && raceksp != NULL)
		trackname = raceksp->ks_track;
	if (trackname[0] == '\0')
		trackname = "Unknown Track";

	if (ksp->ks_nplayers > 0)
		(void) fprintf(out, "\"players\": [ ");

	for (i = 0; i < ksp->ks_nplayers; i++) {
		kpp = &ksp->ks_players[i];
		if (raceksp != NULL)
			charname = raceksp->ks_players[i].kp_character;
		else if (kpp->kp_character)
			charname = kpp->kp_character;
		else
			charname = "?";

		(void) fprintf(out, "{ ");

		if (kpp->kp_place != 0)
			(void) fprintf(out, "\"position\": %d, ",
			    kpp->kp_place);

		if (kpp->kp_lapnum != 0)
			(void) fprintf(out, "\"lap\": %d, ", kpp->kp_lapnum);

		(void) fprintf(out, "\"character\": \"%s\" }", charname);

		if (i != ksp->ks_nplayers - 1)
			(void) fprintf(out, ", ");
	}

	if (ksp->ks_nplayers > 0)
		(void) fprintf(out, "], ");

	(void) fprintf(out, " \"track\": \"%s\" }\n", trackname);
	(void) fflush(out);
}

kv_vidctx_t *
kv_vidctx_init(const char *rootdir, kv_emit_f emit)
{
	kv_vidctx_t *kvp;

	if (kv_init(rootdir) != 0) {
		warnx("failed to initialize masks");
		return (NULL);
	}

	if ((kvp = calloc(1, sizeof (*kvp))) == NULL) {
		warn("calloc");
		return (NULL);
	}

	kvp->kv_last_start = -1;
	kvp->kv_emit = emit;
	return (kvp);
}

/*
 * While processing frames outside a race, we store a ringbuffer of the last
 * KV_STARTFRAMES worth of frame details in kv_startbuffer.  When we do finally
 * see a start frame, we call this function to look back at the recent frames
 * and pick the best character match for each square among all of the recent
 * frames.  This technique is important to be able to identify characters in the
 * face of things like smoke that distorts their images
 */
static void
kv_vidctx_chars(kv_vidctx_t *kvp, kv_screen_t *ksp, int i)
{
	kv_screen_t *pksp;
	int j, k;

	for (j = (i + 1) % KV_STARTFRAMES; j != (i % KV_STARTFRAMES);
	    j = (j + 1) % KV_STARTFRAMES) {
		pksp = &kvp->kv_startbuffer[j];

		for (k = 0; k < KV_MAXPLAYERS; k++) {
			if (pksp->ks_players[k].kp_character[0] == '\0' ||
			    (ksp->ks_players[k].kp_charscore > 0 &&
			    pksp->ks_players[k].kp_charscore >
			    ksp->ks_players[k].kp_charscore))
				continue;

			if (k > ksp->ks_nplayers)
				ksp->ks_nplayers = k;

			bcopy(&pksp->ks_players[k], &ksp->ks_players[k],
			    sizeof (pksp->ks_players[k]));
		}
	}
}

void
kv_vidctx_frame(const char *framename, int i, int timems,
    img_t *image, kv_vidctx_t *kvp)
{
	kv_screen_t *ksp, *pksp, *raceksp;

	ksp = &kvp->kv_frame;
	pksp = &kvp->kv_pframe;
	raceksp = &kvp->kv_raceframe;

	/*
	 * As we process video frames, we go through a simple state machine:
	 *
	 * (1) We start out waiting for the first RACE_START frame.  We're in
	 *     this state while last_start == -1.  When we see RACE_START, we
	 *     set last_frame to this frame number.
	 *
	 * (2) We ignore the first KV_MIN_RACE_FRAMES after a RACE_START frame
	 *     to avoid catching what may look like multiple start frames right
	 *     next to each other.  This also avoids pointless changes in player
	 *     position in the first few seconds.
	 *
	 * (3) While the race is ongoing, we track player positions until we see
	 *     a RACE_DONE frame (indicating the race was completed) or another
	 *     RACE_START frame (indicating that the race was aborted and
	 *     another race was started).  If we see a normal RACE_DONE frame,
	 *     we go back to the first state, waiting for another RACE_START
	 *     frame.
	 */
	if (kvp->kv_last_start != -1 &&
	    i - kvp->kv_last_start < KV_MIN_RACE_FRAMES)
		/* Skip the first frames after a start. See above. */
		return;

	kv_ident(image, ksp, B_FALSE);

	if (ksp->ks_events & KVE_RACE_START) {
		if (kvp->kv_last_start != -1) {
			(void) fprintf(stderr, "%s (time %dm:%02ds): "
			    "new race begun (previous one aborted)",
			    framename, (int)((double)timems / MILLISEC) / 60,
			    timems % 60);
		}

		kv_ident(image, ksp, B_TRUE);
		bcopy(ksp, &kvp->kv_startbuffer[i % KV_STARTFRAMES],
		    sizeof (ksp));
		kv_vidctx_chars(kvp, ksp, i);
		kvp->kv_last_start = i;
		*pksp = *ksp;
		*raceksp = *ksp;
		kvp->kv_emit(framename, i, timems, ksp, NULL, stdout);
		bzero(&kvp->kv_startbuffer[0], sizeof (kvp->kv_startbuffer));
		return;
	}

	/*
	 * Skip frames if we're not currently inside a race.
	 */
	if (kvp->kv_last_start == -1) {
		bcopy(ksp, &kvp->kv_startbuffer[i % KV_STARTFRAMES],
		    sizeof (*ksp));
		return;
	}

	/*
	 * kv_screen_invalid() ignores screens that have a different number of
	 * players than the initial race screen.  This is rare, since on most
	 * tracks we use the rank numerals in each square to reliably report the
	 * number of players.  On such tracks, a wrong number of players
	 * indicates a numeral in transition, in which case the frame can just
	 * be ignored.  However, on Yoshi Valley, we only have numerals for
	 * players who have finished the race, so the number of players can
	 * easily be wrong until the race is over (even after some players have
	 * finished).  In order to get the correct race times, we must not
	 * ignore such frames.  We fix this by simply bumping up the number of
	 * players on that track.  That's sufficient, since the later player
	 * fields will be initialized to the "unknown" values.  Of course,
	 * consumers need to be able to handle them.
	 */
	if (ksp->ks_nplayers > 1 &&
	    ksp->ks_nplayers < raceksp->ks_nplayers &&
	    raceksp->ks_track[0] == 'y')
		ksp->ks_nplayers = raceksp->ks_nplayers;

	if (kv_screen_invalid(ksp, pksp, raceksp))
		return;

	if (kv_screen_compare(ksp, pksp, raceksp) == 0)
		return;

	kvp->kv_emit(framename, i, timems, ksp, raceksp, stdout);
	*pksp = *ksp;

	if (ksp->ks_events & KVE_RACE_DONE)
		kvp->kv_last_start = -1;
}

void
kv_vidctx_free(kv_vidctx_t *kvp)
{
	free(kvp);
}
