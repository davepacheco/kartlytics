/*
 * kartvid.c: primordial image processing for Mario Kart 64 analytics
 */

#include <dirent.h>
#include <err.h>
#include <libgen.h>
#include <stdint.h>
#include <stdlib.h>
#include <unistd.h>

#include <png.h>

#include "compat.h"
#include "img.h"
#include "kv.h"

static void usage(const char *);
static int cmd_and(int, char *[]);
static int cmd_compare(int, char *[]);
static int cmd_translatexy(int, char *[]);
static int cmd_ident(int, char *[]);
static int cmd_video(int, char *[]);
static int video_frames(int, char **);

#define	MAX_FRAMES	16384

typedef struct {
	const char 	 *kvc_name;
	int		(*kvc_func)(int, char *[]);
	const char 	 *kvc_args;
	const char	 *kvc_usage;
} kv_cmd_t;

static kv_cmd_t kv_commands[] = {
    { "and", cmd_and, "input1 input2 output",
      "logical-and pixel values of two images" },
    { "compare", cmd_compare, "image mask",
      "compute difference score for the given image and mask" },
    { "translatexy", cmd_translatexy, "input output x-offset y-offset",
      "shift the given image using the given x and y offsets" },
    { "ident", cmd_ident, "image",
      "report the current game state for the given image" },
    { "video", cmd_video, "dir_of_image_files", 
      "emit race events for an entire video" }
};

static int kv_ncommands = sizeof (kv_commands) / sizeof (kv_commands[0]);
static const char *kv_arg0;

int kv_debug = 0;

int
main(int argc, char *argv[])
{
	char c;
	int i, status;
	kv_cmd_t *kcp = NULL;

	kv_arg0 = argv[0];

	while ((c = getopt(argc, argv, "d")) != -1) {
		switch (c) {
		case 'd':
			kv_debug++;
			break;
		case '?':
		default:
			usage(NULL);
		}
	}

	argc -= optind;
	argv += optind;

	if (argc < 1)
		usage("too few arguments");

	for (i = 0; i < kv_ncommands; i++) {
		kcp = &kv_commands[i];

		if (strcmp(argv[0], kcp->kvc_name) == 0)
			break;
	}

	if (i == kv_ncommands)
		usage("unknown command");

	status = kcp->kvc_func(argc - 1, argv + 1);

	if (status == EXIT_USAGE)
		usage("missing arguments");

	return (status);
}

static void
usage(const char *message)
{
	int i;
	const char *name;
	kv_cmd_t *kcp;

	name = basename((char *)kv_arg0);

	if (message != NULL)
		warnx(message);

	for (i = 0; i < kv_ncommands; i++) {
		kcp = &kv_commands[i];
		(void) fprintf(stderr, "\n    %s %s %s\n", name,
		    kcp->kvc_name, kcp->kvc_args);
		(void) fprintf(stderr, "        %s\n", kcp->kvc_usage);
	}

	exit(EXIT_USAGE);
}

/*
 * compare image mask: compute a difference score for the given image and mask.
 */
static int
cmd_compare(int argc, char *argv[])
{
	img_t *image, *mask;
	int rv;

	if (argc < 2)
		return (EXIT_USAGE);

	image = img_read(argv[0]);
	mask = img_read(argv[1]);

	if (mask == NULL || image == NULL) {
		img_free(image);
		return (EXIT_FAILURE);
	}

	if (image->img_width != mask->img_width ||
	    image->img_height != mask->img_height) {
		warnx("image dimensions do not match");
		rv = EXIT_FAILURE;
	} else {
		(void) printf("%f\n", img_compare(image, mask));
		rv = EXIT_SUCCESS;
	}

	img_free(image);
	img_free(mask);
	return (rv);
}

/*
 * and input1 input2 output: logical-and pixels of two images
 */
static int
cmd_and(int argc, char *argv[])
{
	img_t *image, *mask;
	FILE *outfp;
	int rv;

	if (argc < 3)
		return (EXIT_USAGE);

	image = img_read(argv[0]);
	mask = img_read(argv[1]);

	if (mask == NULL || image == NULL) {
		img_free(image);
		return (EXIT_FAILURE);
	}

	if (image->img_width != mask->img_width ||
	    image->img_height != mask->img_height) {
		warnx("image dimensions do not match");
		img_free(image);
		img_free(mask);
		return (EXIT_FAILURE);
	}

	if ((outfp = fopen(argv[2], "w")) == NULL) {
		warn("fopen %", argv[1]);
		img_free(image);
		img_free(mask);
		return (EXIT_FAILURE);
	}

	img_and(image, mask);
	rv = img_write_ppm(image, outfp);
	img_free(image);
	img_free(mask);
	return (rv);
}

/*
 * translatexy input output xoffset yoffset: shift an image by the given offsets
 */
static int
cmd_translatexy(int argc, char *argv[])
{
	img_t *image, *newimage;
	char *q;
	FILE *outfp;
	int rv;
	long dx, dy;

	if (argc < 4)
		return (EXIT_USAGE);

	image = img_read(argv[0]);
	if (image == NULL)
		return (EXIT_FAILURE);

	outfp = fopen(argv[1], "w");
	if (outfp == NULL) {
		warn("fopen %s", argv[1]);
		img_free(image);
		return (EXIT_FAILURE);
	}

	dx = strtol(argv[2], &q, 0);
	if (*q != '\0')
		warnx("x offset value truncated to %d", dx);

	dy = strtol(argv[3], &q, 0);
	if (*q != '\0')
		warnx("y offset value truncated to %d", dy);

	newimage = img_translatexy(image, dx, dy);
	if (newimage == NULL) {
		warn("failed to translate image");
		img_free(image);
		return (EXIT_FAILURE);
	}

	rv = img_write_ppm(newimage, outfp);
	img_free(newimage);
	return (rv);
}

/*
 * ident input: identify the game state described in a given image
 */
static int
cmd_ident(int argc, char *argv[])
{
	img_t *image;
	kv_screen_t info;

	if (argc < 1)
		return (EXIT_USAGE);

	if (kv_init(dirname((char *)kv_arg0)) != 0) {
		warnx("failed to initialize masks");
		return (EXIT_FAILURE);
	}

	image = img_read(argv[0]);
	if (image == NULL) {
		warnx("failed to read %s", argv[0]);
		return (EXIT_FAILURE);
	}

	if (kv_ident(image, &info, B_TRUE) != 0) {
		warnx("failed to process image");
	} else {
		kv_screen_print(&info, NULL, stdout);
	}

	return (EXIT_SUCCESS);
}

static int
qsort_strcmp(const void *vs1, const void *vs2)
{
	return (strcmp(*((const char **)vs1), *((const char **)vs2)));
}

/*
 * video input ...: emit events describing game state changes in a video
 */
static int
cmd_video(int argc, char *argv[])
{
	DIR *dirp;
	struct dirent *entp;
	int nframes, rv, i, len;
	char *q;
	char *framenames[MAX_FRAMES];

	if (argc < 1) {
		warnx("missing directory name");
		return (EXIT_USAGE);
	}

	if ((dirp = opendir(argv[0])) == NULL) {
		warn("failed to opendir %s", argv[0]);
		return (EXIT_USAGE);
	}

	nframes = 0;
	rv = EXIT_FAILURE;
	while ((entp = readdir(dirp)) != NULL) {
		if (nframes >= MAX_FRAMES) {
			warnx("max %d frames supported", MAX_FRAMES);
			break;
		}

		if (strcmp(entp->d_name, ".") == 0 ||
		    strcmp(entp->d_name, "..") == 0)
			continue;

		len = snprintf(NULL, 0, "%s/%s", argv[0], entp->d_name);
		if ((q = malloc(len + 1)) == NULL) {
			warn("malloc");
			break;
		}

		(void) snprintf(q, len + 1, "%s/%s", argv[0], entp->d_name);
		framenames[nframes++] = q;
	}

	(void) closedir(dirp);

	if (entp == NULL) {
		qsort(framenames, nframes, sizeof (framenames[0]),
		    qsort_strcmp);
		rv = video_frames(nframes, framenames);
	}

	for (i = 0; i < nframes; i++)
		free(framenames[i]);

	return (rv);
}

static int
video_frames(int argc, char **argv)
{
	int i;
	img_t *image;
	kv_screen_t ks, pks, raceks;
	kv_screen_t *ksp, *pksp, *raceksp;

	int last_start = -1;

	if (kv_init(dirname((char *)kv_arg0)) != 0) {
		warnx("failed to initialize masks");
		return (EXIT_FAILURE);
	}

	ksp = &ks;		/* current frame state */
	pksp = &pks;		/* first frame matching the current state */
	raceksp = &raceks;	/* first frame state for this race */

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
	for (i = 0; i < argc; i++) {
		if (last_start != -1 && i - last_start < KV_MIN_RACE_FRAMES)
			/* Skip the first frames after a start. See above. */
			continue;

		image = img_read(argv[i]);

		if (image == NULL) {
			warnx("failed to read %s", argv[i]);
			continue;
		}

		kv_ident(image, ksp, B_FALSE);
		img_free(image);

		if (ksp->ks_events & KVE_RACE_START) {
			if (last_start != -1) {
				(void) printf("%s (time %dm:%02ds): "
				    "new race begun (previous one aborted)",
				    argv[i], (int)(i / KV_FRAMERATE) / 60,
				    (int)(i / KV_FRAMERATE) % 60);
			}

			kv_ident(image, ksp, B_TRUE);
			last_start = i;
			*pksp = *ksp;
			*raceksp = *ksp;
			(void) printf("%s (time %dm:%02ds): ", argv[i],
			    (int)(i / KV_FRAMERATE) / 60,
			    (int)(i / KV_FRAMERATE) % 60);
			kv_screen_print(ksp, NULL, stdout);
			continue;
		}

		/*
		 * Skip frames if we're not currently inside a race.
		 */
		if (last_start == -1)
			continue;

		if (kv_screen_invalid(ksp, pksp))
			continue;

		if (kv_screen_compare(ksp, pksp) == 0)
			continue;

		(void) printf("%s (time %dm:%02ds): ", argv[i],
		    i / 30 / 60, (i / 30) % 60);
		kv_screen_print(ksp, raceksp, stdout);
		*pksp = *ksp;

		if (ksp->ks_events & KVE_RACE_DONE)
			last_start = -1;
	}

	return (EXIT_SUCCESS);
}
