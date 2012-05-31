/*
 * kartvid.c: primordial image processing for Mario Kart 64 analytics
 */

#include <assert.h>
#include <ctype.h>
#include <dirent.h>
#include <err.h>
#include <errno.h>
#include <libgen.h>
#include <math.h>
#include <setjmp.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

#include <png.h>

#define	PATH_MAX	1024

#define	EXIT_SUCCESS	0
#define	EXIT_FAILURE	1
#define	EXIT_USAGE	2

/*
 * Older versions of libpng didn't define png_jmpbuf.
 */
#ifndef png_jmpbuf
#define png_jmpbuf(png_ptr) ((png_ptr)->jmpbuf)
#endif

#define	KV_THRESHOLD_CHAR	0.15
#define	KV_THRESHOLD_TRACK	0.11
#define	KV_THRESHOLD_LAKITU	0.04

typedef struct img_pixel {
	uint8_t	r;
	uint8_t g;
	uint8_t b;
} img_pixel_t;

typedef struct img {
	unsigned int	img_width;
	unsigned int	img_height;
	img_pixel_t	*img_pixels;
} img_t;

static img_t *img_read(const char *);
static img_t *img_read_ppm(FILE *, const char *);
static img_t *img_read_png(FILE *, const char *);
static img_t *img_translatexy(img_t *, long, long);
static int img_write_ppm(img_t *, FILE *);
static void img_free(img_t *);
inline unsigned int img_coord(img_t *, unsigned int, unsigned int);
static double img_compare(img_t *, img_t *);
static void img_and(img_t *, img_t *);

static int cmd_and(int, char *[]);
static int cmd_compare(int, char *[]);
static int cmd_image(int, char *[]);
static int cmd_translatexy(int, char *[]);
static int cmd_ident(int, char *[]);
static int cmd_video(int, char *[]);

#define KV_MAXPLAYERS	4

typedef struct {
	char		kp_character[32];	/* name, "" = unknown */
	double		kp_charscore;		/* score for character match */
	short		kp_place;		/* 1-4, 0 = unknown */
	short		kp_lapnum;		/* 1-3, 0 = unknown, 4 = done */
} kv_player_t;

typedef enum {
	KVE_RACE_START = 1,			/* race is starting */
} kv_events_t;

typedef struct {
	kv_events_t	ks_events;		/* active events */
	unsigned short	ks_nplayers;		/* number of active players */
	char		ks_track[32];		/* name, "" = unknown */
	kv_player_t	ks_players[KV_MAXPLAYERS];	/* player details */
} kv_screen_t;

static int kv_ident(img_t *, kv_screen_t *);
static void kv_ident_matches(kv_screen_t *, const char *, double);
static void kv_screen_print(kv_screen_t *, FILE *);

static int kv_debug = 2;
static const char* kv_arg0;

int
main(int argc, char *argv[])
{
	int status;

	kv_arg0 = argv[0];

	if (argc < 2)
		errx(EXIT_USAGE, "usage: %s compare file mask", argv[0]);

	if (strcmp(argv[1], "compare") == 0)
		status = cmd_compare(argc - 2, argv + 2);
	else if (strcmp(argv[1], "image") == 0)
		status = cmd_image(argc - 2, argv + 2);
	else if (strcmp(argv[1], "and") == 0)
		status = cmd_and(argc - 2, argv + 2);
	else if (strcmp(argv[1], "translatexy") == 0)
		status = cmd_translatexy(argc - 2, argv + 2);
	else if (strcmp(argv[1], "ident") == 0)
		status = cmd_ident(argc - 2, argv + 2);
	else if (strcmp(argv[1], "video") == 0)
		status = cmd_video(argc - 2, argv + 2);
	else
		errx(EXIT_USAGE, "usage: %s compare file mask", argv[0]);

	return (status);
}

static int
cmd_compare(int argc, char *argv[])
{
	img_t *image, *mask;
	int rv;

	if (argc < 2) {
		warnx("missing files");
		return (EXIT_USAGE);
	}

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

static int
cmd_image(int argc, char *argv[])
{
	FILE *outfp;
	img_t *image;
	int rv;

	if (argc < 1) {
		warnx("missing file");
		return (EXIT_USAGE);
	}

	if ((image = img_read(argv[0])) == NULL)
		return (EXIT_FAILURE);

	if (argc == 1) {
		img_free(image);
		return (EXIT_SUCCESS);
	}

	if ((outfp = fopen(argv[1], "w")) == NULL) {
		warn("fopen %s", argv[1]);
		img_free(image);
		return (EXIT_FAILURE);
	}

	rv = img_write_ppm(image, outfp);
	img_free(image);

	if (rv == 0)
		(void) printf("wrote %s\n", argv[1]);

	return (rv);
}

static int
cmd_and(int argc, char *argv[])
{
	img_t *image, *mask;
	FILE *outfp;
	int rv;

	if (argc < 3) {
		warnx("missing files");
		return (EXIT_USAGE);
	}

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

static int
cmd_translatexy(int argc, char *argv[])
{
	img_t *image, *newimage;
	char *q;
	FILE *outfp;
	int rv;
	long dx, dy;

	if (argc < 4) {
		warnx("expected infile outfile x-offset y-offset");
		return (EXIT_USAGE);
	}

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

static int
cmd_ident(int argc, char *argv[])
{
	img_t *image;
	kv_screen_t info;

	if (argc < 1) {
		warnx("expected input filename");
		return (EXIT_USAGE);
	}

	image = img_read(argv[0]);
	if (image == NULL) {
		warnx("failed to read %s", argv[0]);
		return (EXIT_FAILURE);
	}

	if (kv_ident(image, &info) != 0) {
		warnx("failed to process image");
	} else {
		kv_screen_print(&info, stdout);
	}

	return (EXIT_SUCCESS);
}

static int
cmd_video(int argc, char *argv[])
{
	int i;
	img_t *image;
	kv_screen_t info;

	int started = 0;

	for (i = 0; i < argc; i++) {
		(void) fprintf(stderr, "frame %s\n", argv[i]);
		image = img_read(argv[i]);

		if (image == NULL) {
			warnx("failed to read %s", argv[i]);
			continue;
		}

		kv_ident(image, &info);
		img_free(image);

		if (!started) {
			/* Ignore all frames up to the first race start */
			if (!(info.ks_events & KVE_RACE_START))
				continue;

			started = 1;
			(void) printf(".");
		}

		if (info.ks_events & KVE_RACE_START) {
			(void) printf("starting race at frame %s\n", argv[i]);
			kv_screen_print(&info, stdout);
		}
	}

	return (EXIT_SUCCESS);
}

static const char *
stdio_error(FILE *fp)
{
	int err = errno;

	if (ferror(fp) != 0)
		return ("stream error");

	if (feof(fp) != 0)
		return ("unexpected EOF");

	return (strerror(err));
}

static img_t *
img_read(const char *filename)
{
	FILE *fp;
	img_t *rv;
	char buffer[3];

	if ((fp = fopen(filename, "r")) == NULL) {
		warn("img_read %s", filename);
		return (NULL);
	}

	if (fread(buffer, sizeof (buffer), 1, fp) != 1) {
		warnx("img_read %s: %s", filename, stdio_error(fp));
		(void) fclose(fp);
		return (NULL);
	}

	(void) fseek(fp, 0, SEEK_SET);

	if (buffer[0] == 'P' && buffer[1] == '6' && isspace(buffer[2])) {
		rv = img_read_ppm(fp, filename);
	} else {
		rv = img_read_png(fp, filename);
	}

	(void) fclose(fp);
	return (rv);
}

static img_t *
img_read_ppm(FILE *fp, const char *filename)
{
	int nread;
	unsigned int width, height, maxval;
	img_t *rv = NULL;

	nread = fscanf(fp, "P6 %u %u %u", &width, &height, &maxval);
	if (nread != 3) {
		warnx("img_read_ppm %s: mangled ppm header", filename);
		return (NULL);
	}

	if (maxval > 255) {
		warnx("img_read_ppm %s: unsupported color depth", filename);
		return (NULL);
	}

	if ((rv = calloc(1, sizeof (*rv))) == NULL ||
	    (rv->img_pixels = malloc(
	    sizeof (rv->img_pixels[0]) * width * height)) == NULL) {
		warn("img_read_ppm %s", filename);
		free(rv);
		return (NULL);
	}

	/* Skip the single whitespace character that follows the header. */
	(void) fseek(fp, SEEK_CUR, 1);

	rv->img_width = width;
	rv->img_height = height;

	nread = fread(rv->img_pixels, sizeof (rv->img_pixels[0]),
	    rv->img_width * rv->img_height, fp);

	if (nread != rv->img_width * rv->img_height) {
		warnx("img_read_ppm %s: %s", filename, stdio_error(fp));
		img_free(rv);
		return (NULL);
	}

	return (rv);
}

static int
img_write_ppm(img_t *image, FILE *fp)
{
	int nread;

	(void) fprintf(fp, "P6\n%u %u\n%u\n", image->img_width,
	    image->img_height, 255);

	nread = fwrite(image->img_pixels, sizeof (image->img_pixels[0]),
	    image->img_width * image->img_height, fp);

	if (nread != image->img_width * image->img_height) {
		warn("img_write_ppm: failed after %d of %d pixels", nread,
		    image->img_width * image->img_height);
		return (-1);
	}

	return (0);
}

static img_t *
img_read_png(FILE *fp, const char *filename)
{
	uint8_t header[8];
	unsigned int width, height, i;
	img_t *rv;

	png_structp png;
	png_infop pnginfo;
	png_byte color_type, depth;

	png_bytep *rows;

	if (fread(header, sizeof (header), 1, fp) != 1) {
		warnx("img_read_png %s: failed to read header: %s",
		    filename, stdio_error(fp));
		return (NULL);
	}

	if (png_sig_cmp(header, 0, sizeof (header)) != 0) {
		warnx("img_read_png %s: bad magic", filename);
		return (NULL);
	}

	if ((png = png_create_read_struct(PNG_LIBPNG_VER_STRING,
	    NULL, NULL, NULL)) == NULL ||
	    (pnginfo = png_create_info_struct(png)) == NULL) {
		warnx("failed to initialize libpng");
		return (NULL);
	}

	if (setjmp(png_jmpbuf(png)) != 0) {
		warnx("error reading PNG image");
		png_destroy_read_struct(&png, &pnginfo, NULL);
		return (NULL);
	}

	png_init_io(png, fp);
	png_set_sig_bytes(png, sizeof (header));
	png_read_info(png, pnginfo);

	width = png_get_image_width(png, pnginfo);
	height = png_get_image_height(png, pnginfo);
	color_type = png_get_color_type(png, pnginfo);
	depth = png_get_bit_depth(png, pnginfo);
	png_read_update_info(png, pnginfo);

	if (kv_debug > 3) {
		(void) printf("PNG image:  %u x %u pixels\n", width, height);
		(void) printf("bit depth:  %x\n", depth);
		(void) printf("color type: %x\n", color_type);
	}

	if (depth > 8) {
		warnx("img_read_png %s: unsupported bit depth", filename);
		return (NULL);
	}

	if (color_type != PNG_COLOR_TYPE_RGB) {
		warnx("img_read_png %s: unsupported color type", filename);
		return (NULL);
	}

	if ((rv = calloc(1, sizeof (*rv))) == NULL ||
	    (rv->img_pixels = malloc(
	    sizeof (rv->img_pixels[0]) * width * height)) == NULL) {
		warn("img_read_png %s");
		free(rv);
		return (NULL);
	}

	rv->img_width = width;
	rv->img_height = height;

	if ((rows = malloc(sizeof (rows[0]) * height)) == NULL) {
		warn("img_read_png %s");
		img_free(rv);
		return (NULL);
	}

	assert(png_get_rowbytes(png, pnginfo) == sizeof (img_pixel_t) * width);

	for (i = 0; i < height; i++)
		rows[i] = (png_bytep)&rv->img_pixels[img_coord(rv, 0, i)];

	png_read_image(png, rows);
	png_read_end(png, NULL);
	free(rows);
	png_destroy_read_struct(&png, &pnginfo, NULL);

	return (rv);
}

static void
img_free(img_t *imgp)
{
	if (imgp == NULL)
		return;
	
	free(imgp->img_pixels);
	free(imgp);
}

static double
img_compare(img_t *image, img_t *mask)
{
	unsigned int x, y, i;
	unsigned int dr, dg, db, dz2;
	unsigned int npixels;
	unsigned int nignored = 0, ndifferent = 0;
	double sum = 0;
	double score;
	img_pixel_t *imgpx, *maskpx;

	assert(image->img_width == mask->img_width);
	assert(image->img_height == mask->img_height);

	for (y = 0; y < image->img_height; y++) {
		for (x = 0; x < image->img_width; x++) {
			i = img_coord(image, x, y);
			maskpx = &mask->img_pixels[i];
			imgpx = &image->img_pixels[i];

			/*
			 * Ignore nearly-black pixels in the mask.
			 */
			if (maskpx->r < 2 && maskpx->g < 2 && maskpx->b < 2) {
				nignored++;
				continue;
			}

			dr = maskpx->r - imgpx->r;
			dg = maskpx->g - imgpx->g;
			db = maskpx->b - imgpx->b;
			dz2 = dr * dr + dg * dg + db * db;

			if (dz2 == 0)
				continue;

			ndifferent++;
			sum += sqrt(dz2);
		}
	}

	/*
	 * The score is the average difference between subpixel values in the
	 * image and the mask for non-ignored subpixels.  That is, we take
	 * non-black pixels in the mask, compare them to their counterparts in
	 * the image, and compute the average difference.  We divide that by the
	 * maximum possible distance.
	 */
	npixels = image->img_height * image->img_width;
	score = (sum / sqrt(255 * 255 * 3)) / (npixels - nignored);

	if (kv_debug > 3) {
		(void) printf("total pixels:     %d\n", npixels);
		(void) printf("ignored pixels:   %d\n", nignored);
		(void) printf("compared pixels:  %d\n", npixels - nignored);
		(void) printf("different pixels: %d\n", ndifferent);
		(void) printf("difference score: %f\n", score);
	}

	return (score);
}

static void
img_and(img_t *image, img_t *mask)
{
	unsigned int x, y, i;
	img_pixel_t *imgpx, *maskpx;

	assert(image->img_width == mask->img_width);
	assert(image->img_height == mask->img_height);

	for (y = 0; y < image->img_height; y++) {
		for (x = 0; x < image->img_width; x++) {
			i = img_coord(image, x, y);
			maskpx = &mask->img_pixels[i];
			imgpx = &image->img_pixels[i];

			imgpx->r &= maskpx->r;
			imgpx->g &= maskpx->g;
			imgpx->b &= maskpx->b;
		}
	}
}

static img_t *
img_translatexy(img_t *image, long dx, long dy)
{
	img_t *newimg;
	img_pixel_t *imgpx, *newpx;
	unsigned int x, y, i;
	
	if ((newimg = calloc(1, sizeof (*newimg))) == NULL ||
	    (newimg->img_pixels = malloc(image->img_width * image->img_height *
	    sizeof (newimg->img_pixels[0]))) == NULL) {
		free(newimg);
		return (NULL);
	}

	newimg->img_width = image->img_width;
	newimg->img_height = image->img_height;

	for (y = 0; y < newimg->img_height; y++) {
		for (x = 0; x < newimg->img_width; x++) {
			i = img_coord(newimg, x, y);
			newpx = &newimg->img_pixels[i];

			if (x - dx < 0 || x - dx >= image->img_width ||
			    y - dy < 0 || y - dy >= image->img_height) {
				newpx->r = newpx->g = newpx->b = 0;
				continue;
			}

			i = img_coord(image, x - dx, y - dy);
			imgpx = &image->img_pixels[i];
			newpx->r = imgpx->r;
			newpx->g = imgpx->g;
			newpx->b = imgpx->b;
		}
	}

	return (newimg);
}

inline unsigned int
img_coord(img_t *image, unsigned int x, unsigned int y)
{
	assert(x < image->img_width);
	assert(y < image->img_height);
	return (x + image->img_width * y);
}

static int
kv_ident(img_t *image, kv_screen_t *ksp)
{
	img_t *mask;
	double score, checkthresh;
	DIR *maskdir;
	struct dirent *entp;
	char maskname[PATH_MAX];
	char maskdirname[PATH_MAX];

	/*
	 * For now, rather than explicitly enumerate the masks and check each
	 * one, we iterate the masks we have, see which ones match this image,
	 * and update the screen info accordingly.
	 */
	bzero(ksp, sizeof (*ksp));

	(void) snprintf(maskdirname, sizeof (maskdirname),
	    "%s/../assets/masks", dirname((char *)kv_arg0));

	if ((maskdir = opendir(maskdirname)) == NULL) {
		warn("failed to opendir %s", maskdirname);
		return (-1);
	}

	while ((entp = readdir(maskdir)) != NULL) {
		if (strncmp(entp->d_name, "char_", sizeof ("char_") - 1) != 0 &&
		    strncmp(entp->d_name, "pos", sizeof ("pos") - 1) != 0 &&
		    strncmp(entp->d_name, "lakitu_start",
		    sizeof ("lakitu_start") - 1) != 0 &&
		    strncmp(entp->d_name, "track_", sizeof ("track_") - 1) != 0)
			continue;

		if (kv_debug > 1)
			(void) printf("mask %-20s: ", entp->d_name);

		(void) snprintf(maskname, sizeof (maskname), "%s/%s",
		    maskdirname, entp->d_name);

		if ((mask = img_read(maskname)) == NULL) {
			warnx("failed to read %s", maskname);
			(void) closedir(maskdir);
			return (-1);
		}

		score = img_compare(image, mask);
		img_free(mask);

		if (kv_debug > 1)
			(void) printf("%f\n", score);

		if (strncmp(entp->d_name, "char_", sizeof ("char_") - 1) == 0)
			checkthresh = KV_THRESHOLD_CHAR;
		else if (strncmp(entp->d_name, "lakitu_start",
		    sizeof ("lakitu_start") - 1) == 0)
			checkthresh = KV_THRESHOLD_LAKITU;
		else
			checkthresh = KV_THRESHOLD_TRACK;

		if (score > checkthresh)
			continue;

		kv_ident_matches(ksp, entp->d_name, score);
	}

	(void) closedir(maskdir);
	return (0);
}

static void
kv_ident_matches(kv_screen_t *ksp, const char *mask, double score)
{
	unsigned int pos, square;
	char *p;
	kv_player_t *kpp;
	char buf[64];

	if (kv_debug > 0)
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

static void
kv_screen_print(kv_screen_t *ksp, FILE *out)
{
	int i;
	kv_player_t *kpp;

	assert(ksp->ks_nplayers <= KV_MAXPLAYERS);

	(void) fprintf(out, "%d players: %s\n", ksp->ks_nplayers,
	    ksp->ks_track[0] == '\0' ? "Unknown Track" : ksp->ks_track);

	if (ksp->ks_events & KVE_RACE_START)
		(void) fprintf(out, "Race starting!\n");

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
