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
    $(CHARS:%=assets/masks/char_%_4zout.png)	\
    assets/masks/pos1_square2_final.png		\
    assets/masks/pos1_square3_final.png		\
    assets/masks/pos1_square4_final.png		\
    assets/masks/pos2_square2_final.png		\
    assets/masks/pos2_square3_final.png		\
    assets/masks/pos2_square4_final.png		\
    assets/masks/pos3_square2_final.png		\
    assets/masks/pos3_square3_final.png		\
    assets/masks/pos3_square4_final.png

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

#
# Development targets
#
xref:
	find src -type f > cscope.files
	cscope -bqR

clean:
	-rm -rf $(CLEANFILES)
