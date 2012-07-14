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
				'start_source': entry.source,
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
				'players': entry.players,
				'source': entry['source']
			};

			return;
		}

		if (segment !== undefined) {
			segment.end = entry.time;
			race['segments'].push(segment);
			segment = undefined;
		}

		race.end = entry.time;
		race.end_source = entry.source;
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
	var players = race['results'].slice(0);
	var last, seg;

	entries.push(race['players'].length + 'P ' + race['mode'] + ' on ' +
	    race['track'] + ' (starts at ' + time + ' in video)');
	entries.push('    Racers: ' + players.map(
	    function (p) { return (ucfirst(p['character'])); }).join(', '));

	if (race['segments'].length > 0) {
		seg = race['segments'][0];

		seg.players.forEach(function (p) {
			entries.push('    ' + kDuration(seg['start']) + ': ' +
			    ucfirst(p['character']) + ' is in ' +
			    ordinal(p['position']));
		});

		last = seg;

		race['segments'].slice(1).forEach(function (segment) {
			compareSegments(race, last, segment, function (text) {
				entries.push('    ' + kDuration(
				    segment['start']) + ': ' + text);
			});

			last = segment;
		});
	}

	entries.push('    ' + kDuration(race['end']) + ': The race is over.');

	players.sort(function (p1, p2) {
		return (p1['position'] - p2['position']);
	});

	entries.push('    Result: ' + players.map(
	    function (p) { return (ucfirst(p['character'])); }).join(', '));

	return (entries);
}

/* XXX this is closely duplicated in the web code */
function compareSegments(race, last, next, emit)
{
	var cn, lp, np;
	var i, j, inr, ilr, jnr, jlr;

	cn = race['players'].map(
	    function (p) { return (ucfirst(p['character'])); });
	lp = last['players'];
	np = next['players'];

	for (i = 0; i < np.length; i++) {
		inr = np[i]['position'];
		ilr = lp[i]['position'];

		if (!inr || !ilr)
			continue;

		for (j = i + 1; j < np.length; j++) {
			jnr = np[j]['position'];
			jlr = lp[j]['position'];

			if (!jnr || !jlr)
				continue;

			if (inr < jnr && ilr > jlr) {
				emit(cn[i] + ' passes ' + cn[j]);
			} else if (inr > jnr && ilr < jlr) {
				emit(cn[j] + ' passes ' + cn[i]);
			}
		}
	}

	for (i = 0; i < np.length; i++) {
		if (np[i]['lap'] == 4 && np[i]['lap'] != lp[i]['lap'])
			emit(cn[i] + ' finishes');
	}
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
