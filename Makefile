#
# kartvid configuration
#
CC = gcc
CFLAGS = -Wall -Werror -O -fno-omit-frame-pointer
LIBPNG_CPPFLAGS = -I/usr/X11/include
LIBPNG_LDFLAGS  = -L/usr/X11/lib -lpng
KARTVID = out/kartvid
CLEANFILES += $(KARTVID)
CLEANFILES += out/kartvid.o out/img.o out/kv.o
CLEANFILES += cscope.files cscope.out cscope.in.out cscope.po.out

#
# mask configuration
#
CHARS = mario luigi peach toad yoshi wario dk bowser
MASKS_GENERATED = \
    $(CHARS:%=assets/masks/char_%_2.png)	\
    $(CHARS:%=assets/masks/char_%_2zout.png)	\
    $(CHARS:%=assets/masks/char_%_3.png)	\
    $(CHARS:%=assets/masks/char_%_3zout.png)	\
    $(CHARS:%=assets/masks/char_%_4.png)	\
    $(CHARS:%=assets/masks/char_%_4zout.png)
CLEANFILES += $(MASKS_GENERATED)

#
# "all" builds kartvid, then each of the masks
#
all: $(KARTVID) $(MASKS_GENERATED)

out:
	mkdir $@

#
# kartvid targets
#
out/%.o: src/%.c | out
	$(CC) -c -o $@ $(CPPFLAGS) $(LIBPNG_CPPFLAGS) $(CFLAGS) $^

$(KARTVID): out/kartvid.o out/img.o out/kv.o | out
	$(CC) -o $@ $(LIBPNG_LDFLAGS) $^

#
# mask targets
#
%.png: %.ppm
	convert $^ $@

#
# Masks for characters in squares 2, 3, and 4 are generated from the mask for
# square 1 using known offsets.  See assets/masks/offsets.txt.
#
KV1TO2 = $(KARTVID) translatexy $^ $@ 323 0
KV1TO3 = $(KARTVID) translatexy $^ $@ 0   240
KV1TO4 = $(KARTVID) translatexy $^ $@ 323 240

assets/masks/char_%_2.ppm: assets/masks/char_%_1.png
	$(KV1TO2)

assets/masks/char_%_2zout.ppm: assets/masks/char_%_1zout.png
	$(KV1TO2)

assets/masks/char_%_3.ppm: assets/masks/char_%_1.png
	$(KV1TO3)

assets/masks/char_%_3zout.ppm: assets/masks/char_%_1zout.png
	$(KV1TO3)

assets/masks/char_%_4.ppm: assets/masks/char_%_1.png
	$(KV1TO4)

assets/masks/char_%_4zout.ppm: assets/masks/char_%_1zout.png
	$(KV1TO4)

#
# Development targets
#
xref:
	find src -type f > cscope.files
	cscope -bqR

clean:
	-rm -rf $(CLEANFILES)
