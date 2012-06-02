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
img_t *img_read_ppm(FILE *, const char *);
img_t *img_read_png(FILE *, const char *);
img_t *img_translatexy(img_t *, long, long);
int img_write_ppm(img_t *, FILE *);
void img_free(img_t *);
inline unsigned int img_coord(img_t *, unsigned int, unsigned int);
double img_compare(img_t *, img_t *);
void img_and(img_t *, img_t *);

#endif
