/*
 * video.c: video input/output facilities
 */

#include <err.h>

#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libswscale/swscale.h>

#include "img.h"
#include "video.h"

struct video {
	AVFormatContext	*vf_formatctx;
	AVCodecContext	*vf_codecctx;
	AVCodec		*vf_codec;
	AVFrame		*vf_frame;
	AVFrame		*vf_framergb;
	uint8_t		*vf_buffer;
	int		vf_stream;
	double		vf_framerate;
	int64_t		vf_nframes;
};

video_t *
video_open(const char *filename)
{
	int i, nbytes;
	video_t *rv;

	if ((rv = calloc(1, sizeof (*rv))) == NULL) {
		warn("malloc");
		return (NULL);
	}

	av_register_all();

	if (av_open_input_file(&rv->vf_formatctx, filename,
	    NULL, 0, NULL) != 0) {
		free(rv);
		return (NULL);
	}

	if (av_find_stream_info(rv->vf_formatctx) < 0) {
		/* XXX */
		warnx("failed to read stream info");
		free(rv);
		return (NULL);
	}

	rv->vf_stream = -1;
	for (i = 0; i < rv->vf_formatctx->nb_streams; i++) {
		if (rv->vf_formatctx->streams[i]->codec->codec_type ==
		    AVMEDIA_TYPE_VIDEO)
			break;
	}

	if (i == rv->vf_formatctx->nb_streams) {
		/* XXX */
		warnx("no video stream found");
		free(rv);
		return (NULL);
	}

	rv->vf_stream = i;
	rv->vf_codecctx = rv->vf_formatctx->streams[i]->codec;

	rv->vf_codec = avcodec_find_decoder(rv->vf_codecctx->codec_id);
	if (rv->vf_codec == NULL) {
		/* XXX */
		warnx("no decoder found for video codec");
		free(rv);
		return (NULL);
	}

	if (avcodec_open(rv->vf_codecctx, rv->vf_codec) < 0) {
		warnx("failed to open video codec");
		free(rv);
		return (NULL);
	}

	rv->vf_framerate = av_q2d(rv->vf_formatctx->streams[i]->time_base);
	rv->vf_nframes = rv->vf_formatctx->streams[i]->nb_frames;

	rv->vf_frame = avcodec_alloc_frame();
	rv->vf_framergb = avcodec_alloc_frame();
	if (rv->vf_frame == NULL || rv->vf_framergb == NULL) {
		warnx("failed to allocate video frames");
		/* XXX */
		free(rv);
		return (NULL);
	}

	nbytes = avpicture_get_size(PIX_FMT_RGB24, rv->vf_codecctx->width,
	    rv->vf_codecctx->height);
	rv->vf_buffer = malloc(nbytes);

	if (rv->vf_buffer == NULL) {
		warnx("failed to allocate video buffer");
		/* XXX */
		free(rv);
		return (NULL);
	}

	avpicture_fill((AVPicture *)rv->vf_framergb, rv->vf_buffer,
	    PIX_FMT_RGB24, rv->vf_codecctx->width, rv->vf_codecctx->height);
	return (rv);
}

double
video_framerate(video_t *vp)
{
	return (vp->vf_framerate);
}

int64_t
video_nframes(video_t *vp)
{
	return (vp->vf_nframes);
}

int
video_iter_frames(video_t *vp, frame_iter_t func, void *arg)
{
	AVPacket avp;
	AVFrame *fp;
	int p, x, y;
	int width, height, rv, done;
	img_pixel_t *pxp;
	video_frame_t frame;
	struct SwsContext *swsctx;

	fp = vp->vf_framergb;
	width = vp->vf_codecctx->width;
	height = vp->vf_codecctx->height;

	swsctx = sws_getContext(width, height, vp->vf_codecctx->pix_fmt,
	    width, height, PIX_FMT_RGB24, SWS_BICUBIC, NULL, NULL, NULL);

	if (swsctx == NULL) {
		warnx("failed to initialize conversion context");
		return (-1);
	}

	rv = 0;
	frame.vf_framenum = 0;
	frame.vf_frametime = 0;
	frame.vf_image.img_width = width;
	frame.vf_image.img_height = height;
	frame.vf_image.img_minx = 0;
	frame.vf_image.img_maxx = width;
	frame.vf_image.img_miny = 0;
	frame.vf_image.img_maxy = height;
	frame.vf_image.img_pixels = calloc(
	    sizeof (frame.vf_image.img_pixels[0]), width * height);

	if (frame.vf_image.img_pixels == NULL) {
		warnx("failed to allocate image buffer");
		return (-1);
	}

	while (av_read_frame(vp->vf_formatctx, &avp) >= 0) {
		if (avp.stream_index != vp->vf_stream) {
			av_free_packet(&avp);
			continue;
		}

		avcodec_decode_video2(vp->vf_codecctx, vp->vf_frame,
		    &done, &avp);

		if (!done) {
			av_free_packet(&avp);
			continue;
		}

		(void) sws_scale(swsctx, vp->vf_frame->data,
		    vp->vf_frame->linesize, 0, height, vp->vf_framergb->data,
		    vp->vf_framergb->linesize);

		for (y = 0; y < height; y++) {
			for (x = 0; x < width; x++) {
				p = img_coord(&frame.vf_image, x, y);
				pxp = &frame.vf_image.img_pixels[p];
				bcopy(fp->data[0] + y * fp->linesize[0] + x *3,
				    pxp, sizeof (*pxp));
			}
		}

		frame.vf_framenum++;
		frame.vf_frametime = vp->vf_framerate * avp.pts * MILLISEC;
		rv = func(&frame, arg);
		av_free_packet(&avp);

		if (rv != 0)
			break;
	}

	return (rv);
}

void
video_free(video_t *vp)
{
	free(vp->vf_buffer);
	av_free(vp->vf_framergb);
	av_free(vp->vf_frame);
	avcodec_close(vp->vf_codecctx);
	av_close_input_file(vp->vf_formatctx);
}
