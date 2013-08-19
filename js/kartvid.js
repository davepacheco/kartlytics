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
	var itemstates;
	var lastp;

	return (function (line) {
		var k;

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
				'vstart': entry.time,
				'vend': undefined,
				'mode': trackMode(entry.track),
				'track': trackName(entry.track),
				'players': entry.players,
				'start_source': entry.source,
				'itemstates': [],
				'segments': []
			};
			itemstates = new Array(entry.players.length);
			lastp = null;
			for (k = 0; k < entry.players.length; k++)
				race['itemstates'].push([]);
			return;
		}

		if (race === undefined) {
			log.warn('ignoring line %d (not in a race)');
			return;
		}

		entry.players.forEach(function (p, j) {
			if (p['itemstate'] == 'slotmachine') {
				if (itemstates[j])
					return;
				itemstates[j] = {
				    'r0': p['position'],
				    'v0': entry.time,
				    's0': entry.source
				};
			} else if (p['itemstate']) {
				if (!itemstates[j])
					return;

				itemstates[j]['r1'] = p['position'];
				itemstates[j]['v1'] = entry.time;
				itemstates[j]['s1'] = entry.source;
				itemstates[j]['item'] = p['itemstate'];
				race['itemstates'][j].push(itemstates[j]);
				itemstates[j] = null;
			} else if (itemstates[j]) {
				log.warn('p%d: no itemstate after slotmachine',
				    j + 1);
				itemstates[j] = null;
			}
		});

		for (k = 0; k < entry.players.length; k++) {
			if (entry.players[k]['position'] === undefined)
				return;
		}

		if (!entry.done) {
			/*
			 * If all players' ranks are the same, this isn't a new
			 * segment.
			 */
			if (lastp) {
				for (k = 0; k < entry.players.length; k++) {
					if (lastp[k]['position'] !=
					    entry.players[k]['position'] ||
					    lastp[k]['lap'] !=
					    entry.players[k]['lap'])
						break;
				}

				if (k == entry.players.length) {
					lastp = entry.players;
					return;
				}
			}

			lastp = entry.players;

			if (segment !== undefined) {
				segment.vend = entry.time;
				race['segments'].push(segment);
			}

			segment = {
				'vstart': entry.time,
				'players': entry.players.map(function (p) {
					return ({
				            'rank': p.position,
					    'lap': p.lap
					});
				}),
				'source': entry['source']
			};

			return;
		}

		if (segment !== undefined) {
			segment.vend = entry.time;
			race['segments'].push(segment);
			segment = undefined;
		}

		race.vend = entry.time;
		race.end_source = entry.source;
		race.players.forEach(function (p, j) {
			p['rank'] = entry.players[j]['position'];
		});
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
	var time = kDuration(race['vstart']);
	var players = race['players'].slice(0);
	var last, seg;
	var itemsbyr0 = {}, itemsbyr1 = {}, allitems = {};
	var items, ranks;

	entries.push(race['players'].length + 'P ' + race['mode'] + ' on ' +
	    race['track'] + ' (starts at ' + time + ' in video)');
	entries.push('    Racers: ' + players.map(
	    function (p) { return (ucfirst(p['character'])); }).join(', '));

	if (race['segments'].length > 0) {
		seg = race['segments'][0];

		seg.players.forEach(function (p, i) {
			entries.push('    ' + kDuration(seg['vstart']) + ': ' +
			    ucfirst(players[i]['character']) + ' is in ' +
			    ordinal(p['rank']));
		});

		last = seg;

		race['segments'].slice(1).forEach(function (segment) {
			compareSegments(race, last, segment, function (text) {
				entries.push('    ' + kDuration(
				    segment['vstart']) + ': ' + text);
			});

			last = segment;
		});
	}

	entries.push('    ' + kDuration(race['vend']) + ': The race is over.');

	players.sort(function (p1, p2) {
		return (p1['rank'] - p2['rank']);
	});

	entries.push('    Result: ' + players.map(
	    function (p) { return (ucfirst(p['character'])); }).join(', '));

	entries.push('');
	entries.push('Item events');

	race['itemstates'].forEach(function (events, j) {
		entries.push('Player ' + (j + 1));
		entries.push('    R0  R1  ITEM');
		events.forEach(function (evt) {
			allitems[evt['item']] = true;

			if (!itemsbyr0[evt['r0']])
				itemsbyr0[evt['r0']] = {};
			if (!itemsbyr0[evt['r0']][evt['item']])
				itemsbyr0[evt['r0']][evt['item']] = 0;
			itemsbyr0[evt['r0']][evt['item']]++;

			if (!itemsbyr1[evt['r1']])
				itemsbyr1[evt['r1']] = {};
			if (!itemsbyr1[evt['r1']][evt['item']])
				itemsbyr1[evt['r1']][evt['item']] = 0;
			itemsbyr1[evt['r1']][evt['item']]++;

			entries.push('     ' + evt['r0'] + '   ' + evt['r1'] +
			    '  ' + evt['item'] + ' (' + evt['s0'] + ' to ' +
			    evt['s1'] + ')');
		});
	});

	items = Object.keys(allitems).sort();
	ranks = Object.keys(itemsbyr0).sort();
	entries.push('');
	entries.push('Items by rank when player hits item block');
	entries.push(ranks.map(function (r) { return (' ' + r); }).join(' ') +
	    '  Item');
	items.forEach(function (it) {
		entries.push(
		    ranks.map(function (r) {
			return (' ' + (itemsbyr0[r][it] || 0));
		    }).join(' ') + '  ' + it);
	});

	entries.push('');
	entries.push('Items by rank when player gets item');
	entries.push(ranks.map(function (r) { return (' ' + r); }).join(' ') +
	    '  Item');
	items.forEach(function (it) {
		entries.push(
		    ranks.map(function (r) {
			return (' ' + (itemsbyr1[r][it] || 0));
		    }).join(' ') + '  ' + it);
	});

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
		inr = np[i]['rank'];
		ilr = lp[i]['rank'];

		if (!inr || !ilr)
			continue;

		for (j = i + 1; j < np.length; j++) {
			jnr = np[j]['rank'];
			jlr = lp[j]['rank'];

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
