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
usage: $arg0 [-mT] [-b BIN_DIRECTORY] [-d VIDEO_DIRECTORY] 
             [-t TARBALL] OUTPUT_DIRECTORY

Runs the main kartlytics pipeline on all videos in VIDEO_DIRECTORY, placing the
results into OUTPUT_DIRECTORY.  BIN_DIRECTORY is used to hold the assets.  The
actual kartlytics code is run from TARBALL.

VIDEO_DIRECTORY, OUTPUT_DIRECTORY, BIN_DIRECTORY, and TARBALL are Manta paths.
The Manta tools (mjob, mput, and related tools) must be installed and on your
path.  See http://apidocs.joyent.com/manta/#getting-started for details.

In order to use the public build and dataset, just leave off everything except
for OUTPUT_DIRECTORY:

    BIN_DIRECTORY   defaults to $ra_binroot
    VIDEO_DIRECTORY defaults to $ra_vidroot
    TARBALL         defaults to $ra_tarball

With -m, also generates webm clips of each race.  (This is by far the most
time-consuming part.)

With -T, skips processing the raw videos, assuming the raw transcripts have
already been created.

With -u, uploads job assets to BIN_DIRECTORY before starting.  You must have
write access to this directory.
EOF
	exit 2
}

ra_tarball="/dap/public/kartlytics/kartlytics.tgz"
ra_binroot="/dap/public/kartlytics/bin"
ra_vidroot="/dap/public/kartlytics/videos"
ra_outdir=""
ra_dowebm=false
ra_doupload=false
ra_dotranscribe="true"

while getopts ":b:d:Mt:Tu" c "$@"; do
	case "$c" in
	b)	ra_binroot="$OPTARG" ;;
	d)	ra_vidroot="$OPTARG" ;;
	m)	ra_dowebm="true"    ;;
	t)	ra_tarball="$OPTARG" ;;
	T)	ra_dotranscribe="false" ;;
	u)	ra_doupload="true"   ;;
	:)	usage "option requires an argument -- $OPTARG"	;;
	*)	usage "invalid option: $OPTARG"	;;
	esac
done

shift $((OPTIND - 1))
[[ $# -eq 1 ]] || usage "output directory must be specified"
ra_outdir="$1"

type mjob > /dev/null 2>&1 || \
    usage "\"mjob\" not found on PATH (are the Manta tools installed?)"

set -o pipefail

ra_jobbasedir="$(dirname $0)/../jobs"

if [[ $ra_doupload == "true" ]]; then
	echo "Uploading assets: "
	mmkdir -p "$ra_binroot" || fail "failed to mmkdir \"$ra_binroot\""
	for file in $(ls -1 "$ra_jobbasedir"); do
		mput -f "$ra_jobbasedir/$file" "$ra_binroot/$file" || \
		    fail "failed to upload"
	done
fi

if [[ $ra_dotranscribe == "true" ]]; then
	echo "Running job to process videos:"
	echo -n | mjob create -w \
	    -s $ra_binroot/find-videos \
	    -r "/assets$ra_binroot/find-videos \"$ra_vidroot\" | xargs mcat" \
	    -s $ra_binroot/video-transcribe \
	    -s $ra_tarball \
	    --init "cd /var/tmp && tar xzf /assets$ra_tarball" \
	    -m "/assets$ra_binroot/video-transcribe /var/tmp/kartlytics \"$ra_outdir\" "'$MANTA_INPUT_FILE' || \
	    fail "failed to process videos"
fi

if [[ $ra_dowebm == "true" ]]; then
	echo "Running job to generate webms:"
	echo -n | mjob create -w \
	    -s $ra_binroot/find-videos \
	    -r "/assets$ra_binroot/find-videos \"$ra_vidroot\" | xargs mcat" \
	    -s $ra_binroot/video-webm \
	    -m "/assets$ra_binroot/video-webm \"$ra_outdir\" "'$MANTA_INPUT_FILE' || \
	    fail "failed to generate webms"
fi

echo "Running job to process video transcripts:"
echo -n | mjob create -w \
    -s $ra_binroot/find-transcripts \
    -r "/assets$ra_binroot/find-transcripts \"$ra_outdir\" | xargs mcat" \
    -s $ra_binroot/video-races \
    -s $ra_tarball \
    --init "cd /var/tmp && tar xzf /assets$ra_tarball" \
    -m "/assets$ra_binroot/video-races /var/tmp/kartlytics "'$MANTA_INPUT_FILE $MANTA_INPUT_OBJECT' || \
    fail "failed to process transcript"

echo "Running job to aggregate data:"
echo -n | mjob create -w \
    -s $ra_binroot/find-metadata \
    -r "/assets$ra_binroot/find-metadata \"$ra_vidroot\" | xargs mcat" \
    -s $ra_binroot/video-metadata \
    -m "/assets$ra_binroot/video-metadata \"$ra_outdir\" "'$MANTA_INPUT_FILE' \
    -r "json -g | mpipe \"$ra_outdir\"/summary.json" || \
    fail "failed to aggregate data"
