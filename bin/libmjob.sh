#
# libmjob.sh: shell functions for creating Manta jobs using a pipeline rather
# than a single "mjob create" invocation.  This is useful when the phases of the
# job vary programmatically.
#
# To use these functions:
#
#     (1) Start with "mjob_init".
#     (2) Pipe its output to any number of calls to:
#
#             mjob_phase	add a "map" or "reduce" phase
#     	      mjob_map		add a "map" phase
#     	      mjob_reduce	add a "reduce" phase
#
#     (3) Pipe that to "mjob_submit", using whatever other arguments you would
#         use for "mjob create" (e.g., --open, -w, -o, and so on).
#
# The job configuration is passed via stdout, so you can save intermediate
# output into a variable.  For example:
#
#     myvar="$(mjob_init | mjob_map wc)"
#     if $do_reduce ; then
#         myvar="$(echo "$myvar" | mjob_reduce wc)"
#     fi
#     jobid=$(echo "$myvar" | mjob_submit)
#
# For simple cases, you can use the g* prefixed versions of these functions,
# which operate globally rather than using state passed between them.  For
# example:
#
#     gmjob_init
#     gmjob_map wc
#     $do_reduce && gmjob_reduce wc
#     jobid=$(gmjob_submit)
#

#
# mjob_init [NAME]: Start a job creation pipeline by emitting a job templatea
#
function mjob_init
{
	if [[ $# -gt 0 ]]; then
		echo '{ "phases": [] }' | json -e "name='$1'"
	else
		echo '{ "phases": [] }'
	fi
}

#
# [private] json_escape STR: escape STR as a JSON string.  This escapes all
# double-quotes and escape characters.
#
function json_escape
{
	local script="$(cat <<-EOF
	var d = "";
	process.stdin.on("data", function (c) {
	    d += c.toString("utf8");
	});
	process.stdin.on("end", function () {
	    console.log(JSON.stringify(d));
	});
	EOF)"
	echo -n "$1" | node -e "$script"
}

#
# mjob_phase map|reduce [-c count] [-d disk] [-i image] [-I init]
#     [-m memory] [-s asset] COMMAND: add a map or reduce phase
#
function mjob_phase
{
	if [[ "$1" != "map" && $1 != "reduce" ]]; then
		echo "bad phase type: '$1'" >&2
		return 1
	fi

	local cmds="p = {}; p.type='$1'; p.assets = [];"
	shift
	OPTIND=1
	while getopts ":c:d:i:I:m:s:" c "$@"; do
		case "$c" in
		c)	cmds="$cmds; p.count=$OPTARG"	;;
		d)	cmds="$cmds; p.disk=$OPTARG"	;;
		i)	cmds="$cmds; p.image='$OPTARG'"	;;
		I)	cmds="$cmds; p.init='$OPTARG'"	;;
		m)	cmds="$cmds; p.memory=$OPTARG"	;;
		s)	cmds="$cmds; p.assets.push('$OPTARG')" ;;
		:)	echo "option requires an argument -- $OPTARG" >&2
			return 1 ;;
		*)	echo "invalid option -- $OPTARG" >&2
			return 1 ;;
		esac
	done
	shift $(( OPTIND - 1 ))
	if [[ $# -eq 0 ]]; then
		echo "missing phase script" >&2
		return 1
	elif [[ $# -gt 1 ]]; then
		echo "extra phase arguments" >&2
		return 1
	fi
	cmds="$cmds; p.exec=$(json_escape "$1")"
	cmds="$cmds; phases.push(p); p = undefined;"

	[[ -t 0 ]] && echo "warning: mjob_phase on a terminal" >&2
	json -e "$cmds"
}

#
# mjob_map PHASE_ARGS: like mjob_phase, but specifically for "map" phases.
#
function mjob_map
{
	mjob_phase map "$@"
}

#
# mjob_reduce PHASE_ARGS: like mjob_phase, but specifically for "reduce" phases.
#
function mjob_reduce
{
	mjob_phase reduce "$@"
}

#
# mjob_submit [MJOB_CREATE_OPTIONS]: submit the job and pass through options to
# "mjob create".
#
function mjob_submit
{
	[[ -t 0 ]] && echo "warning: mjob_submit on a terminal" >&2
	mjob create -f /dev/stdin "$@"
}

#
# The g* versions of these functions have the same parameters as the others, but
# operate on a global variable so that you don't have to worry about piping them
# or keeping track of errors.
#
gmjob_json=
gmjob_error=

function gmjob_init
{
	gmjob_error=
	gmjob_json="$(mjob_init "$@")" || gmjob_error="failed to initialize"
}

function gmjob_map
{
	[[ -n "$gmjob_error" ]] && return 1
	gmjob_json="$(echo "$gmjob_json" | mjob_map "$@")" || \
	    gmjob_error="failed to add map phase"
}

function gmjob_reduce
{
	[[ -n "$gmjob_error" ]] && return 1
	gmjob_json="$(echo "$gmjob_json" | mjob_reduce "$@")" || \
	    gmjob_error="failed to add map phase"
}

function gmjob_submit
{
	[[ -n "$gmjob_error" ]] && return 1
	echo "$gmjob_json" | mjob_submit "$@"
}
