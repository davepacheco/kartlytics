/*
 * img.h: image input/output facilities
 */

#ifndef IMG_H
#define	IMG_H

#include <stdio.h>

#include <png.h>

#include "compat.h"

typedef struct img_pixel {
	uint8_t	r;
	uint8_t g;
	uint8_t b;
} img_pixel_t;

typedef struct img_pixelhsv {
	uint8_t	h;
	uint8_t s;
	uint8_t v;
} img_pixelhsv_t;

typedef struct img {
	unsigned int	img_width;
	unsigned int	img_height;
	unsigned int	img_minx;
	unsigned int	img_maxx;
	unsigned int	img_miny;
	unsigned int	img_maxy;
	img_pixel_t	*img_pixels;
} img_t;

img_t *img_read(const char *);
img_t *img_translatexy(img_t *, long, long);
int img_write(img_t *, const char *);
int img_write_ppm(img_t *, FILE *);
int img_write_png(img_t *, FILE *);
void img_free(img_t *);
#define	img_coord(image, x, y)	((x) + (image)->img_width * (y))
double img_compare(img_t *, img_t *, img_t **);
void img_and(img_t *, img_t *);

void img_pix_rgb2hsv(img_pixelhsv_t *, img_pixel_t *);

#endif
