#!/bin/bash

#
# extract-frames.sh: given a bunch of video files and starting offsets, extract
# a few seconds' worth of frames from each one.  This is used to generate a test
# set of data.
#

shopt -s xpg_echo

ef_base="$HOME/Desktop/Kart Captures"
ef_nsecs=3

#
# The information for these tables was collected manually.  Each entry in the
# following three arrays corresponds to a race starting frame, identified by the
# video file name (in ef_videos), the number of seconds into the video
# (identified by ef_starts), and the number of frames *after that point* where
# the starting frame occurs.
#
declare -a ef_videos
declare -a ef_starts
declare -a ef_framei

ef_videos[0]="2012-05-15/1.mov"
ef_starts[0]=30
ef_framei[0]=053
ef_videos[1]="2012-05-15/1.mov"
ef_starts[1]=200
ef_framei[1]=075
ef_videos[2]="2012-05-15/1.mov"
ef_starts[2]=351
ef_framei[2]=061
ef_videos[3]="2012-05-15/2.mov"
ef_starts[3]=8
ef_framei[3]=069
ef_videos[4]="2012-05-15/3.mov"
ef_starts[4]=16
ef_framei[4]=056
ef_videos[5]="2012-05-15/3.mov"
ef_starts[5]=176
ef_framei[5]=041
ef_videos[6]="2012-05-15/4.mov"
ef_starts[6]=8
ef_framei[6]=058
ef_videos[7]="2012-05-15/4.mov"
ef_starts[7]=193
ef_framei[7]=066
ef_videos[8]="2012-05-15/5.mov"
ef_starts[8]=12
ef_framei[8]=049

ef_videos[9]="2012-06-19/Recording_0000.mov"
ef_starts[9]=8
ef_framei[9]=021
ef_videos[10]="2012-06-19/Recording_0002.mov"
ef_starts[10]=7
ef_framei[10]=026
ef_videos[11]="2012-06-19/Recording_0003.mov"
ef_starts[11]=7
ef_framei[11]=051
ef_videos[12]="2012-06-19/Recording_0004.mov"
ef_starts[12]=7
ef_framei[12]=024
ef_videos[13]="2012-06-19/Recording_0005.mov"
ef_starts[13]=14
ef_framei[13]=029
ef_videos[14]="2012-06-19/Recording_0006.mov"
ef_starts[14]=7
ef_framei[14]=045
ef_videos[15]="2012-06-19/Recording_0007.mov"
ef_starts[15]=3
ef_framei[15]=037
ef_videos[16]="2012-06-19/Recording_0008.mov"
ef_starts[16]=8
ef_framei[16]=074
ef_videos[17]="2012-06-19/Recording_0009.mov"
ef_starts[17]=7
ef_framei[17]=026
ef_videos[18]="2012-06-19/Recording_0010.mov"
ef_starts[18]=9
ef_framei[18]=042

for (( i = 0; i < ${#ef_videos[*]}; i++ )) {
	file="${ef_videos[$i]}"
	start=${ef_starts[$i]}
	tmpdir="frames_$(basename $file)_$start"

	if [[ -d "$tmpdir" ]]; then
		echo "Skipping $file@${ef_starts[$i]} (already exists)."
		continue
	fi

	echo "Extracting $file@${ef_starts[$i]} to $tmpdir ... \c "
	mkdir -p "$tmpdir"
	ffmpeg -ss ${ef_starts[$i]} -i "$ef_base/$file" -t $ef_nsecs \
	    "$tmpdir/$tmpdir%03d.png" > $tmpdir/ffmpeg.out 2>&1
	echo "done."

	cp "$tmpdir/$tmpdir${ef_framei[$i]}.png" \
	    frames/start_$(basename $file).$start.png
}
