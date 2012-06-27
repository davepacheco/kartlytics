/*
 * img.c: image input/output facilities
 */

#include <assert.h>
#include <ctype.h>
#include <err.h>
#include <errno.h>
#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#include "img.h"

extern int kv_debug;

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

img_t *
img_alloc(unsigned int width, unsigned int height)
{
	img_t *rv;

	rv = calloc(1, sizeof (*rv));
	if (rv == NULL)
		return (NULL);

	rv->img_pixels = calloc(sizeof (rv->img_pixels[0]), width * height);
	if (rv->img_pixels == NULL) {
		free(rv);
		return (NULL);
	}

	rv->img_width = width;
	rv->img_height = height;
	rv->img_maxx = 0;
	rv->img_minx = rv->img_width;
	rv->img_maxy = 0;
	rv->img_miny = rv->img_height;

	return (rv);
}

img_t *
img_read(const char *filename)
{
	FILE *fp;
	img_t *rv;
	int x, y, i;
	img_pixel_t *imagepx;
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

	/*
	 * Compute the bounding box for the image, which is used as an
	 * optimization when operating on masks.
	 */
	for (y = 0; y < rv->img_height; y++) {
		for (x = 0; x < rv->img_width; x++) {
			i = img_coord(rv, x, y);
			imagepx = &rv->img_pixels[i];

			if (imagepx->r < 2 && imagepx->g < 2 && imagepx->b < 2)
				continue;

			if (x < rv->img_minx)
				rv->img_minx = x;
			if (x + 1 > rv->img_maxx)
				rv->img_maxx = x + 1;
			if (y < rv->img_miny)
				rv->img_miny = y;
			if (y + 1 > rv->img_maxy)
				rv->img_maxy = y + 1;
		}
	}

	return (rv);
}

img_t *
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

	if ((rv = img_alloc(width, height)) == NULL) {
		warn("img_read_ppm %s", filename);
		return (NULL);
	}

	/* Skip the single whitespace character that follows the header. */
	(void) fseek(fp, SEEK_CUR, 1);

	nread = fread(rv->img_pixels, sizeof (rv->img_pixels[0]),
	    rv->img_width * rv->img_height, fp);

	if (nread != rv->img_width * rv->img_height) {
		warnx("img_read_ppm %s: %s", filename, stdio_error(fp));
		img_free(rv);
		return (NULL);
	}

	return (rv);
}

int
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

img_t *
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

	if (depth > 8) {
		warnx("img_read_png %s: unsupported bit depth", filename);
		return (NULL);
	}

	if (color_type != PNG_COLOR_TYPE_RGB) {
		warnx("img_read_png %s: unsupported color type", filename);
		return (NULL);
	}

	if ((rv = img_alloc(width, height)) == NULL) {
		warn("img_read_png %s");
		return (NULL);
	}

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

void
img_free(img_t *imgp)
{
	if (imgp == NULL)
		return;
	
	free(imgp->img_pixels);
	free(imgp);
}

double
img_compare(img_t *image, img_t *mask, img_t **dbgmask)
{
	unsigned int x, y, i;
	unsigned int dr, dg, db, dz2;
	unsigned int npixels;
	unsigned int ncompared = 0, nignored = 0, ndifferent = 0;
	double sum = 0;
	double score;
	img_pixel_t *imgpx, *maskpx, *dbgpx;

	if (dbgmask != NULL)
		*dbgmask = img_alloc(image->img_width, image->img_height);

	assert(image->img_width == mask->img_width);
	assert(image->img_height == mask->img_height);

	for (y = mask->img_miny; y < mask->img_maxy; y++) {
		for (x = mask->img_minx; x < mask->img_maxx; x++) {
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

			ncompared++;
			dr = maskpx->r - imgpx->r;
			dg = maskpx->g - imgpx->g;
			db = maskpx->b - imgpx->b;
			dz2 = dr * dr + dg * dg + db * db;

			if (dz2 == 0)
				continue;

			if (dbgmask != NULL) {
				dbgpx = &((*dbgmask)->img_pixels[i]);
				dbgpx->g = 255 - (sqrt(dz2));
			}

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
	score = (sum / sqrt(255 * 255 * 3)) / ncompared;

	if (kv_debug > 3) {
		(void) printf("total pixels:     %d\n", npixels);
		(void) printf("ignored pixels:   %d\n", nignored);
		(void) printf("compared pixels:  %d\n", ncompared);
		(void) printf("different pixels: %d\n", ndifferent);
		(void) printf("difference score: %f\n", score);
	}

	return (score);
}

void
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

img_t *
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
