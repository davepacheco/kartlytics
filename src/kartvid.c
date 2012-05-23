#include <assert.h>
#include <math.h>
#include <errno.h>
#include <stdio.h>
#include <unistd.h>
#include <setjmp.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <sys/types.h>

#include <png.h>

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

static img_t *img_read_ppm(const char *);
static img_t *img_read_png(const char *);
static int img_write_ppm(img_t *, FILE *);
static void img_free(img_t *);
inline unsigned int img_coord(img_t *, unsigned int, unsigned int);
static double img_compare(img_t *, img_t *);

static int cmd_compare(int, char *[]);
static int cmd_rewrite(int, char *[]);
static int cmd_png(int, char *[]);

int
main(int argc, char *argv[])
{
	int status;

	if (argc < 2) {
		(void) fprintf(stderr, "usage: %s compare file mask\n",
		    argv[0]);
		return (2);
	}

	if (strcmp(argv[1], "compare") == 0)
		status = cmd_compare(argc - 2, argv + 2);
	else if (strcmp(argv[1], "rewrite") == 0)
		status = cmd_rewrite(argc - 2, argv + 2);
	else if (strcmp(argv[1], "png") == 0)
		status = cmd_png(argc - 2, argv + 2);
	else {
		(void) fprintf(stderr, "usage: %s compare file mask\n",
		    argv[0]);
		status = 1;
	}

	return (status);
}

static int
cmd_compare(int argc, char *argv[])
{
	img_t *image, *mask;
	int rv;

	if (argc < 2) {
		(void) fprintf(stderr, "missing files\n");
		return (2);
	}

	if ((image = img_read_ppm(argv[0])) == NULL ||
	    (mask = img_read_ppm(argv[1])) == NULL) {
		img_free(image);
		return (1);
	}

	if (image->img_width != mask->img_width ||
	    image->img_height != mask->img_height) {
		(void) fprintf(stderr, "image dimensions do not match\n");
		rv = 1;
	} else {
		(void) img_compare(image, mask);
		rv = 0;
	}

	img_free(image);
	img_free(mask);
	return (rv);
}

static int
cmd_rewrite(int argc, char *argv[])
{
	img_t *image;
	FILE *outfp;
	int rv;

	if (argc < 2) {
		(void) fprintf(stderr, "missing files\n");
		return (2);
	}

	if ((image = img_read_ppm(argv[0])) == NULL)
		return (1);

	if ((outfp = fopen(argv[1], "w")) == NULL) {
		perror("fopen");
		img_free(image);
		return (1);
	}

	rv = img_write_ppm(image, outfp);
	img_free(image);
	return (rv);
}

static int
cmd_png(int argc, char *argv[])
{
	FILE *outfp;
	img_t *image;
	int rv;

	if (argc < 1) {
		(void) fprintf(stderr, "missing file\n");
		return (2);
	}

	if ((image = img_read_png(argv[0])) == NULL)
		return (1);

	if (argc == 1) {
		img_free(image);
		return (0);
	}

	if ((outfp = fopen(argv[1], "w")) == NULL) {
		perror("fopen");
		img_free(image);
		return (1);
	}

	rv = img_write_ppm(image, outfp);
	img_free(image);

	if (rv == 0)
		(void) printf("wrote %s\n", argv[1]);

	return (rv);
}

static img_t *
img_read_ppm(const char *filename)
{
	FILE *fp;
	int nread;
	unsigned int width, height, maxval;
	img_t *rv = NULL;

	if ((fp = fopen(filename, "r")) == NULL) {
		(void) fprintf(stderr, "img_read_ppm %s: %s\n",
		    filename, strerror(errno));
		return (NULL);
	}

	nread = fscanf(fp, "P6 %u %u %u", &width, &height, &maxval);
	if (nread != 3) {
		(void) fprintf(stderr, "img_read_ppm %s: failed to parse "
		    "ppm header\n", filename);
		(void) fclose(fp);
		return (NULL);
	}

	if (maxval > 255) {
		(void) fprintf(stderr, "img_read_ppm %s: unsupported color "
		    "depth\n", filename);
		(void) fclose(fp);
		return (NULL);
	}

	if ((rv = calloc(1, sizeof (*rv))) == NULL ||
	    (rv->img_pixels = malloc(
	    sizeof (rv->img_pixels[0]) * width * height)) == NULL) {
		free(rv);
		(void) fprintf(stderr, "img_read_ppm %s: %s\n", filename,
		    strerror(errno));
		(void) fclose(fp);
		return (NULL);
	}

	/* Skip the single whitespace character that follows the header. */
	(void) fseek(fp, SEEK_CUR, 1);

	rv->img_width = width;
	rv->img_height = height;

	nread = fread(rv->img_pixels, sizeof (rv->img_pixels[0]),
	    rv->img_width * rv->img_height, fp);
	(void) fclose(fp);
	if (nread != rv->img_width * rv->img_height) {
		(void) fprintf(stderr, "img_read_ppm %s: unexpected end of file"
		    " (read %d pixels, expected %d): ", filename, nread,
		    rv->img_height * rv->img_height);
		if (feof(fp))
			(void) fprintf(stderr, "at EOF\n");
		else if (ferror(fp))
			(void) fprintf(stderr, "error\n");
		else
			(void) fprintf(stderr, "%s\n", strerror(errno));
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
		(void) fprintf(stderr, "img_write_ppm: failed (wrote %d of %d "
		    "pixels", nread, image->img_width * image->img_height);
		return (-1);
	}

	return (0);
}

static img_t *
img_read_png(const char *filename)
{
	FILE *fp;
	uint8_t header[8];
	unsigned int width, height, i;
	img_t *rv;

	png_structp png;
	png_infop pnginfo;
	png_byte color_type, depth;

	png_bytep *rows;

	if ((fp = fopen(filename, "r")) == NULL) {
		perror("fopen");
		return (NULL);
	}

	if (fread(header, sizeof (header), 1, fp) != 1) {
		(void) fprintf(stderr, "img_read_png %s: failed to read "
		    "header\n", filename);
		(void) fclose(fp);
		return (NULL);
	}

	if (png_sig_cmp(header, 0, sizeof (header)) != 0) {
		(void) fprintf(stderr, "img_read_png %s: bad magic\n",
		    filename);
		(void) fclose(fp);
		return (NULL);
	}

	if ((png = png_create_read_struct(PNG_LIBPNG_VER_STRING,
	    NULL, NULL, NULL)) == NULL ||
	    (pnginfo = png_create_info_struct(png)) == NULL) {
		(void) fprintf(stderr, "failed to initialize libpng\n");
		(void) fclose(fp);
		return (NULL);
	}

	if (setjmp(png_jmpbuf(png)) != 0) {
		fprintf(stderr, "error reading PNG image\n");
		png_destroy_read_struct(&png, &pnginfo, NULL);
		(void) fclose(fp);
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

	(void) printf("PNG image:        %u x %u pixels\n", width, height);
	(void) printf("color type:       %x\n", color_type);
	(void) printf("bit depth:        %x\n", depth);

	if (depth > 8) {
		(void) fprintf(stderr, "img_read_png %s: unsupported bit "
		    "depth\n", filename);
		(void) fclose(fp);
		return (NULL);
	}

	if (color_type != PNG_COLOR_TYPE_RGB) {
		(void) fprintf(stderr, "img_read_png %s: unsupported color "
		    "type\n", filename);
		(void) fclose(fp);
		return (NULL);
	}

	if ((rv = calloc(1, sizeof (*rv))) == NULL ||
	    (rv->img_pixels = malloc(
	    sizeof (rv->img_pixels[0]) * width * height)) == NULL) {
		perror("malloc");
		free(rv);
		(void) fclose(fp);
		return (NULL);
	}

	rv->img_width = width;
	rv->img_height = height;

	if ((rows = malloc(sizeof (rows[0]) * height)) == NULL) {
		perror("malloc");
		free(rv);
		(void) fclose(fp);
		return (NULL);
	}

	assert(png_get_rowbytes(png, pnginfo) == sizeof (img_pixel_t) * width);

	for (i = 0; i < height; i++)
		rows[i] = (png_bytep)&rv->img_pixels[img_coord(rv, 0, i)];

	png_read_image(png, rows);
	png_read_end(png, NULL); /* XXX so we don't have to call fclose() */
	(void) fclose(fp);
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

inline unsigned int
img_coord(img_t *image, unsigned int x, unsigned int y)
{
	assert(x < image->img_width);
	assert(y < image->img_height);
	return (x + image->img_width * y);
}
