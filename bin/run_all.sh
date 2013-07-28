#!/bin/bash

#
# run_all.sh: runs the whole kartlytics pipeline on all videos
#

arg0="$(basename $0)"

function fail
{
	echo "$arg0: $@" >&2
	exit 1
}

function usage
{
	[[ $# -gt 0 ]] && echo "$arg0: $@" >& 2
	cat <<EOF >&2
usage: $arg0 BIN_DIRECTORY VIDEO_DIRECTORY OUTPUT_DIRECTORY

Runs the whole kartlytics pipeline on all videos in VIDEO_DIRECTORY, placing the
results into OUTPUT_DIRECTORY.  BIN_DIRECTORY is used to hold the assets.

You can generate your own results from the public set of videos using:

    $arg0 /$MANTA_USER/stor/kartlytics_bin /dap/public/kartlytics/videos \\
        /$MANTA_USER/stor/kartlytics_out
EOF
	exit 2
}

[[ $# -eq 3 ]] || usage

set -o pipefail

ra_jobbasedir="$(dirname $0)/../jobs"
ra_tarball="/dap/public/kartlytics/kartlytics.tgz"
ra_binroot="$1"

echo "Uploading assets: "
for file in $(ls -1 "$ra_jobbasedir"); do
	mput -f "$ra_jobbasedir/$file" "$1/$file" || fail "failed to upload"
done

echo "Running job to process videos:"
echo -n | mjob create -w \
    -s $ra_binroot/find-videos \
    -r "/assets$ra_binroot/find-videos $2 | xargs mcat" \
    -s $ra_binroot/video-transcribe \
    -s $ra_tarball \
    --init "cd /var/tmp && tar xzf /assets$ra_tarball" \
    -m "/assets$ra_binroot/video-transcribe /var/tmp/kartlytics $3 "'$MANTA_INPUT_FILE' || \
    fail "failed to process videos"

echo "Running job to generate webms:"
echo -n | mjob create -w \
    -s $ra_binroot/find-videos \
    -r "/assets$ra_binroot/find-videos $2 | xargs mcat" \
    -s $ra_binroot/video-webm \
    -m "/assets$ra_binroot/video-webm $3 "'$MANTA_INPUT_FILE' || \
    fail "failed to generate webms"

echo "Running job to aggregate data:"
echo -n | mjob create -w \
    -s $ra_binroot/find-metadata \
    -r "/assets$ra_binroot/find-metadata $2 | xargs mcat" \
    -s $ra_binroot/video-metadata \
    -m "/assets$ra_binroot/video-metadata $3 "'$MANTA_INPUT_FILE' \
    -r "json -g | mpipe $3/summary.json" || fail "failed to aggregate data"
