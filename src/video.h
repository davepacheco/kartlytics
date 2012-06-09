/*
 * video.h: video input/output facilities
 */

#ifndef VIDEO_H
#define	VIDEO_H

#include <stdio.h>

#include <png.h>

#include "compat.h"
#include "img.h"

struct video;
typedef struct video video_t;

typedef struct {
	int 	vf_framenum;
	double	vf_frametime;
	img_t 	vf_image;
} video_frame_t;

typedef int (*frame_iter_t)(video_frame_t *, void *);

video_t *video_open(const char *);
int video_iter_frames(video_t *, frame_iter_t, void *);
double video_framerate(video_t *);
void video_free(video_t *);

#endif
