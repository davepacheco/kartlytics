/*
 * kartvid.js: exports parseKartvid, which parses kartvid output
 */

exports.parseKartvid = parseKartvid;
exports.summarize = summarize;

/*
 * Returns a function that takes individual lines of kartvid output and parses
 * it, storing the results in video.races.
 */
function parseKartvid(video)
{
	var log = video.log;
	var races = video.races = [];
	var i = 0;
	var race, segment, entry;

	return (function (line) {
		++i;

		if (line.length === 0)
			return;

		try {
			entry = JSON.parse(line);
		} catch (ex) {
			log.warn(ex, 'ignoring bad JSON object at line %s', i);
			return;
		}

		if (i == 1 && entry.nframes) {
			video.maxframes = entry.nframes;
			video.crtime = parseDate(entry.crtime);
			return;
		}

		video.frame = entry.frame;

		if (entry.start) {
			if (race !== undefined) {
				log.warn('ignoring race aborted at %s',
				    entry.source);
				segment = undefined;
			}

			race = {
				'start_time': entry.time,
				'mode': trackMode(entry.track),
				'track': trackName(entry.track),
				'players': entry.players,
				'segments': []
			};
			return;
		}

		if (race === undefined) {
			log.warn('ignoring line %d (not in a race)');
			return;
		}

		if (!entry.done) {
			if (segment !== undefined) {
				segment.end = entry.time;
				race['segments'].push(segment);
			}

			segment = {
				'start': entry.time,
				'players': entry.players
			};

			return;
		}

		if (segment !== undefined) {
			segment.end = entry.time;
			race['segments'].push(segment);
			segment = undefined;
		}

		race.end = entry.time;
		race.results = entry.players;
		races.push(race);
		race = undefined;
	});
}

var trackNames = {
    'banshee': 'Banshee Boardwalk',
    'beach': 'Koopa Troopa Beach',
    'bowser': 'Bowser\'s Castle',
    'choco': 'Choco Mountain',
    'desert': 'Kalimari Desert',
    'dk': 'DK\'s Jungle Parkway',
    'frappe': 'Frappe Snowland',
    'luigi': 'Luigi Raceway',
    'mario': 'Mario Raceway',
    'moo': 'Moo Moo Farm',
    'rainbow': 'Rainbow Road',
    'royal': 'Royal Raceway',
    'sherbet': 'Sherbet Land',
    'toad': 'Toad\'s Turnpike',
    'wario': 'Wario Raceway',
    'yoshi': 'Yoshi Valley'
};

function trackName(trackid)
{
	if (trackNames.hasOwnProperty(trackid))
		return (trackNames[trackid]);

	return ('Unknown Track');
}

function trackMode(trackid)
{
	return ('VS');
}

/*
 * The input here is the "creation_time" metadata written by our capture device,
 * which has the from YYYY-MM-DD HH:MM:SS and is written in UTC.  Amazingly,
 * V8's Date.parse() handles this format directly.
 */
function parseDate(when)
{
	if (!when)
		return (when);

	return (Date.parse(when));
}

/*
 * Converts an individual race to an English summary.
 */
function summarize(race)
{
	var entries = [];
	var time = kDuration(race['start_time']);

	entries.push(race['players'].length + 'P ' + race['mode'] + ' on ' +
	    race['track'] + ' (starts at ' + time + ' in video)');

	var players = race['results'].slice(0);
	players.sort(function (p1, p2) {
		return (p1['position'] - p2['position']);
	});

	entries.push('    Final results:');
	players.forEach(function (p, i) {
		entries.push('        ' + ordinal(i + 1) + ' ' +
		    ucfirst(p['character']));
	});

	return (entries);
}

/* XXX copied/pasted from www/resources/js/kart.js */
function kDuration(ms, showmillis)
{
	var hour, min, sec, rv;

	/* compute totals in each unit */
	sec = Math.floor(ms / 1000);
	min = Math.floor(sec / 60);
	hour = Math.floor(min / 60);

	/* compute offsets for each unit */
	ms %= 1000;
	sec %= 60;
	min %= 60;

	rv = '';
	if (hour > 0)
		rv += hour + ':';

	if (hour > 0 || min > 0) {
		if (hour > 0 && min < 10)
			rv += '0' + min + ':';
		else
			rv += min + ':';
	}

	if ((hour > 0 || min > 0) && sec < 10)
		rv += '0' + sec;
	else
		rv += sec;

	if (!showmillis)
		return (rv + 's');

	if (ms < 10)
		rv += '.00' + ms;
	else if (ms < 100)
		rv += '.0' + ms;
	else
		rv += '.' + ms;

	return (rv);
}

/* XXX ditto */
function ucfirst(str)
{
	return (str[0].toUpperCase() + str.substr(1));
}

/* XXX ditto */
function ordinal(num)
{
	if (num == 1)
		return ('1st');
	if (num == 2)
		return ('2nd');
	if (num == 3)
		return ('3rd');
	if (num == 4)
		return ('4th');

	return (num);
}
