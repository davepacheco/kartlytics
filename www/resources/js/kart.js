/*
 * kart.js: kart web console
 *
 * This file implements the kartlytics webapp, through which users browse
 * historical records of Mario Kart races and upload their own videos to be
 * included in these records.
 *
 * The basic workflow is as follows: a user uploads a video, the server
 * processes it to extract details about each of the races recorded in the
 * video, the user annotates each race with the names of the human players in
 * each square, and then the video becomes part of the historical records.
 *
 * The goal is to be able to slice and dice the data any way we want: filtering
 * and/or decomposing by day, week, game character, human player, race, track,
 * and so on.  As a result, the server doesn't bother organizing the data for
 * us.  It presents it as simply as it came in: as a set of videos, each with a
 * set of races, each describing the characters, players, and race "segments"
 * (periods during which there was no state change within the race, where each
 * character held a particular rank).
 *
 * When loading data, this client makes one API call to retrieve all video
 * records.  Those videos which have not been "imported" (that is, for which the
 * user has not indicated which humans played which characters in each of the
 * video's races) are put aside as "needing attention".  For the rest, we
 * compute our stats client-side and then present them.  For details on how that
 * works, see "Stat computation" below.
 */

/* jsl:declare window */

/*
 * TODO:
 * - clean up "upload" dialog
 * - race details screen: add ability to modify human player names
 */

/*
 * Data model.
 */
var kVideos = {};		/* raw data -- records for all videos */
var kPlayersAutocomplete = {};	/* cache of all player names */
				/* (used for autocomplete) */

/*
 * DOM state.
 */
var kScreenCurrent;		/* current screen */
var kScreenName;		/* current screen name */
var kScreenArgs;		/* current screen args */
var kId = 0;			/* used to generate unique ids */
var kDomConsole;		/* DOM element for main console */
var kDomUpdated;		/* DOM element for "last updated" text */
var kDomTitle;			/* DOM element for page title */
var kTables = [];		/* list of dynamic tables */
var kForceRefresh = false;	/* force refresh on data update */

/*
 * Configuration.
 */
var kKeithingThreshold = 10000;

/*
 * Initialization and data load.  Data is reloaded on page load, after making a
 * server-side change, and periodically when we know there are videos being
 * processed (and updated) on the server.
 */
$(document).ready(kInit);

function kInit()
{
	kDomConsole = $('.kConsole');
	kDomUpdated = $('.kLastUpdateTime');
	kDomTitle = $('#kTitle');

	$(window).bind('hashchange', kScreenUpdate);

	kLoadData(true);
}

function kLoadData(force)
{
	if (force)
		kForceRefresh = true;

	$.ajax({
	    'url': '/api/videos',
	    'dataType': 'json',
	    'success': kOnData,
	    'error': kFatal
	});
}

function kFatal(xhr, text, err)
{
	var message = 'Server error';

	if (text)
		message += ': ' + text;

	if (err && err.message)
		message += ' (' + err.message + ')';

	if (xhr.responseText)
		message += ': ' + xhr.responseText;

	alert(message);
}

function kOnData(data, text)
{
	var message, key, nreading;

	if (!data) {
		message = 'invalid data';
		if (text)
			message += ': ' + text;
		alert(message);
		return;
	}

	for (key in kVideos)
		kVideos[key].deleteMark = true;

	nreading = 0;
	data.forEach(function (video) {
		kVideos[video.id] = video;

		if (video.state == 'reading')
			nreading++;

		if (video.state != 'done')
			return;

		/* Update the set of players for autocomplete. */
		video.metadata.races.forEach(function (race) {
			race.people.forEach(function (p) {
				kPlayersAutocomplete[p] = true;
			});
		});
	});

	for (key in kVideos) {
		if (!kVideos[key].deleteMark)
			continue;

		delete (kVideos[key]);
	}

	if (kForceRefresh || kScreenName == 'videos') {
		kDomUpdated.text(new Date());
		kScreenUpdate();
	}

	kForceRefresh = false;

	if (nreading > 0)
		setTimeout(kLoadData, 1000);
}


/*
 * Rendering utilities.
 */

var kTableDefaults = {
    'bAutoWidth': false,
    'bPaginate': false,
    'bLengthChange': false,
    'bFilter': false,
    'bInfo': false,
    'bSearchable': false
};

function kMakeDynamicTable(parent, header, opts)
{
	var id = kId++;
	var tblid = 'kTable' + id;
	var divid = 'kDiv' + id;
	var fullopts, key, rv, table;

	fullopts = {};
	for (key in kTableDefaults)
		fullopts[key] = kTableDefaults[key];
	for (key in opts)
		fullopts[key] = opts[key];

	rv = $('<div class="kDynamic kSubHeader" id="' + divid + '">' +
	    header + '</div>\n' +
	    '<table id="' + tblid + '" class="kDynamic kDataTable">\n' +
	    '</table></div>');
	rv.appendTo(parent);
	table = $('table#' + tblid);
	kTables.push(table.dataTable(fullopts));
	return (table);
}


/*
 * Screens represent different views within the webapp.  The default screen is a
 * summary showing videos that need attention, overall player stats, and so on.
 * Other screens include the player details screen, the track details screen,
 * and so on.  Screens are tied to the browser URL: links within the app change
 * the URL's "hash" component, which triggers a screen change.
 *
 * Each Screen object defines two methods: load(args), which takes the current
 * URL arguments and populates the DOM for this screen, and clear(), which
 * restores the DOM to a blank screen.
 */
var kScreens = {
    'summary': {
	'name': 'summary',
	'load': kScreenSummaryLoad
    },
    'player': {
	'name': 'player',
	'load': kScreenPlayerLoad
    },
    'players': {
	'name': 'players',
	'load': kScreenPlayersLoad
    },
    'race': {
    	'name': 'race',
	'load': kScreenRaceLoad
    },
    'races': {
    	'name': 'races',
	'load': kScreenRacesLoad
    },
    'track': {
    	'name': 'track',
	'load': kScreenTrackLoad
    },
    'tracks': {
    	'name': 'tracks',
	'load': kScreenTracksLoad
    },
    'video': {
    	'name': 'video',
	'load': kScreenVideoLoad
    },
    'videos': {
    	'name': 'videos',
	'load': kScreenVideosLoad
    }
};

/*
 * Looks at the current URL hash to figure out which screen should be active,
 * clears the current screen, and loads the new one.  This is invoked on initial
 * page load and again when the URL hash changes.
 */
function kScreenUpdate()
{
	var hash, components, screen, args;

	hash = window.location.hash.substr(1);

	if (!hash)
		hash = 'summary';

	components = hash.split('/');

	if (!kScreens[components[0]]) {
		screen = kScreens['summary'];
		args = [];
	} else {
		screen = kScreens[components[0]];
		args = components.slice(1);
	}

	if (kScreenCurrent)
		kRemoveDynamicContent();

	kScreenCurrent = screen;
	kScreenName = screen.name;
	kScreenArgs = args;
	kScreenCurrent.load(args);
}

function kScreenDefault()
{
	window.location.hash = '#summary';
	kScreenUpdate();
}

function kScreenTitle(title)
{
	kDomTitle.text(title);
	document.title = 'kartlytics: ' + title;
}

/*
 * Summary screen: shows videos needing attention, basic player stats, and a
 * paginated view of all races.
 */
function kScreenSummaryLoad()
{
	kScreenTitle('Summary');

	var metadata = [];
	var nraces = 0;
	var players = {};
	var trackcounts = {};
	var dateraces = {};
	var topraces = [];
	var keithings = [];
	var latest;

	var toptbl = $('<table class="kDynamic kSummaryBody"></table>');
	var tblrow = $('<tr></tr>');
	var tbldiv = $('<td class="kDynamic"></td>');

	var text = $([
	    '<td class="kDynamic">',
	    '<p class="kBodyText">Kartlytics.com records results and stats ',
	    'for Mario Kart 64 races.  The records here are automatically ',
	    'computed from screen captures of actual races.  If you\'re ',
	    'wondering where to start, check out <a href="#races">the ' +
	    'races.</a></p>',
	    '<p class="kBodyText">The ',
	    '<a href="https://github.com/davepacheco/kartlytics">software ',
	    'behind kartlytics</a> is open source.</p>',
	    '</td>'
	].join(''));

	kDomConsole.append(toptbl);
	toptbl.append(tblrow);
	tblrow.append(tbldiv);
	tblrow.append(text);

	kEachRace(true, function (race) {
		/* Compute total number of races. */
		nraces++;

		/* Compute total number of distinct players. */
		race['players'].forEach(function (p) {
			players[p['person']] = true;
		});

		/* Compute popular tracks. */
		if (!trackcounts.hasOwnProperty(race['track']))
			trackcounts[race['track']] = 0;

		trackcounts[race['track']]++;

		/* Identify most recent session. */
		var key = Math.floor(
		    race['start_time'] / (1000 * 60 * 60 * 24));
		if (!dateraces[key])
			dateraces[key] = [];
		dateraces[key].push(race);

		/* Compute keithings. */
		var kbyp = new Array(race['players'].length + 1);

		kRaceSegments(race, true, function (_, seg) {
			var r1, rlast;

			/*
			 * A "Keithing" is scored when a player moves from 1st
			 * to last place within kKeithingThreshold ms.  We store
			 * the last segment in which a player was in 1st place
			 * in "kbyp", then when we find them in last we check
			 * whether they've been Keithed.
			 */
			for (var i = 0; i < seg['players'].length; i++) {
				if (seg['players'][i]['rank'] == 1)
					r1 = i;
				else if (seg['players'][i]['rank'] ==
				    race['players'].length)
					rlast = i;
			}

			if (kbyp[rlast] &&
			    seg['vstart'] - kbyp[rlast] < kKeithingThreshold) {
				keithings.push({
				    'race': race,
				    'prev': kbyp[rlast],
				    'segment': seg,
				    'player': rlast
				});

				kbyp[rlast] = 0;
			}

			kbyp[r1] = seg['vend'];
		});
	});

	metadata.push([ 'Total races', nraces ]);
	metadata.push([ 'Total players', Object.keys(players).length ]);

	kMakeDynamicTable(tbldiv, 'Summary', {
	    'bSort': false,
	    'aoColumns': [ {
		'sClass': 'kDataLabel'
	    }, {
		'sClass': 'kDataValue'
	    } ],
	    'aaData': metadata,
	    'fnCreatedRow': function (tr, data) {
		if (data[0] == 'Total races')
			klinkraw($(tr).find('td.kDataValue'), 'races');
		else if (data[0] == 'Total players')
			klinkraw($(tr).find('td.kDataValue'), 'players');
	    }
	});

	topraces = Object.keys(trackcounts);
	topraces.sort(function (t1, t2) {
		return (trackcounts[t2] - trackcounts[t1]);
	});
	topraces = topraces.slice(0, 8).map(function (t) {
		return ([ t, trackcounts[t] ]);
	});

	kMakeDynamicTable(tbldiv, 'Popular tracks', {
	    'bSort': false,
	    'aoColumns': [ {
		'sTitle': 'Track',
		'sClass': 'kDataRaceTrack'
	    }, {
		'sTitle': 'NRaces'
	    } ],
	    'aaData': topraces,
	    'fnCreatedRow': function (tr, data) {
		klink($(tr).find('.kDataRaceTrack'), 'track');
	    }
	});

	latest = Math.max.apply(null, Object.keys(dateraces));
	topraces = dateraces[latest].map(function (race) {
		var i, winner;

		for (i = 0; i < race['players'].length; i++) {
			if (race['players'][i]['rank'] == 1)
				break;
		}

		winner = race['players'][i];

		return ([
		    race,
		    kDateTime(race['start_time']),
		    race['players'].length + 'P',
		    race['mode'],
		    race['level'] || '',
		    race['track'],
		    kDuration(race['duration'], true),
		    ucfirst(winner['char']),
		    winner['person']
		]);
	});

	kMakeDynamicTable(kDomConsole, 'Latest session', {
	    'aoColumns': [ {
		'bVisible': false
	    }, {
		'sTitle': 'Date',
		'sClass': 'kDataRaceDate'
	    }, {
		'sTitle': 'NPl',
		'sClass': 'kDataRaceNPl'
	    }, {
		'sTitle': 'Mode',
		'sClass': 'kDataRaceMode'
	    }, {
		'sTitle': 'Lvl',
		'sClass': 'kDataRaceLvl'
	    }, {
		'sTitle': 'Track',
		'sClass': 'kDataRaceTrack'
	    }, {
		'sTitle': 'Time',
		'sClass': 'kDataRaceTime'
	    }, {
		'sTitle': 'WinC',
		'sClass': 'kDataPlayerCharacter'
	    }, {
		'sTitle': 'WinH',
		'sClass': 'kDataPlayerName'
	    } ],
	    'aaData': topraces,
	    'fnCreatedRow': function (tr, data) {
		klink($(tr).find('td.kDataRaceDate'), 'race',
		    data[0]['raceid']);
		klink($(tr).find('td.kDataRaceTrack'), 'track');
		klink($(tr).find('td.kDataPlayerName'), 'player');
	    }
	});

	keithings = keithings.map(function (k) {
		var race = k['race'];

		return ([
		    race,
		    kDateTime(race['start_time']),
		    race['players'].length + 'P',
		    race['mode'],
		    race['level'] || '',
		    race['track'],
		    race['players'][k['player']]['person'],
		    kDuration(k['prev'] - race['vstart'], true),
		    kDuration(k['segment']['vstart'] - race['vstart'], true),
		    kDuration(k['segment']['vstart'] - k['prev'], true)
		]);
	});

	kMakeDynamicTable(kDomConsole, 'Keithings (all time)', {
	    'aoColumns': [ {
		'bVisible': false
	    }, {
		'sTitle': 'Date',
		'sClass': 'kDataRaceDate'
	    }, {
		'sTitle': 'NPl',
		'sClass': 'kDataRaceNPl'
	    }, {
		'sTitle': 'Mode',
		'sClass': 'kDataRaceMode'
	    }, {
		'sTitle': 'Lvl',
		'sClass': 'kDataRaceLvl'
	    }, {
		'sTitle': 'Track',
		'sClass': 'kDataRaceTrack'
	    }, {
		'sTitle': 'Who',
		'sClass': 'kDataPlayerName'
	    }, {
		'sTitle': 'From',
		'sClass': 'kDataRaceTime'
	    }, {
		'sTitle': 'To',
		'sClass': 'kDataRaceTime'
	    }, {
		'sTitle': 'Over',
		'sClass': 'kDataRaceTime'
	    } ],
	    'aaData': keithings,
	    'fnCreatedRow': function (tr, data) {
		klink($(tr).find('td.kDataRaceDate'), 'race',
		    data[0]['raceid']);
		klink($(tr).find('td.kDataRaceTrack'), 'track');
		klink($(tr).find('td.kDataPlayerName'), 'player');
	    }
	});
}

function kRemoveDynamicContent()
{
	kTables.forEach(function (t) { t.fnDestroy(); });
	kTables = [];
	$('.kDynamic').remove();
}

/*
 * Player details screen
 */
function kScreenPlayerLoad(args)
{
	var pname, filter;
	var allraces, bychar, bytrack;
	var bychardata, bytrackdata;

	if (args.length < 1) {
		kScreenDefault();
		return;
	}

	pname = args[0];
	kScreenTitle('Player: ' + pname);

	filter = function (race) {
		for (var i = 0; i < race.players.length; i++) {
			if (race.players[i]['person'] == pname)
				return (true);
		}

		return (false);
	};

	allraces = [];
	bychar = {};
	bytrack = {};

	kEachRace(filter, function (race) {
		var i, p, time;

		for (i = 0; i < race.players.length; i++) {
			if (race.players[i]['person'] == pname)
				break;
		}

		p = race.players[i];
		time = p['time'] ? kDuration(p['time'], true) : '-';

		allraces.push([
		    race,
		    kDateTime(race['start_time']),
		    race['level'] || '',
		    race['players'].length + 'P',
		    ordinal(p['rank']),
		    time,
		    race['mode'],
		    'P' + (i + 1),
		    ucfirst(p['char']),
		    ucfirst(kCharToClass(p['char'])),
		    race['track'],
		    kTrackToCup(race['track'])
		]);

		if (!bychar[p['char']])
			bychar[p['char']] = {
			    'tot': 0,
			    'p1': 0,
			    'p2': 0,
			    'p3': 0,
			    'p4': 0
			};

		bychar[p['char']]['tot']++;
		bychar[p['char']]['p' + p['rank']]++;

		if (!bytrack[race['track']])
			bytrack[race['track']] = {
			    'tot': 0,
			    'p1': 0,
			    'p2': 0,
			    'p3': 0,
			    'p4': 0,
			    'best': Number.MAX_VALUE
			};

		bytrack[race['track']]['tot']++;
		bytrack[race['track']]['p' + p['rank']]++;

		if (p['time'] < bytrack[race['track']]['best'])
			bytrack[race['track']]['best'] = p['time'];
	});

	kMakeDynamicTable(kDomConsole, 'Races', {
	    'bFilter': true,
	    'oLanguage': {
		'sEmptyTable': 'No races for ' + pname + '.'
	    },
	    'aoColumns': [ {
		'bVisible': false
	    }, {
		'sTitle': 'Date',
		'sClass': 'kDataRaceDate'
	    }, {
		'sTitle': 'Lvl',
		'sClass': 'kDataRaceLvl'
	    }, {
		'sTitle': 'NPl',
		'sClass': 'kDataRaceNPl'
	    }, {
	        'sTitle': 'Rank',
		'sClass': 'kDataRaceRank'
	    }, {
		'sTitle': 'Time',
		'sClass': 'kDataRaceTime'
	    }, {
		'sTitle': 'Mode',
		'sClass': 'kDataRaceMode'
	    }, {
		'sTitle': 'Pl',
		'sClass': 'kDataRacePl'
	    }, {
		'sTitle': 'Char',
		'sClass': 'kDataRaceChar'
	    }, {
		'sTitle': 'CharClass',
		'sClass': 'kDataRaceCharClass'
	    }, {
		'sTitle': 'Track',
		'sClass': 'kDataRaceTrack'
	    }, {
		'sTitle': 'Cup',
		'sClass': 'kDataRaceCup'
	    } ],
	    'aaData': allraces,
	    'fnCreatedRow': function (tr, data) {
	        klink($(tr).find('td.kDataRaceDate'), 'race',
		    data[0]['raceid']);
		klink($(tr).find('td.kDataRaceTrack'), 'track');
	    }
	});

	bychardata = Object.keys(bychar).map(function (chr) {
		return ([
		    ucfirst(chr),
		    bychar[chr]['tot'],
		    kPercentage(bychar[chr]['tot'] / allraces.length),
		    bychar[chr]['p1'],
		    bychar[chr]['p2'],
		    bychar[chr]['p3'],
		    bychar[chr]['p4']
		]);
	});

	kMakeDynamicTable(kDomConsole, 'Races by character', {
	    'oLanguage': {
		'sEmptyTable': 'No races for ' + pname + '.'
	    },
	    'aoColumns': [ {
		'sTitle': 'Character',
		'sClass': 'kDataPlayerCharacter'
	    }, {
		'sTitle': 'NR',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    }, {
		'sTitle': '%',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    }, {
		'sTitle': 'N1',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    }, {
		'sTitle': 'N2',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    }, {
		'sTitle': 'N3',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    }, {
		'sTitle': 'N4',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    } ],
	    'aaData': bychardata
	});

	bytrackdata = Object.keys(bytrack).map(function (trk) {
	    var best = bytrack[trk]['best'] == Number.MAX_VALUE ?
	        '-' : kDuration(bytrack[trk]['best'], true);
	    return ([
		trk,
		best,
		bytrack[trk]['tot'],
		bytrack[trk]['p1'],
		bytrack[trk]['p2'],
		bytrack[trk]['p3'],
		bytrack[trk]['p4']
	    ]);
	});
	kMakeDynamicTable(kDomConsole, 'Races by track', {
	    'oLanguage': {
		'sEmptyTable': 'No races for ' + pname + '.'
	    },
	    'aoColumns': [ {
		'sTitle': 'Track',
		'sClass': 'kDataRaceTrack'
	    }, {
		'sTitle': 'Best',
		'sClass': 'kDataRaceTime'
	    }, {
		'sTitle': 'NR',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    }, {
		'sTitle': 'N1',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    }, {
		'sTitle': 'N2',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    }, {
		'sTitle': 'N3',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    }, {
		'sTitle': 'N4',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    } ],
	    'aaData': bytrackdata,
	    'fnCreatedRow': function (tr) {
		klink($(tr).find('td.kDataRaceTrack'), 'track');
	    }
	});
}

function kScreenPlayersLoad(args)
{
	var players, pnames, pdata;

	kScreenTitle('Players');

	players = {};
	kEachRace(true, function (race) {
		race.players.forEach(function (p, i) {
			var pinfo;

			if (!players[p.person])
				players[p.person] = {
					'ntot': 0,
					'n1': 0,
					'n2': 0,
					'n3': 0,
					'n4': 0,
					'ttot': 0,
					't1': 0,
					't2': 0,
					't3': 0,
					't4': 0,
					't?': 0
				};

			pinfo = players[p.person];
			pinfo['ntot']++;
			pinfo['n' + p.rank]++;

			kRaceSegments(race, true, function (_, seg) {
				var rank = seg.players[i].rank || '?';
				pinfo['ttot'] += seg.duration;
				pinfo['t' + rank] += seg.duration;
			});
		});
	});

	pnames = Object.keys(players);
	pnames.sort();

	pdata = pnames.map(function (p) {
	    var pinfo = players[p];
	    return ([
		p,
		pinfo['ntot'],
		pinfo['n1'],
		pinfo['n2'],
		pinfo['n3'],
		pinfo['n4'],
		kDuration(pinfo['ttot'], false),
		kDuration(pinfo['t1'], false),
		kDuration(pinfo['t2'], false),
		kDuration(pinfo['t3'], false),
		kDuration(pinfo['t4'], false),
		kPercentage(pinfo['t1'] / pinfo['ttot']),
		kPercentage(pinfo['t2'] / pinfo['ttot']),
		kPercentage(pinfo['t3'] / pinfo['ttot']),
		kPercentage(pinfo['t4'] / pinfo['ttot'])
	    ]);
	});

	kMakeDynamicTable(kDomConsole, '', {
	    'oLanguage': {
		'sEmptyTable': 'No videos imported.'
	    },
	    'aoColumns': [ {
		'sTitle': 'Player',
		'sClass': 'kDataPlayerName'
	    }, {
		'sTitle': 'NR',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    }, {
		'sTitle': 'N1st',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    }, {
		'sTitle': 'N2nd',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    }, {
		'sTitle': 'N3rd',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    }, {
		'sTitle': 'N4th',
		'sClass': 'kDataPlayerNum',
		'sWidth': '15px'
	    }, {
		'sTitle': 'Time',
		'sClass': 'kDataPlayerTime'
	    }, {
		'sTitle': 'T1st',
		'sClass': 'kDataPlayerTime'
	    }, {
		'sTitle': 'T2nd',
		'sClass': 'kDataPlayerTime'
	    }, {
		'sTitle': 'T3rd',
		'sClass': 'kDataPlayerTime'
	    }, {
		'sTitle': 'T4th',
		'sClass': 'kDataPlayerTime'
	    }, {
		'sTitle': '%1st',
		'sClass': 'kDataPlayerPercentage'
	    }, {
		'sTitle': '%2nd',
		'sClass': 'kDataPlayerPercentage'
	    }, {
		'sTitle': '%3rd',
		'sClass': 'kDataPlayerPercentage'
	    }, {
		'sTitle': '%4th',
		'sClass': 'kDataPlayerPercentage'
	    } ],
	    'aaData': pdata,
	    'fnCreatedRow': function (tr, _1, _2) {
	        klink($(tr).find('td.kDataPlayerName'), 'player');
	    }
	});
}

/*
 * Race details screen
 */
function kScreenRaceLoad(args)
{
	var vidid, raceid, racename, filter, video;
	var metadata = [], players = [], events = [];

	if (args.length < 2) {
		kScreenDefault();
		return;
	}

	vidid = args[0];
	video = kVideos[vidid];
	raceid = vidid + '/' + args[1];
	racename = kDate(video.crtime) + '/' + args[1];
	kScreenTitle('Race: ' + racename);

	/* This search could be more efficient. */
	filter = function (race) { return (race['raceid'] == raceid); };
	kEachRace(filter, function (race) {
		var kind = race['players'].length + 'P ' + race['mode'];
		if (race['level'])
			kind += ' (' + race['level'] + ')';

		metadata.push([ 'Kind', kind ]);
		metadata.push([ 'Track', race['track']]);
		metadata.push([ 'Duration', kDuration(race['duration']) ]);
		metadata.push([ 'Start time', kDateTime(race['start_time']) ]);
		metadata.push([ 'Video', race['vidid'] ]);
		metadata.push([ 'Video time', kDuration(race['vstart']) ]);
		metadata.push([ 'Number in video', race['num'] ]);

		players = race['players'].map(function (p, i) {
			return ([
			    'P' + (i + 1),
			    p['person'],
			    ucfirst(p['char']),
			    ordinal(p['rank']),
			    p['time'] ? kDuration(p['time']) : '-'
			]);
		});

		kRaceEvents(race, function (_, evt) {
			var entry = [
				evt,
				kDuration(evt['vtime'], true),
				kDuration(evt['rtime'], true)
			];

			if (evt['seg']) {
				entry = entry.concat(
				    evt['seg']['players'].map(function (p) {
				        return (ordinal(p['rank']) || '?');
				    }));
			} else {
				entry = entry.concat(
				    race['players'].map(function () {
				        return ('-');
				    }));
			}

			entry.push(evt['messages'].join('\n'));

			if (video.frameImages)
				entry.push(evt['source']);

			events.push(entry);
		});
	});

	kMakeDynamicTable(kDomConsole, '', {
	    'bSort': false,
	    'aoColumns': [ {
		'sClass': 'kDataLabel'
	    }, {
		'sClass': 'kDataValue'
	    } ],
	    'aaData': metadata,
	    'fnCreatedRow': function (tr, data) {
		if (data[0] == 'Video')
			klink($(tr).find('td.kDataValue'), 'video');
		else if (data[0] == 'Track')
			klink($(tr).find('td.kDataValue'), 'track');
	    }
	});

	kMakeDynamicTable(kDomConsole, 'Players', {
	    'bSort': false,
	    'aoColumns': [ {
		'sTitle': 'Player',
		'sClass': 'kDataLabel'
	    }, {
		'sTitle': 'Person',
		'sClass': 'kDataPlayerName'
	    }, {
		'sTitle': 'Character'
	    }, {
		'sTitle': 'Rank'
	    }, {
		'sTitle': 'Time',
		'sClass': 'kDataRaceTime'
	    } ],
	    'aaData': players,
	    'fnCreatedRow': function (tr) {
		klink($(tr).find('td.kDataPlayerName'), 'player');
	    }
	});

	var eventCols = [ {
	    'bVisible': false
	}, {
	    'sTitle': 'Vtime',
	    'sClass': 'kDataRaceTime'
	}, {
	    'sTitle': 'Rtime',
	    'sClass': 'kDataRaceTime'
	} ].concat(players.map(function (p, i) {
		return ({ 'sTitle': p[2], 'sClass': 'kDataRaceRank' });
	})).concat([ {
	    'sTitle': 'Events',
	    'sClass': 'kDataMessages'
	} ]);

	if (video.frameImages)
		eventCols.push({
		    'sTitle': 'Screen capture',
		    'sClass': 'kDataFrame'
		});

	kMakeDynamicTable(kDomConsole, 'Events', {
	    'bSort': false,
	    'aoColumns': eventCols,
	    'aaData': events,
	    'fnCreatedRow': function (tr) {
		var td, text;

		td = $(tr).find('td.kDataMessages');
		text = td.text();
		$(td).html(text.replace('\n', '<br />'));

	        td = $(tr).find('td.kDataFrame');
		text = td.text();

		if (text.length === 0)
			return;

		td.html('<a href="' + text + '">' +
		    '<img src="' + text + '" width="160" height="120"/>' +
		    '</a>');
	    }
	});
}

/*
 * "All races" screen
 */
function kScreenRacesLoad(args)
{
	var races = [];

	kScreenTitle('All races');

	kEachRace(true, function (race) {
		races.push([
		    race,
		    kDateTime(race['start_time']),
		    race['players'].length + 'P',
		    race['mode'],
		    race['level'] || '',
		    race['track'],
		    kDuration(race['duration'], true),
		    kDuration(race['vstart'], true),
		    kDuration(race['vend'], true)
		]);
	});

	kMakeDynamicTable(kDomConsole, 'All races', {
	    'bFilter': true,
	    'bInfo': true,
	    'oLanguage': {
		'sEmptyTable': 'No races found.',
		'sInfo': 'Showing _START_ to _END_ of _TOTAL_ races',
		'sInfoFiltered': ' (from _MAX_ total races)',
		'sInfoPostFix': '.',
		'sZeroRecords': 'No matching races.'
	    },
	    'aoColumns': [ {
		'bVisible': false
	    }, {
		'sTitle': 'Date',
		'sClass': 'kDataRaceDate'
	    }, {
		'sTitle': 'NPl',
		'sClass': 'kDataRaceNPl'
	    }, {
		'sTitle': 'Mode',
		'sClass': 'kDataRaceMode'
	    }, {
		'sTitle': 'Lvl',
		'sClass': 'kDataRaceLvl'
	    }, {
		'sTitle': 'Track',
		'sClass': 'kDataRaceTrack'
	    }, {
		'sTitle': 'Time',
		'sClass': 'kDataRaceTime'
	    } ],
	    'aaData': races,
	    'fnCreatedRow': function (tr, data) {
		klink($(tr).find('td.kDataRaceDate'), 'race',
		    data[0]['raceid']);
		klink($(tr).find('td.kDataRaceTrack'), 'track');
	    }
	});

}

/*
 * Track details screen
 */
function kScreenTrackLoad(args)
{
	var track, filter;
	var races = [];

	if (args.length < 1) {
		kScreenDefault();
		return;
	}

	track = args[0];
	kScreenTitle(track);

	/* This search could be more efficient. */
	filter = function (race) { return (race['track'] == track); };
	kEachRace(filter, function (race) {
		var i, p;

		for (i = 0; i < race['players'].length; i++) {
			if (race['players'][i]['rank'] == 1)
				break;
		}

		p = race['players'][i];

		races.push([
		    race,
		    kDateTime(race['start_time']),
		    race['players'].length + 'P',
		    race['mode'],
		    race['level'] || '',
		    kDuration(p['time']),
		    ucfirst(p['char']),
		    p['person']
		]);
	});

	kMakeDynamicTable(kDomConsole, '', {
	    'bSort': false,
	    'aoColumns': [ {
		'bVisible': false
	    }, {
		'sTitle': 'Date',
		'sClass': 'kDataRaceDate'
	    }, {
		'sTitle': 'NPl',
		'sClass': 'kDataRaceNPl'
	    }, {
		'sTitle': 'Mode',
		'sClass': 'kDataRaceMode'
	    }, {
		'sTitle': 'Lvl',
		'sClass': 'kDataRaceLvl'
	    }, {
		'sTitle': 'Best(t)',
		'sClass': 'kDataRaceTime'
	    }, {
		'sTitle': 'Best(C)',
		'sClass': 'kDataPlayerCharacter'
	    }, {
		'sTitle': 'Best(P)',
		'sClass': 'kDataPlayerName'
	    } ],
	    'aaData': races,
	    'fnCreatedRow': function (tr, data) {
	        klink($(tr).find('td.kDataRaceDate'), 'race',
		    data[0]['raceid']);
	        klink($(tr).find('td.kDataPlayerName'), 'player');
	    }
	});
}

/*
 * "All tracks" screen
 */
function kScreenTracksLoad(args)
{
	var racesbytrack = {};

	kScreenTitle('Races by track');

	kEachRace(true, function (race) {
		var i, p;

		for (i = 0; i < race['players'].length; i++) {
			if (race['players'][i]['rank'] == 1)
				break;
		}

		p = race['players'][i];

		if (!racesbytrack[race['track']])
			racesbytrack[race['track']] = [];

		racesbytrack[race['track']].push([
		    race,
		    kDateTime(race['start_time']),
		    race['players'].length + 'P',
		    race['mode'],
		    race['level'] || '',
		    kDuration(p['time']),
		    ucfirst(p['char']),
		    p['person']
		]);
	});

	var tracks = Object.keys(racesbytrack);
	tracks.sort();

	tracks.forEach(function (track) {
		kMakeDynamicTable(kDomConsole, track, {
		    'bSort': false,
		    'aoColumns': [ {
			'bVisible': false
		    }, {
			'sTitle': 'Date',
			'sClass': 'kDataRaceDate'
		    }, {
			'sTitle': 'NPl',
			'sClass': 'kDataRaceNPl'
		    }, {
			'sTitle': 'Mode',
			'sClass': 'kDataRaceMode'
		    }, {
			'sTitle': 'Lvl',
			'sClass': 'kDataRaceLvl'
		    }, {
			'sTitle': 'Best(t)',
			'sClass': 'kDataRaceTime'
		    }, {
			'sTitle': 'Best(C)',
			'sClass': 'kDataPlayerCharacter'
		    }, {
			'sTitle': 'Best(P)',
			'sClass': 'kDataPlayerName'
		    } ],
		    'aaData': racesbytrack[track],
		    'fnCreatedRow': function (tr, data) {
		        klink($(tr).find('td.kDataRaceDate'), 'race',
			    data[0]['raceid']);
		        klink($(tr).find('td.kDataPlayerName'), 'player');
		    }
		});
	});
}

/*
 * Video details screen
 */
function kScreenVideoLoad(args)
{
	var vidid, video, filter;
	var metadata = [], races = [];

	if (args.length < 1 || !kVideos.hasOwnProperty(args[0])) {
		kScreenDefault();
		return;
	}

	vidid = args[0];
	video = kVideos[vidid];

	kScreenTitle('Video: ' + video.name);

	$('<table class="kDynamic" style="width: 100%">' +
	    '<tr>' +
	    '<td id="kVideoMetadata" style="width: 50%"></td>' +
	    '<td id="kVideoVideo" style="width: 50%"></td>' +
	    '</tr>' +
	    '</table>').appendTo(kDomConsole);

	if (video.crtime)
		metadata.push([ 'Created', kDateTime(video.crtime) ]);
	metadata.push([ 'Original filename', video.name ]);
	metadata.push([ 'Processing state', ucfirst(video.state) ]);
	metadata.push([ 'Uploaded', video.uploaded ]);
	metadata.push([ 'Modified', video.mtime ]);

	if (video.state == 'unimported')
		metadata.push([ 'Import', 'Import Video' ]);

	metadata.push([ 'Reprocess', 'Reprocess Video' ]);
	metadata.push([ 'Download', 'Download Video' ]);

	/* This search could be more efficient. */
	filter = function (race) { return (race['vidid'] == vidid); };
	kEachRace(filter, function (race) {
		races.push([
			kDuration(race['vstart']),
			race['num'],
			kDateTime(race['start_time']),
			race['players'].length + 'P',
			race['mode'],
			race['level'] || '',
			race['track'],
			kDuration(race['duration'])
		]);
	});

	kMakeDynamicTable($('td#kVideoMetadata'), '', {
	    'bSort': false,
	    'aoColumns': [ {
		'sClass': 'kDataLabel'
	    }, {
		'sClass': 'kDataValue'
	    } ],
	    'aaData': metadata,
	    'fnCreatedRow': function (tr, data) {
		var td;

		if (data[0] == 'Import') {
			td = $(tr).find('td.kDataValue');
			td.html('<a href="javascript:kImportDialog(\'' + vidid +
			    '\')">Import</a>');
			return;
		}

		if (data[0] == 'Reprocess') {
			td = $(tr).find('td.kDataValue');
			$(td).html('<a href="javascript:kReprocessVideo(\'' +
			    vidid + '\');">' + $(td).text() + '</a>');
			return;
		}

		if (data[0] == 'Download') {
			td = $(tr).find('td.kDataValue');
			$(td).html('<a href="/api/files/' +
			    vidid + '/video.mov">' + $(td).text() + '</a>');
			return;
		}
	    }
	});

	$('td#kVideoVideo').append(
	    '<video width="320" height="240" controls="controls">' +
	    '<source src="/api/files/' + vidid + '" type="video/quicktime" />' +
	    '</video>');

	kMakeDynamicTable(kDomConsole, 'Races', {
	    'bSort': false,
	    'aoColumns': [ {
		'sTitle': 'VStart',
		'sClass': 'kDataRaceVStart'
	    }, {
		'sTitle': 'VNum',
		'sClass': 'kDataRaceVNum'
	    }, {
		'sTitle': 'Date',
		'sClass': 'kDataRaceDate'
	    }, {
		'sTitle': 'NPl',
		'sClass': 'kDataRaceNPl'
	    }, {
		'sTitle': 'Mode',
		'sClass': 'kDataRaceMode'
	    }, {
		'sTitle': 'Lvl',
		'sClass': 'kDataRaceLvl'
	    }, {
		'sTitle': 'Track',
		'sClass': 'kDataRaceTrack'
	    }, {
		'sTitle': 'Time',
		'sClass': 'kDataRaceTime'
	    } ],
	    'aaData': races,
	    'fnCreatedRow': function (tr) {
		var td = $(tr).find('td.kDataRaceVNum');
		klink(td, 'race', vidid + '/' + $(td).text());
		klink($(tr).find('td.kDataRaceTrack'), 'track');
	    }
	});
}

/*
 * "All videos" screen
 */
function kScreenVideosLoad(args)
{
	var videos, vidid, video, detail;

	kScreenTitle('All videos');

	videos = [];

	for (vidid in kVideos) {
		video = kVideos[vidid];

		if (video.state == 'error')
			detail = video.error;
		else if (video.state == 'unimported')
			detail = 'Import';
		else
			detail = '';

		videos.push([
		    video,
		    video.name,
		    ucfirst(video.state),
		    detail,
		    kDateTime(video.crtime),
		    video.mtime
		]);
	}

	kMakeDynamicTable(kDomConsole, '', {
	    'aoColumns': [ {
		'bVisible': false
	    }, {
		'sTitle': 'Filename',
		'sClass': 'kDataColumnVideoName'
	    }, {
		'sTitle': 'State'
	    }, {
		'sTitle': 'Details',
		'sClass': 'kDataColumnDetails'
	    }, {
		'sTitle': 'Captured',
		'sClass': 'kDataDateTime'
	    }, {
		'sTitle': 'Modified',
		'sClass': 'kDataDateTime'
	    } ],
	    'aaData': videos,
	    'fnCreatedRow': function (tr, data) {
		var td;

		td = $(tr).find('td.kDataColumnVideoName');
	        klink(td, 'video', data[0].id);

		if (data[0].state == 'unimported') {
			td = $(tr).find('td.kDataColumnDetails');
			td.html('<a href="javascript:kImportDialog(\'' +
			    data[0].id + '\')">Import</a>');
			return;
		}

		if (data[0].state == 'reading') {
			td = $(tr).find('td.kDataColumnDetails');
			$('<div class="kProgressBar"></div>').appendTo(td).
			    progressbar({ 'value': Math.floor(
				(data[0].frame / data[0].nframes) * 100) });
		}
	    }
	});
}

/*
 * Workflow: dialogs through which users modify video records.
 */

function kUploadDialog()
{
	var div = $([
	    '<div>',
	    '    <form id="upload" method="post" action="/kart/video"',
	    '          enctype="multipart/form-data">',
	    '        <input type="file" name="file"/>',
	    '    </form>',
	    '    <div id="uploadProgress" class="kProgressBar"></div>',
	    '</div>'
	].join('\n'));

	$(div).dialog({
		'buttons': {
			'Upload': function () { kUploadOk(div); }
		},
		'dialogClass': 'kUploadDialog',
		'modal': true,
		'title': 'Upload video',
		'width': '400px'
	});

	$(div).bind('dialogclose', function () {
		$(div).remove();
	});
}

function kUploadOk(div)
{
	$('#upload').ajaxForm().ajaxSubmit({
		'success': function () {
			$(div).dialog('destroy');
			$(div).remove();
			kLoadData(true);
		},
		'error': function () {
			alert('Upload failed!');
			$(div).dialog('destroy');
			$(div).remove();
		},
		'uploadProgress': function (_0, _1, _2, pct) {
			$('#uploadProgress').progressbar({ 'value': pct });
		}
	});

	$('#uploadProgress').progressbar({ 'value': 0 });
}

function kImportDialog(uuid)
{
	var racecode = [
	    '        <tr>',
	    '            <td colspan="2">',
	    '                <span id="label$id"></span>',
	    '                <span class="kWarning" id="error$id"></span>',
	    '            </td>',
	    '        </tr>',
	    '        <tr>',
	    '            <td class="kTableLabel">Level:</td>',
	    '            <td class="kTableValue">',
	    '                <input type="radio" id="level50cc$id"',
	    '                    name="level$id" value="50cc"/>',
	    '                <label for="level50cc$id">50cc</label>',
	    '                <input type="radio" id="level100cc$id"',
	    '                    name="level$id" value="100cc"/>',
	    '                <label for="level100cc$id">100cc</label>',
	    '                <input type="radio" id="level150cc$id"',
	    '                    name="level$id" value="150cc"/>',
	    '                <label for="level150cc$id">150cc</label>',
	    '                <input type="radio" id="levelExtra$id"',
	    '                    name="level$id" value="Extra"/>',
	    '                <label for="levelExtra$id">Extra</label>',
	    '                <span class="kWarning" id="level$iderror" />',
	    '            </td>',
	    '        </tr>'
	].join('\n');

	var div = $([
	    '<div id="import">',
	    '    <table class="kPropertyTable"><tbody>',
	    '    </tbody></table>',
	    '</div>'
	].join('\n'));

	var video = kVideos[uuid];

	video.races.forEach(function (race, i) {
		if (!race.end)
			return;

		var code = racecode.replace(/\$id/g, i);
		var tbody = $(div).find('table.kPropertyTable > tbody');
		var pcode = $('<table class="kPlayerTable"></table>');
		var data = race.players.map(function (p, j) {
			var result = ordinal(race.results[j].position);
			return ([ 'P' + (j + 1), ucfirst(p.character),
			    result, '' ]);
		});

		tbody.append($(code));
		tbody.append($([
		    '<tr>',
		    '    <td class="kTableLabel">Players:</td>',
		    '    <td id="players' + i + '" class="kTableValue"></td>',
		    '</tr>'
		].join('\n')));

		$(tbody).find('#players' + i).append(pcode);

		$(pcode).dataTable({
			'bAutoWidth': false,
			'bPaginate': false,
			'bLengthChange': false,
			'bFilter': false,
			'bSort': false,
			'bInfo': false,
			'bSearchable': false,
			'aoColumns': [ {
				'sTitle': '',
				'sClass': 'kPlayerNumber'
			}, {
				'sTitle': 'Character',
				'sClass': 'kPlayerCharacter'
			}, {
				'sTitle': 'Place',
				'sClass': 'kPlayerPlace'
			}, {
				'sTitle': 'Human',
				'sClass': 'kPlayerHuman'
			} ],
			'aaData': data,
			'fnCreatedRow': function (tr, _, j) {
				$(tr.lastChild).html(
				    '<input type="text" id="race' +
				    i + 'p' + j + '" />' +
				    '<span class="kWarning" id="race' +
				    i + 'p' + j + 'error" />');
				$(tr).find('input').autocomplete({
					/*
					 * XXX this could be a lot more clever
					 * by showing all people from all
					 * previous races AND all people entered
					 * on this entire form, MINUS any that
					 * have been used in this race already.
					 */
					'source': Object.keys(
					    kPlayersAutocomplete)
				});
			}
		});
	});

	$(div).dialog({
		'buttons': {
			'Import': function () {
				kImportOk(uuid, div);
			}
		},
		'dialogClass': 'kConfirmDialog',
		'modal': true,
		'title': 'Import video',
		'width': '80%'
	});

	$(div).bind('dialogclose', function () {
		$(div).remove();
	});

	video.races.forEach(function (race, i) {
		var time = kDuration(race.start_time, false);
		var label = '<strong>Race ' + (i+1) + ': ' +
		    race.players.length + 'P ' + race.mode + ' on ' +
		    race.track + '</strong> (start time: ' + time + ')';
		$('#label' + i).html(label);
	});

	$('#race0p0').focus();
}

function kImportOk(uuid, div)
{
	var video = kVideos[uuid];
	var races = video.races;
	var metadata = {};
	var i, j, k, entry, errors;

	metadata.races = [];

	for (i = 0; i < races.length; i++) {
		entry = {};
		entry['level'] = $(div).find('input:radio[name=level' + i +
		    ']:checked').val();
		entry['people'] = [];

		for (j = 0; j < races[i].players.length; j++)
			entry['people'].push($(div).find(
			    '#race' + i + 'p' + j).val());

		metadata.races.push(entry);
	}

	/*
	 * Validate what we've got.  While we're at it, clear existing
	 * validation errors.
	 */
	errors = [];
	for (i = 0; i < metadata.races.length; i++) {
		entry = metadata.races[i];

		$('#error' + i).text('');
		$('#level' + i + 'error').text('');

		if (!entry['level'])
			errors.push([ i, 'level' + i, 'Select a level' ]);

		for (j = 0; j < entry.people.length; j++) {
			$('#race' + i + 'p' + j + 'error').text('');

			if (!entry.people[j]) {
				errors.push([ i, 'race' + i + 'p' + j,
				    'Enter a player name' ]);
				continue;
			}

			for (k = j + 1; k < entry.people.length; k++) {
				if (entry.people[j] != entry.people[k])
					continue;

				errors.push([ i, 'race' + i + 'p' + k,
				    '"' + entry.people[k] + '" is already ' +
				    'player ' + (j + 1) ]);
			}
		}
	}

	if (errors.length === 0) {
		kImportSave(uuid, metadata, div);
		return;
	}

	errors.forEach(function (err) {
		$('#error' + err[0]).text('*');
		$('#' + err[1] + 'error').text(err[2]);
	});
}

function kImportSave(uuid, metadata, div)
{
	$.ajax({
	    'type': 'PUT',
	    'url': '/api/videos/' + uuid,
	    'contentType': 'application/json',
	    'processData': false,
	    'data': JSON.stringify(metadata),
	    'error': kFatal,
	    'success': function () {
		$(div).dialog('destroy');
		$(div).remove();
		kLoadData(true);
	    }
	});
}

function kReprocessVideo(vidid)
{
	$.ajax({
	    'type': 'PUT',
	    'url': '/api/videos/' + vidid + '/rerun',
	    'processData': false,
	    'error': kFatal,
	    'success': function () { kLoadData(true); }
	});
}

/*
 * Utility functions.
 */

function klink(elt, type, ident)
{
	if (!ident)
		ident = $(elt).text();

	klinkraw(elt, type + '/' + ident);
}

function klinkraw(elt, href)
{
	$(elt).html('<a href="#' + href + '">' + $(elt).text() + '</a>');
}

function ucfirst(str)
{
	return (str[0].toUpperCase() + str.substr(1));
}

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

function isEmpty(obj)
{
	var key;
	for (key in obj)
		return (false);
	return (true);
}

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

function kDate(ms)
{
	var obj = new Date(ms);
	return (obj.getFullYear() + '-' + (obj.getMonth() + 1) +
	    '-' + obj.getDate());
}

function kDateTime(ms)
{
	var obj = new Date(ms);
	var hours = obj.getHours();
	var minutes = obj.getMinutes();

	if (hours < 10)
		hours = '0' + hours;

	if (minutes < 10)
		minutes = '0' + minutes;

	return (obj.getFullYear() + '-' + (obj.getMonth() + 1) +
	    '-' + obj.getDate() + ' ' + hours + ':' + minutes);
}

function kPercentage(frac)
{
	return ((100 * frac).toFixed(1));
}

function frameImgHref(vidid, frame)
{
	if (!frame)
		return ('');

	return ('/api/files/' + vidid + '/pngs/' +
	    encodeURIComponent(frame) + '.png');
}

/*
 * Stat computation.  The rest of this file is essentially a library for doing
 * stat queries on the race data.
 *
 * As described above, the goal is to be able to slice and dice the data in all
 * kinds of ways.  We define a "race" object with the following properties:
 *
 *	raceid		Unique identifier for this race (composed from the
 *			"vidid" and "num" fields).
 *
 *	vidid		Unique identifier for the video this race came from.
 *
 *	num		Ordinal number of this race within its video.
 *
 *	start_time	The datetime when this race was started.
 *
 *	end_time	The datetime when this race completed.
 *
 * 	duration	The duration of the race, in milliseconds.
 *
 *      vstart		Time within the video when this race began
 *
 *      vend		Time within the video when this race ended
 *
 * 	mode		"VS" (future versions may support "battle")
 *
 * 	level		For mode == "vs", this is "50cc", "100cc", "150cc", or
 * 			"Extra".
 *
 * 	track		The name of the track raced.  The corresponding cup can
 * 			be obtained via the kTrackToCup() function.
 *
 *	players		Array of players in the race, in "player" order (e.g.,
 *			player 1, player2, and so on), each with the following
 *			fields:
 *
 *		char		Character name (e.g., "Yoshi")
 *
 *		person		Human player name
 *
 *		rank		Player's rank at the end of the race
 *
 *		time		Player's time on the race.  May be undefined if
 *				the player did not finish (i.e., last place).
 *
 * We provide a primitive, kEachRace(filter, iter), which invokes "iter" for all
 * races matching the given filter (a standard JS filter function, or "true").
 *
 * We also define a "segment" object with the following properties:
 *
 *     raceid		ID for race object
 *
 *     segnum		Segment number within the race
 *
 *     players		Array of players in the race in "player" order, each
 *     			with:
 *
 *		rank		Player's rank in this segment
 *
 *		lap		Lap number (currently, only 0 or 4 for
 *				"unknown" or "done")
 *
 *			For character and human names, you must look at
 *			race['players'].
 *
 *     duration		Length of this segment (milliseconds)
 *
 *     vstart		Time within the video when this segment started
 *
 *     vend		Time within the video when this segment ended
 *
 *     source		Link to an image showing the start of this segment
 *
 * and a function to iterate them, kEachSegment(filter, iter), with "filter" and
 * "iter" invoked as iter(race, segment) for each segment.
 *
 * Finally, we have an "event" object:
 *
 *     vtime		Time of this event within this video
 *
 *     rtime		Time of this event within this race
 *
 *     seg		Segment at the beginning of this event, if any
 *
 *     source		Link to an image showing this event
 *
 *     messages		Array of strings describing events occuring at this
 *     			time.
 *
 * and kRaceEvents(iter) with "iter" invoked as iter(race, event) for each
 * event.
 *
 * Future revisions may have other events within a race: e.g., slips on a banana
 * peel, rescues, power slide boosts, and so on.
 */

/*
 * Given a track name, returns the corresponding cup.
 */
var kTracks = {
    'Luigi Raceway': 'Mushroom',
    'Moo Moo Farm': 'Mushroom',
    'Koopa Troopa Beach': 'Mushroom',
    'Kalimari Desert': 'Mushroom',

    'Toad\'s Turnpike': 'Flower',
    'Frappe Snowland': 'Flower',
    'Choco Mountain': 'Flower',
    'Mario Raceway': 'Flower',

    'Wario Raceway': 'Star',
    'Sherbet Land': 'Star',
    'Royal Raceway': 'Star',
    'Bowser\'s Castle': 'Star',

    'DK\'s Jungle Parkway': 'Special',
    'Yoshi Valley': 'Special',
    'Banshee Boardwalk': 'Special',
    'Rainbow Road': 'Special'
};

function kTrackToCup(track)
{
	return (kTracks[track] || 'Unknown');
}

var kChars = {
    'mario': 'middle',
    'luigi': 'middle',
    'peach': 'light',
    'toad': 'light',
    'yoshi': 'light',
    'wario': 'heavy',
    'dk': 'heavy',
    'bowser': 'heavy'
};

function kCharToClass(character)
{
	if (kChars[character])
		return (kChars[character] + 'weight');

	return ('Unknown');
}

function kEachRace(filter, iter)
{
	var key, video;

	for (key in kVideos) {
		video = kVideos[key];

		if (video.state != 'done')
			continue;

		video.races.forEach(function (race, i) {
			var raceobj = makeRaceObject(video, race, i);
			if (filter === true || filter(raceobj))
				iter(raceobj);
		});
	}
}

function makeRaceObject(video, race, num)
{
	var racemeta, players, i, j, rv;

	racemeta = video.metadata.races[num];
	players = new Array(race.players.length);

	for (i = 0; i < race.players.length; i++) {
		players[i] = {
		    'char': race.players[i].character,
		    'person': racemeta.people[i],
		    'rank': race.results[i].position
		};
	}

	for (i = 0; i < race.segments.length; i++) {
		for (j = 0; j < players.length; j++) {
			if (players[j].hasOwnProperty('time'))
				continue;

			if (race.segments[i]['players'][j]['lap'] == 4)
				players[j]['time'] = race.segments[i].start -
				    race.start_time;
		}
	}

	for (j = 0; j < players.length; j++) {
		if (players[j].hasOwnProperty('time'))
			continue;

		if (players[j]['rank'] == players.length)
			continue;

		players[j]['time'] = race.end - race.start_time;
	}

	rv = {
	    'raceid': video.id + '/' + num,
	    'vidid': video.id,
	    'num': num,
	    'start_time': video.crtime + race.start_time,
	    'end_time': video.crtime + race.end_time,
	    'vstart': race.start_time,
	    'vend': race.end,
	    'duration': race.end - race.start_time,
	    'mode': race.mode,
	    'level': racemeta.level,
	    'track': race.track,
	    'players': players,
	    'start_source': frameImgHref(video.id, race.start_source),
	    'end_source': frameImgHref(video.id, race.end_source)
	};

	return (rv);
}

function kRaceSegments(raceobj, filter, iter)
{
	var race = kVideos[raceobj['vidid']].races[raceobj['num']];

	race.segments.forEach(function (seg, i) {
		var segobj = makeSegmentObject(race, seg, i, raceobj);
		if (filter === true || filter(raceobj, segobj))
			iter(raceobj, segobj);
	});
}

function kEachSegment(filter, iter)
{
	kEachRace(filter, function (raceobj) {
		kRaceSegments(raceobj, filter, iter);
	});
}

function makeSegmentObject(race, segment, i, raceobj)
{
	var rv = {
	    'raceid': raceobj['raceid'],
	    'segnum': i,
	    'players': segment.players.map(function (p) {
		return ({ 'rank': p.position, 'lap': p.lap });
	    }),
	    'duration': segment.end - segment.start,
	    'vstart': segment.start,
	    'vend': segment.end
	};

	if (segment.source)
		rv['source'] = frameImgHref(raceobj['vidid'],
		    segment['source']);

	return (rv);
}

function kRaceEvents(race, iter)
{
	var time = race['vstart'];
	var last, msgs;

	iter(race, {
	    'vtime': time,
	    'rtime': 0,
	    'seg': undefined,
	    'source': race['start_source'],
	    'messages': [ 'Race begins.' ]
	});

	kRaceSegments(race, true, function (_, seg) {
		if (last === undefined) {
			iter(race, {
			    'vtime': seg['vstart'],
			    'rtime': seg['vstart'] - time,
			    'seg': seg,
			    'source': seg['source'],
			    'messages': [ 'Initial position reading.' ]
			});

			last = seg;
			return;
		}

		msgs = [];
		compareSegments(race, last, seg, function (text) {
			msgs.push(text);
		});

		iter(race, {
		    'vtime': seg['vstart'],
		    'rtime': seg['vstart'] - time,
		    'seg': seg,
		    'source': seg['source'],
		    'messages': msgs
		});

		last = seg;
	});

	iter(race, {
	    'vtime': race['vend'],
	    'rtime': race['vend'] - time,
	    'source': race['end_source'],
	    'messages': [ 'Race ends.' ]
	});
}

function compareSegments(race, last, next, emit)
{
	var cn, lp, np;
	var i, j, inr, ilr, jnr, jlr;

	cn = race['players'].map(function (p) { return (ucfirst(p['char'])); });
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
				emit(cn[i] + ' passes ' + cn[j] + '.');
			} else if (inr > jnr && ilr < jlr) {
				emit(cn[j] + ' passes ' + cn[i] + '.');
			}
		}
	}

	for (i = 0; i < np.length; i++) {
		if (np[i]['lap'] == 4 && np[i]['lap'] != lp[i]['lap'])
			emit(cn[i] + ' finishes.');
	}
}
