#
# kartvid configuration
#
BUILDOS=$(shell uname -s)
CC = gcc
CFLAGS = -Wall -O -fno-omit-frame-pointer

ifeq ($(BUILDOS),Darwin)
	LIBPNG_CPPFLAGS = -I/usr/X11/include 
	LIBPNG_LDFLAGS  = -L/usr/X11/lib -lpng
else
	LIBPNG_CPPFLAGS = -I/opt/local/include
	LIBPNG_LDFLAGS  = -L/opt/local/lib -lpng15
endif

ifeq ($(BUILDOS),SunOS)
	LDFLAGS += -lm
endif

FFMPEG_CPPFLAGS = -I/usr/local/include 
FFMPEG_CPPFLAGS += -Wno-deprecated-declarations
FFMPEG_LDFLAGS  = -L/usr/local/lib -R/usr/local/lib
FFMPEG_LDFLAGS  += -lavformat -lavcodec -lavutil -lswscale

KARTVID = out/kartvid
KART = js/kart.js
CSCOPE_DIRS += src
CLEAN_FILES += $(KARTVID)
CLEAN_FILES += out/kartvid.o out/img.o out/kv.o out/video.o
CLEAN_FILES += cscope.files cscope.out cscope.in.out cscope.po.out


#
# mask configuration
#
CHARS = mario luigi peach toad yoshi wario dk bowser
# Some of the tracks were manually generated from the char_* sources.
# The rest are automatically built here.
GENTRACKS = banshee bowser dk luigi rainbow toad wario yoshi
MASKS_GENERATED = \
    $(CHARS:%=assets/masks/char_%_2.png)	\
    $(CHARS:%=assets/masks/char_%_2zout.png)	\
    $(CHARS:%=assets/masks/char_%_3.png)	\
    $(CHARS:%=assets/masks/char_%_3zout.png)	\
    $(CHARS:%=assets/masks/char_%_4.png)	\
    $(CHARS:%=assets/masks/char_%_4zout.png)	\
    assets/masks/pos1_square2_final.png		\
    assets/masks/pos1_square3_final.png		\
    assets/masks/pos1_square4_final.png		\
    assets/masks/pos2_square2_final.png		\
    assets/masks/pos2_square3_final.png		\
    assets/masks/pos2_square4_final.png		\
    assets/masks/pos3_square2_final.png		\
    assets/masks/pos3_square3_final.png		\
    assets/masks/pos3_square4_final.png		\
    $(GENTRACKS:%=assets/masks/track_%.png)	\
    $(GENTRACKS:%=assets/masks/track_%_zout.png)

CLEAN_FILES += $(MASKS_GENERATED)


#
# Node configuration
#
NPM = npm
NODE_MODULES = node_modules
CLEAN_FILES += $(NODE_MODULES)

JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_CONF_WEB	 = tools/jsl.web.conf
JSL_FILES_NODE  := $(shell find js test -name '*.js')
JSL_FILES_WEB   := $(shell find www/resources/js -name '*.js')
JSSTYLE_FILES	:= $(JSL_FILES_NODE) $(JSL_FILES_WEB)
CSCOPE_DIRS 	+= js www


#
# "all" builds kartvid, then each of the masks
#
all: $(KARTVID) $(MASKS_GENERATED) $(NODE_MODULES)

clean-kartvid:
	-rm -f $(KARTVID)

clean-masks:
	-rm -f $(MASKS_GENERATED)

out:
	mkdir $@

#
# kartvid targets
#
out/%.o: src/%.c | out
	$(CC) -c -o $@ $(CFLAGS) $(CPPFLAGS) $(LIBPNG_CPPFLAGS) \
	    $(FFMPEG_CPPFLAGS) $^

$(KARTVID): out/kartvid.o out/img.o out/kv.o out/video.o | out
	$(CC) -o $@ $(LDFLAGS) $(LIBPNG_LDFLAGS) $(FFMPEG_LDFLAGS) $^

#
# mask targets
#
%.png: %.ppm
	convert -define png:preserve-colormap $^ $@

#
# Masks for characters in squares 2, 3, and 4 are generated from the mask for
# square 1 using known offsets.  See assets/masks/offsets.txt.
#
KVCHAR1TO2 = $(KARTVID) translatexy $^ $@ 323 0
KVCHAR1TO3 = $(KARTVID) translatexy $^ $@ 0   240
KVCHAR1TO4 = $(KARTVID) translatexy $^ $@ 323 240

assets/masks/char_%_2.ppm: assets/masks/char_%_1.png
	$(KVCHAR1TO2)

assets/masks/char_%_2zout.ppm: assets/masks/char_%_1zout.png
	$(KVCHAR1TO2)

assets/masks/char_%_3.ppm: assets/masks/char_%_1.png
	$(KVCHAR1TO3)

assets/masks/char_%_3zout.ppm: assets/masks/char_%_1zout.png
	$(KVCHAR1TO3)

assets/masks/char_%_4.ppm: assets/masks/char_%_1.png
	$(KVCHAR1TO4)

assets/masks/char_%_4zout.ppm: assets/masks/char_%_1zout.png
	$(KVCHAR1TO4)

assets/masks/track_%.ppm: assets/mask_sources/track_%.png
	$(KARTVID) and $^ assets/masks/gen_track.png $@

assets/masks/track_%_zout.ppm: assets/mask_sources/track_%_zoomout.png
	$(KARTVID) and $^ assets/masks/gen_track_zout.png $@

#
# Masks for final position numbers in each square are also generated from square
# 1, but with different offsets.
#
KVFPOS1TO2 = $(KARTVID) translatexy $^ $@ 460 0
KVFPOS1TO3 = $(KARTVID) translatexy $^ $@ 0   220
KVFPOS1TO4 = $(KARTVID) translatexy $^ $@ 460 220

assets/masks/pos%_square2_final.ppm: assets/masks/pos%_square1_final.png
	$(KVFPOS1TO2)

assets/masks/pos%_square3_final.ppm: assets/masks/pos%_square1_final.png
	$(KVFPOS1TO3)

assets/masks/pos%_square4_final.ppm: assets/masks/pos%_square1_final.png
	$(KVFPOS1TO4)

include ./Makefile.deps
include ./Makefile.targ

#
# Node-related targets
#
$(NODE_MODULES): package.json
	$(NPM) install

#
# Testing targets
#
TEST_ROOT	 = $(error TEST_ROOT must be defined in Makefile.conf)
TEST_OUTROOT     = test-outputs
TEST_VIDEOS	 = $(wildcard $(TEST_ROOT)/*.mov)
TEST_VIDEOS_REL  = $(subst $(TEST_ROOT)/,,$(TEST_VIDEOS))
TEST_OUTPUTS     = $(TEST_VIDEOS_REL:%.mov=$(TEST_OUTROOT)/%.json)
TEXT_OUTPUTS	 = $(TEST_OUTPUTS:%.json=%.txt)

include Makefile.conf

.PHONY: test
test: $(TEST_OUTPUTS) $(TEXT_OUTPUTS)

$(TEST_OUTPUTS): $(TEST_OUTROOT)/%.json: $(TEST_ROOT)/%.mov all
	$(KARTVID) video -j $< > $@ 2>$(TEST_OUTROOT)/$*.err

$(TEXT_OUTPUTS): $(TEST_OUTROOT)/%.txt: $(TEST_OUTROOT)/%.json
	$(KART) < $< > $@
