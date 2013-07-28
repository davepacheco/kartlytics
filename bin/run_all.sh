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
results into OUTPUT_DIRECTORY.
EOF
	exit 2
}

[[ $# -eq 3 ]] || usage

set -o pipefail

ra_jobbasedir="$(dirname $0)/../jobs"
ra_tarball="/dap/public/kartlytics/kartlytics.tgz"

echo "Uploading assets: "
for file in $(ls -1 "$ra_jobbasedir"); do
	mput -f "$ra_jobbasedir/$file" "$1/$file" || fail "failed to upload"
done

echo "Running job to process videos:"
echo -n | mjob create -w \
    -s /dap/public/kartlytics/bin/find-videos \
    -r "/assets/dap/public/kartlytics/bin/find-videos $2 | xargs mcat" \
    -s /dap/public/kartlytics/bin/video-transcribe \
    -s /dap/public/kartlytics/kartlytics.tgz \
    --init "cd /var/tmp && tar xzf /assets$ra_tarball" \
    -m "/assets/dap/public/kartlytics/bin/video-transcribe /var/tmp/kartlytics $3 "'$MANTA_INPUT_FILE' || \
    fail "failed to process videos"

echo "Running job to aggregate data:"
echo -n | mjob create -w \
    -s /dap/public/kartlytics/bin/find-metadata \
    -r "/assets/dap/public/kartlytics/bin/find-metadata $2 | xargs mcat" \
    -s /dap/public/kartlytics/bin/video-metadata \
    -m "/assets/dap/public/kartlytics/bin/video-metadata $3 "'$MANTA_INPUT_FILE' \
    -r "json -g | mpipe $3/summary.json" || fail "failed to aggregate data"

echo "Running job to generate webms:"
echo -n | mjob create -w \
    -s /dap/public/kartlytics/bin/find-videos \
    -r "/assets/dap/public/kartlytics/bin/find-videos $2 | xargs mcat" \
    -s /dap/public/kartlytics/bin/video-webm \
    -m "/assets/dap/public/kartlytics/bin/video-webm $3 "'$MANTA_INPUT_FILE' || \
    fail "failed to generate webms"
