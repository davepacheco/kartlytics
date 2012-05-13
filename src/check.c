#include <assert.h>
#include <math.h>
#include <errno.h>
#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <sys/types.h>

typedef struct ppm {
	unsigned int	ppm_width;
	unsigned int	ppm_height;
	uint8_t	*ppm_pixels;
} ppm_file_t;

static ppm_file_t *ppm_read(const char *);
static void ppm_free(ppm_file_t *);
inline unsigned int ppm_coord(ppm_file_t *, unsigned int, unsigned int);
static double ppm_compare(ppm_file_t *, ppm_file_t *);

int
main(int argc, char *argv[])
{
	ppm_file_t *image, *mask;

	if (argc < 3) {
		(void) fprintf(stderr, "usage: %s file mask\n", argv[0]);
		return (2);
	}

	if ((image = ppm_read(argv[1])) == NULL ||
	    (mask = ppm_read(argv[2])) == NULL) {
		ppm_free(image);
		return (1);
	}

	if (image->ppm_width != mask->ppm_width ||
	    image->ppm_height != mask->ppm_height) {
		(void) fprintf(stderr, "error: images are different sizes\n");
		ppm_free(image);
		ppm_free(mask);
		return (1);
	}

	(void) ppm_compare(image, mask);

	return (0);
}

static ppm_file_t *
ppm_read(const char *filename)
{
	FILE *fp;
	int nread;
	ppm_file_t *rv = NULL;
	char buf[64];

	if ((fp = fopen(filename, "r")) == NULL) {
		(void) fprintf(stderr, "ppm_read %s: %s\n",
		    filename, strerror(errno));
		return (NULL);
	}

	if (fgets(buf, sizeof (buf), fp) == NULL) {
		if (feof(fp)) {
			(void) fprintf(stderr,
			    "ppm_read %s: truncated header\n", filename);
			(void) fclose(fp);
			return (NULL);
		}

		assert(ferror(fp));
		(void) fprintf(stderr, "ppm_read %s: error reading header\n",
		    filename);
		(void) fclose(fp);
		return (NULL);
	}

	if (strcmp(buf, "P6\n") != 0) {
		(void) fprintf(stderr, "ppm_read %s: unsupported file type\n",
		    filename);
		(void) fclose(fp);
		return (NULL);
	}

	if ((rv = calloc(1, sizeof (*rv))) == NULL) {
		perror("malloc");
		(void) fclose(fp);
		return (NULL);
	}

	nread = fscanf(fp, "%u %u %*u", &rv->ppm_width, &rv->ppm_height);
	if (nread != 2) {
		(void) fprintf(stderr, "ppm_read %s: invalid dimensions (%d)\n",
		    filename, nread);
		(void) fclose(fp);
		ppm_free(rv);
		return (NULL);
	}

	/*
	 * We used to have a \n in the above fscanf format string, but that eats
	 * *all* subsequent whitespace, including white space character values
	 * in the actual data.  So we eat 1 newline here.
	 */
	if (fread(buf, 1, 1, fp) != 1 || buf[0] != '\n') {
		(void) fprintf(stderr, "ppm_read %s: failed to read header "
		    "terminator", filename);
		(void) fclose(fp);
		ppm_free(rv);
		return (NULL);
	}

	rv->ppm_pixels = malloc(3 * rv->ppm_width * rv->ppm_height);
	if (rv->ppm_pixels == NULL) {
		perror("malloc");
		(void) fclose(fp);
		ppm_free(rv);
		return (NULL);
	}

	/* XXX */
	nread = fread(rv->ppm_pixels, 3 * rv->ppm_width, rv->ppm_height, fp);
	if (nread != rv->ppm_height) {
		(void) fprintf(stderr, "ppm_read %s: unexpected end of file"
		    " (read %d objects, expected %d)\n", filename, nread,
		    rv->ppm_height);
		if (feof(fp))
			(void) fprintf(stderr, "at EOF\n");
		else if (ferror(fp))
			(void) fprintf(stderr, "got error\n");
		(void) fclose(fp);
		ppm_free(rv);
		return (NULL);
	}

	(void) fclose(fp);
	return (rv);
}

static void
ppm_free(ppm_file_t *ppm)
{
	if (ppm == NULL)
		return;
	
	free(ppm->ppm_pixels);
	free(ppm);
}

static double
ppm_compare(ppm_file_t *image, ppm_file_t *mask)
{
	unsigned int x, y, i;
	unsigned int dr, dg, db, dz2;
	unsigned int npixels;
	unsigned int nignored = 0, ndifferent = 0;
	double sum = 0;
	double score;

	assert(image->ppm_width == mask->ppm_width);
	assert(image->ppm_height == mask->ppm_height);

	for (y = 0; y < image->ppm_height; y++) {
		for (x = 0; x < image->ppm_width; x++) {
			i = ppm_coord(image, x, y);

			/*
			 * Ignore nearly-black pixels in the mask.
			 */
			if (mask->ppm_pixels[i] < 2 &&
			    mask->ppm_pixels[i + 1] < 2 &&
			    mask->ppm_pixels[i + 2] < 2) {
				nignored++;
				continue;
			}

			dr = mask->ppm_pixels[i] - image->ppm_pixels[i];
			dg = mask->ppm_pixels[i + 1] - image->ppm_pixels[i + 1];
			db = mask->ppm_pixels[i + 2] - image->ppm_pixels[i + 2];
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
	npixels = image->ppm_height * image->ppm_width;
	score = (sum / sqrt(255 * 255 * 3)) / (npixels - nignored);
	(void) printf("total pixels:     %d\n", npixels);
	(void) printf("ignored pixels:   %d\n", nignored);
	(void) printf("compared pixels:  %d\n", npixels - nignored);
	(void) printf("different pixels: %d\n", ndifferent);
	(void) printf("difference score: %f\n", score);

	return (score);
}

inline unsigned int
ppm_coord(ppm_file_t *image, unsigned int x, unsigned int y)
{
	assert(x < image->ppm_width);
	assert(y < image->ppm_height);
	return (3 * (x + image->ppm_width * y));
}
