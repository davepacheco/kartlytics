/*
 * kartvid.c: primordial image processing for Mario Kart 64 analytics
 */

#include <dirent.h>
#include <err.h>
#include <libgen.h>
#include <stdint.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/stat.h>

#include <png.h>

#include "compat.h"
#include "img.h"
#include "kv.h"
#include "video.h"

static void usage(const char *);
static int cmd_and(int, char *[]);
static int cmd_compare(int, char *[]);
static int cmd_translatexy(int, char *[]);
static int cmd_ident(int, char *[]);
static int cmd_frames(int, char *[]);
static int cmd_decode(int, char *[]);
static int write_frame(video_frame_t *, void *);
static int cmd_video(int, char *[]);
static int ident_frame(video_frame_t *, void *);
static int cmd_rgb2hsv(int, char *[]);

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
    { "compare", cmd_compare, "[-s debugfile] image mask",
      "compute difference score for the given image and mask" },
    { "decode", cmd_decode, "input output-dir",
      "decode a video into its constituent PPM images" },
    { "translatexy", cmd_translatexy, "input output x-offset y-offset",
      "shift the given image using the given x and y offsets" },
    { "ident", cmd_ident, "image",
      "report the current game state for the given image" },
    { "frames", cmd_frames, "[-j] dir_of_image_files", 
      "emit race events for a sequence of video frames" },
    { "rgb2hsv", cmd_rgb2hsv, "r g b", "convert rgb value to hsv" },
    { "video", cmd_video, "[-j] [-d debugdir] video_file",
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

	GETOPT_RESET();
	optind = 0;

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
		usage(NULL);

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
	img_t *image, *mask, *dbgmask;
	char *dbgfile = NULL;
	int rv;
	char c;

	while ((c = getopt(argc, argv, "s:")) != -1) {
		switch (c) {
		case 's':
			dbgfile = optarg;
			break;
		default:
			return (EXIT_USAGE);
		}
	}

	if (optind + 2 > argc)
		return (EXIT_USAGE);

	image = img_read(argv[optind++]);
	mask = img_read(argv[optind++]);

	if (mask == NULL || image == NULL) {
		img_free(image);
		return (EXIT_FAILURE);
	}

	if (image->img_width != mask->img_width ||
	    image->img_height != mask->img_height) {
		warnx("image dimensions do not match");
		rv = EXIT_FAILURE;
		goto done;
	}

	(void) printf("%f\n",
	    img_compare(image, mask, dbgfile ? &dbgmask : NULL));

	if (dbgfile != NULL && dbgmask != NULL) {
		(void) img_write(dbgmask, dbgfile);
		img_free(dbgmask);
	}

	rv = EXIT_SUCCESS;

done:
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

	img_and(image, mask);
	rv = img_write(image, argv[2]);
	img_free(image);
	img_free(mask);
	return (rv == 0 ? EXIT_SUCCESS : EXIT_FAILURE);
}

/*
 * translatexy input output xoffset yoffset: shift an image by the given offsets
 */
static int
cmd_translatexy(int argc, char *argv[])
{
	img_t *image, *newimage;
	char *q;
	int rv;
	long dx, dy;

	if (argc < 4)
		return (EXIT_USAGE);

	image = img_read(argv[0]);
	if (image == NULL)
		return (EXIT_FAILURE);

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

	rv = img_write(newimage, argv[1]);
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
		kv_screen_json(argv[0], 0, 0, &info, NULL, stdout);
	}

	return (EXIT_SUCCESS);
}

static int
qsort_strcmp(const void *vs1, const void *vs2)
{
	return (strcmp(*((const char **)vs1), *((const char **)vs2)));
}

/*
 * frames input ...: emit events describing game state changes in video frames
 */
static int
cmd_frames(int argc, char *argv[])
{
	DIR *dirp;
	struct dirent *entp;
	int nframes, rv, i, len;
	kv_emit_f emit;
	char c;
	char *q;
	img_t *image;
	kv_vidctx_t *kvp;
	char *framenames[MAX_FRAMES];

	emit = kv_screen_print;

	while ((c = getopt(argc, argv, "j")) != -1) {
		switch (c) {
		case 'j':
			emit = kv_screen_json;
			break;

		case '?':
		default:
			return (EXIT_USAGE);
		}
	}

	argc -= optind;
	argv += optind;

	if (argc < 1) {
		warnx("missing directory name");
		return (EXIT_USAGE);
	}

	if ((kvp = kv_vidctx_init(dirname((char *)kv_arg0), emit, NULL)) == NULL)
		return (EXIT_FAILURE);

	if ((dirp = opendir(argv[0])) == NULL) {
		kv_vidctx_free(kvp);
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

		if (strcmp(entp->d_name + strlen(entp->d_name) -
		    sizeof (".png") + 1, ".png") != 0)
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

	if (entp != NULL)
		goto out;

	rv = EXIT_SUCCESS;
	qsort(framenames, nframes, sizeof (framenames[0]), qsort_strcmp);

	for (i = 0; i < nframes; i++) {
		image = img_read(framenames[i]);

		if (image == NULL) {
			warnx("failed to read %s", argv[i]);
			continue;
		}

		kv_vidctx_frame(framenames[i], i,
		    i / KV_FRAMERATE * MILLISEC, image, kvp);
		img_free(image);
	}

out:
	kv_vidctx_free(kvp);

	for (i = 0; i < nframes; i++)
		free(framenames[i]);

	return (rv);
}

static int
cmd_decode(int argc, char *argv[])
{
	video_t *vp;
	int rv;

	if (argc < 2) {
		warnx("missing input file or output directory");
		return (EXIT_USAGE);
	}

	if ((vp = video_open(argv[0])) == NULL)
		return (EXIT_FAILURE);

	rv = video_iter_frames(vp, write_frame, argv[1]);
	video_free(vp);
	return (rv);
}

static int
write_frame(video_frame_t *vfp, void *rawarg)
{
	const char *dir = (char *)rawarg;
	char buf[PATH_MAX];

	(void) snprintf(buf, sizeof (buf), "%s/frame%d.png",
	    dir, vfp->vf_framenum);
	(void) img_write(&vfp->vf_image, buf);

	if (vfp->vf_framenum > 5)
		return (EXIT_FAILURE);

	return (EXIT_SUCCESS);
}

static int
cmd_video(int argc, char *argv[])
{
	kv_vidctx_t *kvp;
	video_t *vp;
	int rv;
	char c;
	const char *dbgdir = NULL;
	kv_emit_f emit;

	emit = kv_screen_print;

	while ((c = getopt(argc, argv, "jd:")) != -1) {
		switch (c) {
		case 'j':
			emit = kv_screen_json;
			break;

		case 'd':
			dbgdir = optarg;
			break;

		case '?':
		default:
			return (EXIT_USAGE);
		}
	}

	argc -= optind;
	argv += optind;

	if (argc < 1) {
		warnx("missing input file");
		return (EXIT_USAGE);
	}

	/*
	 * This isn't strictly necessary, but is a useful prereq so that we
	 * don't get partway through the conversion and fail because the user
	 * forgot to create the directory.
	 */
	if (dbgdir != NULL) {
		struct stat st;
		if (stat(dbgdir, &st) != 0) {
			warn("stat %s", dbgdir);
			return (EXIT_USAGE);
		}

		if ((st.st_mode & S_IFDIR) == 0) {
			warnx("not a directory: %s", dbgdir);
			return (EXIT_USAGE);
		}
	}

	if ((vp = video_open(argv[0])) == NULL)
		return (EXIT_FAILURE);

	if (kv_debug > 0)
		(void) fprintf(stderr, "framerate: %lf\n",
		    video_framerate(vp));

	if ((kvp = kv_vidctx_init(dirname((char *)kv_arg0), emit,
	    dbgdir)) == NULL) {
		video_free(vp);
		return (EXIT_FAILURE);
	}

	if (emit == kv_screen_json)
		(void) printf("{ \"nframes\": %d, \"crtime\": \"%s\" }\n",
		    video_nframes(vp), video_crtime(vp));

	rv = video_iter_frames(vp, ident_frame, kvp);
	kv_vidctx_free(kvp);
	video_free(vp);
	return (rv);
}

static int
ident_frame(video_frame_t *vp, void *rawarg)
{
	kv_vidctx_t *kvp = rawarg;
	char framename[16];

	(void) snprintf(framename, sizeof (framename),
	    "frame %d", vp->vf_framenum);
	kv_vidctx_frame(framename, vp->vf_framenum, (int)vp->vf_frametime,
	    &vp->vf_image, kvp);
	return (0);
}

static int
cmd_rgb2hsv(int argc, char *argv[])
{
	img_pixel_t rgb;
	img_pixelhsv_t hsv;

	if (argc < 3)
		return (EXIT_USAGE);

	rgb.r = atoi(argv[0]);
	rgb.g = atoi(argv[1]);
	rgb.b = atoi(argv[2]);

	img_pix_rgb2hsv(&hsv, &rgb);

	(void) printf("r g b = (%d, %d, %d)\n", rgb.r, rgb.g, rgb.b);
	(void) printf("h s v = (%d, %d, %d)\n", hsv.h, hsv.s, hsv.v);

	return (EXIT_SUCCESS);
}
