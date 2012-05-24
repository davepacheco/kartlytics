/*
 * kartvid.c: primordial image processing for Mario Kart 64 analytics
 */

#include <assert.h>
#include <ctype.h>
#include <err.h>
#include <errno.h>
#include <math.h>
#include <setjmp.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

#include <png.h>

#define	EXIT_SUCCESS	0
#define	EXIT_FAILURE	1
#define	EXIT_USAGE	2

/*
 * Older versions of libpng didn't define png_jmpbuf.
 */
#ifndef png_jmpbuf
#define png_jmpbuf(png_ptr) ((png_ptr)->jmpbuf)
#endif

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
static int img_write_ppm(img_t *, FILE *);
static void img_free(img_t *);
inline unsigned int img_coord(img_t *, unsigned int, unsigned int);
static double img_compare(img_t *, img_t *);
static void img_and(img_t *, img_t *);

static int cmd_compare(int, char *[]);
static int cmd_and(int, char *[]);
static int cmd_image(int, char *[]);

static int kv_debug = 0;

int
main(int argc, char *argv[])
{
	int status;

	if (argc < 2)
		errx(EXIT_USAGE, "usage: %s compare file mask", argv[0]);

	if (strcmp(argv[1], "compare") == 0)
		status = cmd_compare(argc - 2, argv + 2);
	else if (strcmp(argv[1], "image") == 0)
		status = cmd_image(argc - 2, argv + 2);
	else if (strcmp(argv[1], "and") == 0)
		status = cmd_and(argc - 2, argv + 2);
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
		(void) img_compare(image, mask);
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

	if (kv_debug) {
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
	(void) printf("total pixels:     %d\n", npixels);
	(void) printf("ignored pixels:   %d\n", nignored);
	(void) printf("compared pixels:  %d\n", npixels - nignored);
	(void) printf("different pixels: %d\n", ndifferent);
	(void) printf("difference score: %f\n", score);

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

inline unsigned int
img_coord(img_t *image, unsigned int x, unsigned int y)
{
	assert(x < image->img_width);
	assert(y < image->img_height);
	return (x + image->img_width * y);
}
