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
/* jsl:import config.js */

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
var kKeithingThreshold = 5000;

/*
 * In "show" mode, the front page highlights only races within the last
 * kShowDuration (e.g., two days) of the latest race in the corpus.  Otherwise,
 * the same blocks show data from all time.  The implementation of these blocks
 * always uses kShowFilter, which is a filter function in "show" mode and just
 * "true" (to select all races) otherwise.
 */
var kShowMode = false;
var kShowFilter = true;				/* autoconfigured later */
var kShowDuration = 48 * 60 * 60 * 1000;	/* 48 hours */
var kShowSuffix = kShowMode ? ' (recent)' : '';
var kShowLabel = kShowMode ? 'Last 48 hours' : '';

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
	    'url': kUrlSummary,
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

		if (video.state == 'reading' ||
		    video.state == 'uploading' ||
		    video.state == 'transcoding')
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

	if (kShowMode) {
		var last = undefined;
		kEachRace(true, function (race) {
			if (last === undefined || race['start_time'] > last)
				last = race['start_time'];
		});

		if (last !== undefined) {
			kShowFilter = function (race) {
				return (last - race['start_time'] <
				    kShowDuration);
			};
		}
	}

	if (kForceRefresh || kScreenName == 'videos') {
		kDomUpdated.text(new Date());
		kScreenUpdate();
	}

	kForceRefresh = false;

	if (nreading > 0)
		setTimeout(kLoadData, 5000);
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

function kMakeDynamicTable(parent, header, opts, label)
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
	    (label ? '<div class="kDynamic kSubHeaderLabel">\n' +
	        label + '</div>\n' : '') +
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
	var dateraces = {};
	var slugfests = [];
	var wildfinishes = [];
	var photofinishes = [];
	var allitems = {};
	var itemsbyr0 = {};
	var itemsbyr1 = {};
	var latest;
	var rows, cols;

	var toptbl = $('<table class="kDynamic kSummaryBody"></table>');
	var tblrow = $('<tr></tr>');
	var tbldiv = $('<td class="kDynamic"></td>');

	var text = $([
	    '<td class="kDynamic">',
	    '<p class="kBodyText">Kartlytics.com records results and stats ',
	    'for Mario Kart 64 races.  The records here are automatically ',
	    'computed from screen captures of actual races.</p>',
	    '<p class="kBodyText">If you\'re ',
	    'wondering where to start, check out <a href="#races">the ',
	    'races</a> or the stats below.</p>',
	    '<p class="kBodyText">Videos are stored on the ',
	    '<a href="http://www.joyent.com/products/manta">Joyent ',
	    'Manta service</a>.  Video processing and data aggregation ',
	    'run as compute jobs in Manta without copying the videos.  For ',
	    'details on how this works, see the ',
	    '<a href="https://github.com/davepacheco/kartlytics">kartlytics ',
	    'github project</a>.</p>',
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
		var best;
		race['players'].forEach(function (p) {
			players[p['person']] = true;
			if (p['rank'] == 1 && p['time'] !== undefined)
				best = p['time'];
		});

		/* Identify most recent session. */
		var key = Math.floor(
		    race['start_time'] / (1000 * 60 * 60 * 24));
		if (!dateraces[key])
			dateraces[key] = [];
		dateraces[key].push(race);

		/* Compute slugfests. */
		var changes = 0;
		var endchanges = 0;
		var duration = race['vend'] - race['vstart'];

		kRaceSegments(race, true, function (_, seg) {
			/*
			 * Only count rank changes after the first 30 seconds,
			 * since there's often a lot of earlier jockeying that
			 * doesn't indicate an exciting race.
			 */
			if (seg['vstart'] - race['vstart'] > 30000)
				changes++;

			/*
			 * Tally up changes in the last 15 seconds to find
			 * exciting finishes.
			 */
			if (race['vend'] - seg['vend'] < 15000)
				endchanges++;

		});

		var sf = Object.create(race);
		race['cpm'] = changes / (duration - 30000);
		race['cend'] = endchanges;
		race['finish_delta'] = best !== undefined &&
		    duration - best > 0 ? duration - best : Infinity;

		if (typeof (kShowFilter) != 'function' || kShowFilter(race)) {
			slugfests.push(sf);
			wildfinishes.push(sf);
			photofinishes.push(sf);
		}

		/* update item distribution */
		/* XXX copied from js/kartvid.js */
		if (race['itemstates'].length != 4)
			return;

		race['itemstates'].forEach(function (p) {
			p.forEach(function (evt) {
				allitems[evt['item']] = true;

				if (!evt['r0'] || !evt['r1'])
					return;

				if (!itemsbyr0[evt['r0']])
					itemsbyr0[evt['r0']] = {};
				if (!itemsbyr0[evt['r0']][evt['item']])
					itemsbyr0[evt['r0']][
					    evt['item']] = 0;
				itemsbyr0[evt['r0']][evt['item']]++;

				if (!itemsbyr1[evt['r1']])
					itemsbyr1[evt['r1']] = {};
				if (!itemsbyr1[evt['r1']][evt['item']])
					itemsbyr1[
					    evt['r1']][evt['item']] = 0;
				itemsbyr1[evt['r1']][evt['item']]++;
			});
		});
	});

	metadata.push([ 'Total races', kmktypelink(nraces, 'races') ]);
	metadata.push([ 'Total players',
	    kmktypelink(Object.keys(players).length, 'players') ]);
	kTable(tbldiv, metadata,
	    [ { 'sClass': 'kDataLabel' }, { 'sClass': 'kDataValue' } ],
	    { 'title': 'Summary' });

	if (nraces === 0)
		return;

	/* popular track table */
	kDataTable({
	    'parent': tbldiv,
	    'entries': kRaces(kShowFilter),
	    'columns': [ 'Track', 'NR' ],
	    'group_by': [ 'Track' ],
	    'sort': function (a, b) { return (b[1] - a[1]); },
	    'limit': kShowMode ? 6 : 7,
	    'options': {
		'title': 'Popular tracks',
		'label': kShowLabel,
	        'dtOptions': {
	            'aaSorting': [ [1, 'desc'] ]
	        }
	    }
	});

	toptbl = $('<table class="kDynamic kColumns"></table>');
	tblrow = $('<tr></tr>');
	tbldiv = $('<td class="kDynamic"></td>');
	kDomConsole.append(toptbl);
	toptbl.append(tblrow);
	tblrow.append(tbldiv);

	/* wildest finishes table */
	wildfinishes.sort(function (a, b) { return (b['cend'] - a['cend']); });
	wildfinishes = wildfinishes.slice(0, 5);
	cols = kColumnsByName([ 'SDate', 'NPl', 'Lvl', 'Track' ]);
	cols.push({
	    'sTitle': 'Changes',
	    'sClass': 'kDataRaceTime',
	    '_conf': {
	        'extract': function (race) {
			return (race['cend']);
		}
	    }
	});
	rows = wildfinishes.map(kExtractValues.bind(null, cols));
	kTable(tbldiv, rows, cols, {
	    'title': 'Wildest finishes' + kShowSuffix,
	    'label': 'By number of rank changes in the last ' +
	        '15 seconds',
	    'dtOptions': {
	        'aaSorting': [ [ 4, 'desc' ] ]
	    }
	});

	tbldiv = $('<td class="kDynamic"></td>');
	tblrow.append(tbldiv);

	/* photo finishes */
	photofinishes.sort(function (a, b) {
	    return (a['finish_delta'] - b['finish_delta']);
	});
	photofinishes = photofinishes.slice(0, 5);
	cols = kColumnsByName([ 'SDate', 'NPl', 'Lvl', 'Track' ]);
	cols.push({
	    'sTitle': 'Delta',
	    'sClass': 'kDataRaceTime',
	    '_conf': {
	        'extract': function (race) {
			return (kDuration(race['finish_delta'], true));
		}
	    }
	});
	rows = photofinishes.map(kExtractValues.bind(null, cols));
	kTable(tbldiv, rows, cols, {
	    'title': 'Photo finishes' + kShowSuffix,
	    'label': '&nbsp;',
	    'dtOptions': {
	        'aaSorting': [ [ 4, 'asc' ] ]
	    }
	});

	tblrow = $('<tr></tr');
	toptbl.append(tblrow);

	tbldiv = $('<td class="kDynamic"></td>');
	tblrow.append(tbldiv);

	/* slugfests table */
	slugfests.sort(function (a, b) { return (b['cpm'] - a['cpm']); });
	slugfests = slugfests.slice(0, 5);
	cols = kColumnsByName([ 'SDate', 'NPl', 'Lvl', 'Track' ]);
	cols.push({
	    'sTitle': 'CPM',
	    'sClass': 'kDataRaceTime',
	    '_conf': {
	        'extract': function (race) {
			return ((race['cpm'] * 1000 * 60).toFixed(2));
		}
	    }
	});
	rows = slugfests.map(kExtractValues.bind(null, cols));
	kTable(tbldiv, rows, cols, {
	    'title': 'Wildest races' + kShowSuffix,
	    'label': 'By number of rank changes per minute ' +
	        'after the first 30 seconds',
	    'dtOptions': {
	        'aaSorting': [ [ 4, 'desc' ] ]
	    }
	});

	tbldiv = $('<td class="kDynamic"></td>');
	tblrow.append(tbldiv);

	/* latest session table */
	latest = Math.max.apply(null, Object.keys(dateraces));
	kDataTable({
	    'parent': tbldiv,
	    'entries': dateraces[latest].slice(0, 10),
	    'columns': [ 'SDate', 'NPl', 'Lvl', 'Track', 'WinH' ],
	    'options': { 'title': 'Latest session', 'label': '&nbsp;' }
	});

	/* item information */
	if (!kShowMode)
		kMakeItemGraph(kDomConsole, allitems, itemsbyr0,
		    'item box hit');
	kMakeItemGraph(kDomConsole, allitems, itemsbyr1, 'item received');
}

function kMakeItemGraph(dom, allitems, itemsbyr, label)
{
	var div, id;

	$('<div class="kDynamic kSubHeader">Item distribution by ' +
	    'player\'s rank when ' + label + '</div>\n').appendTo(dom);
	$('<div class="kDynamic kSubHeaderLabel">For races with ' +
	    '4 players, all-time</div>').appendTo(dom);
	div = $('<div class="kDynamic kItemGraphWidget"></div>');
	div.appendTo(dom);
	id = 'graph' + kId++;
	$('<div class="kDynamic kItemGraph" id="' + id + '"></div>').
	    appendTo(div);

	var margin = {
	    'top': 20,
	    'right': 20,
	    'bottom': 30,
	    'left': 40
	};
	var width = $(div).find('.kItemGraph').width() -
	    margin['left'] - margin['right'];
	var height = $(div).height() - margin['top'] - margin['bottom'];
	var x = d3.scale.ordinal().rangeRoundBands([ 0, width ], 0.1);
	var y = d3.scale.linear().rangeRound([ height, 0 ]);
	var color = d3.scale.ordinal().range(
	    kItems.map(function (i) { return (kItemColors[i]); }));
	var labels = d3.scale.ordinal().range(kItems.map(ucfirst));
	var xAxis = d3.svg.axis().scale(x).orient('bottom');
	var yAxis = d3.svg.axis().scale(y).orient('left').
	    tickFormat(d3.format('.0%'));
	var svg = d3.selectAll('#' + id).append('svg').
	    attr('width', width + margin['left'] + margin['right']).
	    attr('height', height + margin['top'] + margin['bottom']).
	    append('g').attr('transform',
		'translate(' + margin['left'] + ',' + margin['top'] + ')');
	var data, item, yy, row, r;

	color.domain(kItems);

	data = [];
	for (r in itemsbyr) {
		yy = 0;
		row = {
		    'Rank': ordinal(r),
		    'items': []
		};
		color.domain().forEach(function (itemname) {
			var barheight = itemsbyr[r][itemname] || 0;
			row['items'].push({
			    'name': itemname,
			    'y0': yy,
			    'y1': yy + barheight
			});
			yy += barheight;
		});
		row['items'].forEach(function (d) {
			d['y0'] /= yy;
			d['y1'] /= yy;
		});
		data.push(row);
	}

	x.domain(data.map(function (d) { return (d.Rank); }).sort());
	svg.append('g').attr('class', 'x axis').
	    attr('transform', 'translate(0,' + height + ')').call(xAxis);
	svg.append('g').attr('class', 'y axis').call(yAxis);
	item = svg.selectAll('.item').data(data).enter().
	    append('g').attr('class', 'item').attr('transform', function (d) {
		return ('translate(' + x(d['Rank']) + ',0)');
	    });
	item.selectAll('rect').data(function (d) { return (d['items']); }).
	    enter().append('rect').attr('width', x.rangeBand()).
	    attr('y', function (d) { return (y(d['y1'])); }).
	    attr('height', function (d) { return (y(d['y0']) - y(d['y1'])); }).
	    style('fill', function (d) { return (color(d['name'])); }).
	    append('svg:title').text(function (d) {
	        var pct = (100 * (d.y1 - d.y0)).toFixed(1);
		return (labels(d.name) + ' (' + pct + '%)');
	    });

	kMakeDynamicTable(div, '', {
	    'bSort': false,
	    'aoColumns': [ {
	        'sClass': 'kDataItemColor'
	    }, {
		'sTitle': 'Item',
		'sClass': 'kDataItemLabel'
	    }, {
		'sTitle': '1st',
		'sClass': 'kDataItemCount'
	    }, {
		'sTitle': '2nd',
		'sClass': 'kDataItemCount'
	    }, {
		'sTitle': '3rd',
		'sClass': 'kDataItemCount'
	    }, {
		'sTitle': '4th',
		'sClass': 'kDataItemCount'
	    } ],
	    'aaData': kItems.slice(0).reverse().map(function (itemname) {
		return ([
		    '<div class="kItemSquare"></div>',
		    ucfirst(itemname),
		    itemsbyr['1'] && itemsbyr['1'][itemname] ?
		        itemsbyr['1'][itemname] : 0,
		    itemsbyr['2'] && itemsbyr['2'][itemname] ?
		        itemsbyr['2'][itemname] : 0,
		    itemsbyr['3'] && itemsbyr['3'][itemname] ?
		        itemsbyr['3'][itemname] : 0,
		    itemsbyr['4'] && itemsbyr['4'][itemname] ?
		        itemsbyr['4'][itemname] : 0,
		    itemname
		]);
	    }),
	    'fnCreatedRow': function (tr, rowdata) {
		$(tr).find('.kItemSquare').css('background-color',
		    kItemColors[rowdata[6].toLowerCase()]);
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
	if (args.length < 1) {
		kScreenDefault();
		return;
	}

	var pname = args[0];
	var races = kRaces(function (race) {
		for (var i = 0; i < race.players.length; i++) {
			if (race.players[i]['person'] == pname)
				return (true);
		}

		return (false);
	});

	kScreenTitle('Player: ' + pname);

	/* races by char */
	kDataTable({
	    'parent': kDomConsole,
	    'columns': [ 'Char', 'NR', '%', '%V', 'N1st', 'N2nd', 'N3rd',
	        'N4th' ],
	    'group_by': [ 'Char' ],
	    'entries': races,
	    'extract_args': [ pname, races.length ],
	    'options': {
	        'title': 'Races by character'
	    }
	});

	/* races by character class */
	kDataTable({
	    'parent': kDomConsole,
	    'columns': [ 'CharClass', 'NR', '%', '%V', 'N1st', 'N2nd', 'N3rd',
	        'N4th' ],
	    'group_by': [ 'CharClass' ],
	    'entries': races,
	    'extract_args': [ pname, races.length ],
	    'options': {
	        'title': 'Races by character class'
	    }
	});

	/* races by track */
	kDataTable({
	    'parent': kDomConsole,
	    'columns': [ 'Track', 'Time', 'NR', 'N1st', 'N2nd', 'N3rd',
	        'N4th' ],
	    'group_by': [ 'Track' ],
	    'entries': races,
	    'extract_args': [ pname ],
	    'aggregate': {
	        'Time': function (t1, t2) {
			if (t1 === 0 || t1 === undefined)
				return (t2);
			if (t2 === 0 || t2 === undefined)
				return (t1);
			return (t1 < t2 ? t1 : t2);
		}
	    },
	    'options': {
		'title': 'Races by track'
	    }
	});

	/* all races */
	kDataTable({
	    'parent': kDomConsole,
	    'columns': [ 'Date', 'Lvl', 'NPl', 'Rank', 'Time', 'Mode',
	        'Pl', 'Char', 'CharClass', 'Track', 'Cup' ],
	    'entries': races,
	    'extract_args': [ pname ],
	    'options': {
	        'title': 'Races',
	        'dtOptions': {
	            'bFilter': true
	        }
	    }
	});
}

function kScreenPlayersLoad(args)
{
	kScreenTitle('Players');

	var rows = [];
	var keithings = [];
	var cols;
	kRaces(true).forEach(function (race) {
		race['players'].forEach(function (p) {
			var rv = Object.create(race);
			rv['_player'] = p['person'];
			rows.push(rv);
		});

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

			if (rlast !== undefined && kbyp[rlast] &&
			    seg['vstart'] - kbyp[rlast] < kKeithingThreshold) {
				if (seg['vstart'] - kbyp[rlast] > 0) {
					keithings.push({
					    'race': race,
					    'prev': kbyp[rlast],
					    'segment': seg,
					    'player': rlast
					});
				}

				kbyp[rlast] = 0;
			}

			kbyp[r1] = seg['vend'];
		});

	});

	kDataTable({
	    'parent': kDomConsole,
	    'entries': rows,
	    'columns': [ 'H', 'NR', 'N1st', 'N2nd', 'N3rd', 'N4th', 'RTime'],
	    'group_by': [ 'H' ],
	    'extract_args': function (race) { return ([ race['_player'] ]); }
	});

	/* keithings table */
	keithings = keithings.map(function (k) {
		var rv = Object.create(k['race']);
		rv['who'] = kmklink(
		    rv['players'][k['player']]['person'], 'player');
		rv['from'] = kDuration(k['prev'] - rv['vstart'], true);
		rv['to'] = kDuration(
		    k['segment']['vstart'] - rv['vstart'], true);
		rv['over'] = kDuration(
		    k['segment']['vstart'] - k['prev'], true);
		return (rv);
	});
	cols = kColumnsByName([ 'Date', 'NPl', 'Lvl', 'Track' ]);
	cols = cols.concat([ {
	    'sTitle': 'H',
	    'sClass': 'kDataRaceName',
	    '_conf': { 'extract': function (row) { return (row['who']); } }
	}, {
	    'sTitle': 'From',
	    'sClass': 'kDataRaceTime',
	    '_conf': { 'extract': function (row) { return (row['from']); } }
	}, {
	    'sTitle': 'To',
	    'sClass': 'kDataRaceTime',
	    '_conf': { 'extract': function (row) { return (row['to']); } }
	}, {
	    'sTitle': 'Over',
	    'sClass': 'kDataRaceTime',
	    '_conf': { 'extract': function (row) { return (row['over']); } }
	} ]);
	rows = keithings.map(kExtractValues.bind(null, cols));
	kTable(kDomConsole, rows, cols, {
	    'title': 'Keithings',
	    'label': 'Moving from 1st to 4th in less than ' +
	        (kKeithingThreshold / 1000) + ' seconds'
	});
}

/*
 * Race details screen
 */
function kScreenRaceLoad(args)
{
	var vidid, raceid, racename, filter, video, webmurl, raceobj;
	var metadata = [], players = [], events = [];
	var graphrows = [];

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
		raceobj = race;

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
				var graphrow = {
				    'rtime': evt['rtime']
				};
				evt['seg']['players'].forEach(function (p, i) {
				    graphrow['P' + (i + 1)] = p['rank'];
				});
				graphrows.push(graphrow);

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

	$('<table class="kDynamic" style="width: 100%">' +
	    '<tr>' +
	    '<td id="kRaceMetadata" style="width: 50%"></td>' +
	    '<td id="kRaceVideo" style="width: 50%"></td>' +
	    '</tr>' +
	    '</table>').appendTo(kDomConsole);

	kMakeDynamicTable($('td#kRaceMetadata'), '', {
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
			klink($(tr).find('td.kDataValue'), 'tracks');
	    }
	});

	kDataTable({
	    'parent': $('td#kRaceMetadata'),
	    'entries': raceobj['players'].map(function (p) {
		var rv = Object.create(raceobj);
		rv['_player'] = p['person'];
	        return (rv);
	    }),
	    'columns': [ 'Pl', 'H', 'Char', 'Rank', 'Time' ],
	    'extract_args': function (r) { return (r['_player']); },
	    'options': {
	        'title': 'Players'
	    }
	});

	webmurl = kUrlBaseData + '/' + video.name + '/webm/' + args[1] +
	    '.webm';
	$('td#kRaceVideo').append(
	    '<video width="320" height="240" controls="controls">' +
	    '<source src="' + webmurl + '" type="video/webm" />' +
	    '</video>');

	kRaceGraph(kDomConsole, raceobj, graphrows);

	var eventCols = [ {
	    'bVisible': false
	}, {
	    'sTitle': 'Vtime',
	    'sClass': 'kDataRaceTime'
	}, {
	    /* XXX express these in terms of webm video start? */
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

function kRaceGraph(dom, race, data)
{
	var div, id;

	$('<div class="kDynamic kSubHeader">Ranks over time</div>').
	    appendTo(dom);
	id = 'id' + (kId++);
	div = $('<div class="kDynamic kRaceGraph" id="' + id + '"></div>');
	div.appendTo(dom);

	var margin = {
	    'top': 20,
	    'right': 80,
	    'bottom': 30,
	    'left': 50
	};
	var width = $(div).width() - margin['left'] - margin['right'];
	var height = $(div).height() - margin['top'] - margin['bottom'];
	var x = d3.scale.linear().range([ 0, width ]);
	var y = d3.scale.linear().range([ height, 0 ]);
	var color = d3.scale.category10();
	var xAxis = d3.svg.axis().scale(x).orient('bottom').
	    tickFormat(function (d) { return (kDuration(d, false)); });
	var yAxis = d3.svg.axis().scale(y).orient('left').tickFormat(
	    function (d) { return (ordinal(Math.round(d).toString())); });
	var line = d3.svg.line().interpolate(kd3_interpolate_step_angledrisers).
	    x(function (d) { return (x(d['rtime'])); }).
	    y(function (d) { return (y(d['rank'])); });
	var svg = d3.select('#' + id).append('svg').
	    attr('width', width + margin['left'] + margin['right']).
	    attr('height', height + margin['top'] + margin['bottom']).
	    append('g').attr('transform',
	        'translate(' + margin['left'] + ',' + margin['top'] + ')');
	var players, player;

	color.domain(d3.keys(data[0]).filter(
	    function (key) { return (key !== 'rtime'); }));
	yAxis.ticks(color.domain().length - 1);
	players = color.domain().map(function (name) {
		return ({
		    'name': ordinal(name),
		    'values': data.map(function (d) {
			return ({ 'rtime': d['rtime'], 'rank': d[name] });
		    })
		});
	});
	x.domain(d3.extent(data, function (d) { return d['rtime']; }));
	y.domain([
	    d3.max(players, function (c) {
		return (d3.max(c['values'],
		    function (v) { return (v['rank']); }));
	    }),
	    d3.min(players, function (c) {
		return (d3.min(c['values'],
		    function (v) { return (v['rank']); }));
	    })
	]);

	svg.append('g').attr('class', 'x axis').
	    attr('transform', 'translate(0,' + height + ')').call(xAxis);
	svg.append('g').attr('class', 'y axis').call(yAxis).append('text').
	    attr('transform', 'rotate(-90)').
	    attr('x', -35). attr('y', -45).attr('dy', '.71em').
	    style('text-anchor', 'end').text('Rank');

	player = svg.selectAll('.player').data(players).enter().append('g').
	    attr('class', 'player');
	player.append('path').attr('class', 'line').
	    attr('d', function (d) { return line(d['values']); }).
	    style('stroke', function (d) { return color(d['name']); });
	player.append('text').datum(function (d) {
		return ({
		    'name': d['name'],
		    'value': {
			'rtime': d['values'][0]['rtime'],
			'rank': d['values'][0]['rank']
		    }
		});
	    }).attr('transform', function (d) {
		return ('translate(' +
		    x(d.value.rtime) + ',' + y(d.value.rank - 0.3) + ')');
	    }).attr('x', 3).attr('dy', '.35em').
	    text(function (d) { return (d['name']); });

	player.append('text').datum(function (d) {
	        return ({
		    'name': d['name'],
		    'value': {
			'rtime': d['values'][d['values'].length - 1]['rtime'],
			'rank': d['values'][d['values'].length - 1]['rank']
		    }
		});
	    }).attr('transform', function (d) {
		return ('translate(' +
		    x(d['value']['rtime']) + ',' +
		    y(d['value']['rank'] - 0.3) + ')');
	    }).attr('x', 3).attr('dy', '.35em').
	    text(function (d) { return d['name']; });
}

/*
 * "All races" screen
 */
function kScreenRacesLoad(args)
{
	kScreenTitle('All races');

	kDataTable({
	    'parent': kDomConsole,
	    'entries': kRaces(true),
	    'columns': [ 'Date', 'NPl', 'Mode', 'Lvl', 'Track', 'RTime' ],
	    'options': {
	        'title': 'All races',
		'dtOptions': {
		    'bFilter': true,
		    'bInfo': true,
		    'oLanguage': {
		        'sEmptyTable': 'No races found.',
		        'sInfo': 'Showing _START_ to _END_ of _TOTAL_ races',
		        'sInfoFiltered': ' (from _MAX_ total races)',
		        'sInfoPostFix': '.',
		        'sZeroRecords': 'No matching races.'
		    }
		}
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

	var scrollto;
	var tracks = Object.keys(racesbytrack);
	tracks.sort();

	tracks.forEach(function (track) {
		var table = kMakeDynamicTable(kDomConsole, track, {
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

		if (track == args[0])
			scrollto = table;
	});

	if (scrollto)
		setTimeout(function () { scrollto[0].scrollIntoView(); }, 0);
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
			var vidurl = kUrlBaseVideos + '/' + video.name;
			td = $(tr).find('td.kDataValue');
			$(td).html('<a href="' + vidurl + '">' +
			    $(td).text() + '</a>');
			return;
		}
	    }
	});

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
		klink($(tr).find('td.kDataRaceTrack'), 'tracks');
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
	    'aaSorting': [[ 4, 'desc' ]],
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

		if (data[0].state == 'reading' ||
		    data[0].state == 'uploading') {
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
		if (!race.vend)
			return;

		var code = racecode.replace(/\$id/g, i);
		var tbody = $(div).find('table.kPropertyTable > tbody');
		var pcode = $('<table class="kPlayerTable"></table>');
		var data = race.players.map(function (p, j) {
			var result = ordinal(race.players[j].rank);
			return ([ 'P' + (j + 1), ucfirst(p.char),
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
		var time = kDuration(race.vstart, true);
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
	/* Import is not yet supported on Manta */
	alert('Unauthorized');
}

function kReprocessVideo(vidid)
{
	/* Reprocess not supported on Manta */
	alert('Unauthorized');
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

function kmktypelink(text, type)
{
	return ('<a href="#' + type + '">' + text + '</a>');
}

function kmklink(text, type, ident)
{
	if (!ident)
		ident = text;
	return ('<a href="#' + type + '/' + ident + '">' + text + '</a>');
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

function frameImgHref(vidname, frame)
{
	if (!frame)
		return ('');

	return (kUrlBaseData + '/' + vidname + '/pngs/' +
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

var kItemColors = {
    'banana bunch': '#E6E600',
    'banana peel': '#F2F280',
    'blue shell': '#003399',
    'fake item': '#9999FF',
    'ghost': '#B2B2B2',
    'green shell': '#66C285',
    'lightning': '#FFD633',
    'red shell': '#FF3300',
    'single mushroom': '#FFD6CC',
    'star': '#FF9900',
    'super mushroom': '#FFCC66',
    'three green shells': '#009933',
    'three mushrooms': '#FF9980',
    'three red shells': '#CC2900'
};

/* These are sorted in increasing order of goodness. */
var kItems = [
    'banana peel',
    'green shell',
    'single mushroom',
    'fake item',
    'red shell',
    'ghost',
    'banana bunch',
    'three mushrooms',
    'three red shells',
    'star',
    'super mushroom',
    'lightning',
    'three green shells',
    'blue shell'
];

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

function kWinner(race)
{
	for (var i = 0; i < race['players'].length; i++) {
		if (race['players'][i]['rank'] == 1)
			return (i);
	}

	return (-1);
}

function kPlayer(race, name)
{
	for (var i = 0; i < race['players'].length; i++) {
		if (race['players'][i]['person'] == name)
			return (i);
	}

	return (-1);
}

function kEachRace(filter, iter)
{
	var key, video;

	for (key in kVideos) {
		video = kVideos[key];

		if (!video.metadata)
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
	var racemeta, rv;

	racemeta = video.metadata.races[num];

	rv = {
	    'raceid': race.raceid,
	    'vidid': race.vidid,
	    'num': race.num,
	    'start_time': race.start_time,
	    'end_time': race.end_time,
	    'vstart': race.vstart,
	    'vend': race.vend,
	    'duration': race.duration,
	    'mode': race.mode,
	    'level': racemeta.level,
	    'track': race.track,
	    'players': race.players,
	    'itemstates': race.itemstates,
	    'start_source': frameImgHref(video.name, race.start_source),
	    'end_source': frameImgHref(video.name, race.end_source)
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
	    'raceid': segment['raceid'],
	    'segnum': segment['segnum'],
	    'players': segment['players'],
	    'duration': segment['duration'],
	    'vstart': segment['vstart'],
	    'vend': segment['vend']
	};

	if (segment['source'])
		rv['source'] = frameImgHref(
		    kVideos[raceobj['vidid']].name,
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

/*
 * Higher-level table interface.  Arguments include:
 *
 *	select		filter function for selecting races
 *
 *	columns		array of columns, either string identifiers or custom
 *     			column configuration
 *
 *	title		table title
 *
 *	label		description of the table, to appear under the title
 *
 * XXX how can we use this (or something else) to make tables that aggregate
 * races by fields?
 */
function kRaceTable(args)
{
}

/*
 * We have several types of objects: video, race, player, and track.  For each
 * object we have several standard columns, each of which includes a header,
 * styling, etc.  Most of the tables we want to show fall into one of two
 * categories:
 *
 *    - object lists: tables with 1 row per object of a given type (possibly
 *      filtered) with an arbitrary set of columns (e.g., all races, or all
 *      races for a particular track)
 *
 *    - summary tables: tables where objects of a given type (possibly filtered)
 *      are grouped by some field and the selected columns aggregated (e.g., all
 *      races by track, or races for a particular track broken down by winning
 *      player)
 *
 * XXX make two generic functions for these, but don't conflate that with the
 * part that actually fetches the right rows and column config, because there
 * are actually other types of tables that don't make sense to be their own
 * "object" (e.g., characters).
 *
 * suggestion: to make a list-of-races table, you'd do:
 *
 *     races = kRaces(filter);
 *     columns = kRaceColumns([ 'Date', 'NPl', 'Mode', 'Lvl', 'Track' ]);
 *     rows = races.map(kRaceExtract.bind(null, columns));
 *     table = kTable(rows, columns);
 *
 * to make a summary of races table, you'd do:
 *
 *     races = kRaces(filter);
 *     columns = kRaceColumns([ 'Track', 'NR' ]);
 *     inputs = races.map(kRaceExtract.bind(null, columns));
 *     rows = kRowsAggregate(inputs, columns, [ 'Track' ]);
 *     table = kTable(rows, columns);
 *
 *     XXX aggregate should support operations like "+" as well as "best"
 *
 * you can also aggregate by multiple dimensions.  For example, to show the
 * total number of races in each mode, level, and #players (e.g., "4P 150cc
 * VS"), you'd aggregate on all three of these columns:
 *
 *     races = kRaces(filter);
 *     columns = kRaceColumns([ 'NPl', 'Mode', 'Lvl', 'NR' ]);
 *     inputs = races.map(kRaceExtract.bind(null, columns));
 *     rows = kRowsAggregate(inputs, columns, [ 'NPl', 'Mode', 'Lvl' ]);
 *
 * As an example of using a different type of object, to make the
 * characters-by-percentages-played table, you'd do this:
 *
 *	races = kRaces(filter);
 *	columns = kPlayerColumns([ 'Char', '%', 'NR' ]);
 *	inputs = races.map(kPlayerExtract.bind(null, 'dap', columns));
 *	rows = kRowsAggregate(inputs, columns, [ 'Char' ]);
 *
 * To do something special like keithings, you'd do a little more work:
 *
 *      // Start with a bunch of races.  For each race, there may be 0 or more
 *      // keithings, each of which looks like a race object with some extra
 *      // fields.
 *      races = kRaces(filter);
 *      keithings = ...
 *
 *	// Use a combination of standard and custom columns.
 *      columns = kRaceColumns([ 'Date', 'NPl', 'Mode', 'Lvl', 'Track',
 *          {
 *		'label': 'Who',
 *		...
 *          }, { 'label': 'From', ... }, ... ] );
 *
 *      // The custom column definition has to say how to extract each column
 *      // from the input object, so kRaceExtract still works.
 *      // XXX should it just be kObjectExtract? What about the above
 *      // kPlayerExtract?
 *      inputs = keithings.map(kRaceExtract.bind(null, columns));
 *
 * For a list of keithings, at this point, it's just:
 *
 *	table = kTable(inputs, columns);
 *
 * For a summary of keithings, as by player, it's:
 *
 * 	rows = kRowsAggregate(inputs, columns, [ 'Who' ]);
 * 	table = kTable(rows, columns);
 *
 * XXX add types, documentation, and how to extract them
 */
function kFormatPercentage(val)
{
	return ((100 * val['num'] / val['denom']).toFixed(1));
}

function kFormatFraction(val)
{
	return ((val['num'] / val['denom']).toFixed(2));
}

function kAggregateFractions(v1, v2)
{
	return ({
	    'num': v1['num'] + v2['num'],
	    'denom': v1['denom'] + v2['denom']
	});
}

function kExtractRankTime(rank, race, name)
{
	var which = kPlayer(race, name);
	if (which == -1)
		return ({ 'num': 0, 'denom': 0 });

	var postime = 0, tottime = 0;
	kRaceSegments(race, true, function (_, seg) {
		if (seg['players'][which]['rank'] == rank)
			postime += seg['duration'];
		tottime += seg['duration'];
	});
	return ({ 'num': postime, 'denom': tottime });
}

var kColumns = {
	/* Generic fields */
	'%': {
		'sClass': 'kDataPlayerPercentage',
		'extract': function (_1, _2, nrows) {
			return (100 / nrows);
		},
		'format': function (value) {
			return (value.toFixed(1));
		}
	},
	'%V': {
		'sTitle': '',
		'sClass': 'kDataPlayerPercentageBar',
		'extract': function (_1, _2, nrows) {
			return (100 / nrows);
		},
		'format': function (value) {
			return ('<div class="kDataBar" style="width: ' +
			    Math.round(value) + '%"></div>');
		}
	},

	/* Per-race fields */
	'Cup': {
		'sClass': 'kDataRaceCup',
		'extract': function (race) {
			return (kTrackToCup(race['track']));
		}
	},
	'SDate': {
		'sTitle': 'Date',
		'sClass': 'kDataRaceDate',
		'extract': function (race) {
			var text = kDateTime(race['start_time']);
			if (kShowMode)
				text = text.substr(5);
			return (kmklink(text, 'race', race['raceid']));
		}
	},
	'Date': {
		'sClass': 'kDataRaceDate',
		'extract': function (race) {
			return (kmklink(kDateTime(race['start_time']),
			    'race', race['raceid']));
		}
	},
	'Lvl': {
		'sClass': 'kDataRaceLvl',
		'extract': function (race) {
			if (race['level'] == 'unknown')
				return ('-');
			return (race['level'] || '-');
		}
	},
	'Mode': {
		'sClass': 'kDataRaceMode',
		'extract': function (race) { return (race['mode']); }
	},
	'NPl': {
		'sClass': 'kDataRaceNPl',
		'extract': function (race) {
			return (race['players'].length + 'P');
		}
	},
	'NR': {
		'sClass': 'kDataPlayerNum',
		'extract': function () { return (1); }
	},
	'Track': {
		'sClass': 'kDataRaceTrack',
		'extract': function (race) {
			return (kmklink(race['track'], 'tracks'));
		}
	},
	'WinC': {
		'sClass': 'kDataPlayerCharacter',
		'extract': function (race) {
			var which = kWinner(race);
			return (ucfirst(race['players'][which]['char']));
		}
	},
	'WinH': {
		'sClass': 'kDataPlayerName',
		'extract': function (race) {
			var which = kWinner(race);
			var name = race['players'][which]['person'];
			return (kmklink(name, 'player'));
		}
	},

	/*
	 * XXX one-off fields:
	 * - char, human, and time for best race on a given track
	 * - points-per-race
	 */

	/* Fields based on a (race, player) tuple */
	'Char': {
		'sClass': 'kDataRaceChar',
		'extract': function (race, name) {
			var which = kPlayer(race, name);
			return (ucfirst(race['players'][which]['char']));
		}
	},
	'CharClass': {
		'sClass': 'kDataRaceCharClass',
		'extract': function (race, name) {
			var which = kPlayer(race, name);
			return (ucfirst(kCharToClass(
			    race['players'][which]['char'])));
		}
	},
	'H': {
		'sClass': 'kDataPlayerName',
		'extract': function (_, name) {
			return (name);
		},
		'format': function (name) {
			return (kmklink(name, 'player'));
		}
	},
	'%1st': {
		'sClass': 'kDataPlayerPercentage',
		'extract': kExtractRankTime.bind(null, 1),
		'format': kFormatPercentage
	},
	'%2nd': {
		'sClass': 'kDataPlayerPercentage',
		'extract': kExtractRankTime.bind(null, 2),
		'format': kFormatPercentage
	},
	'%3rd': {
		'sClass': 'kDataPlayerPercentage',
		'extract': kExtractRankTime.bind(null, 3),
		'format': kFormatPercentage
	},
	'%4th': {
		'sClass': 'kDataPlayerPercentage',
		'extract': kExtractRankTime.bind(null, 4),
		'format': kFormatPercentage
	},
	'N1st': {
		'sClass': 'kDataPlayerNum',
		'extract': function (race, name) {
			var which = kPlayer(race, name);
			if (which == -1)
				return (0);
			return (race['players'][which]['rank'] == '1' ? 1 : 0);
		}
	},
	'N2nd': {
		'sClass': 'kDataPlayerNum',
		'extract': function (race, name) {
			var which = kPlayer(race, name);
			if (which == -1)
				return (0);
			return (race['players'][which]['rank'] == '2' ? 1 : 0);
		}
	},
	'N3rd': {
		'sClass': 'kDataPlayerNum',
		'extract': function (race, name) {
			var which = kPlayer(race, name);
			if (which == -1)
				return (0);
			return (race['players'][which]['rank'] == '3' ? 1 : 0);
		}
	},
	'N4th': {
		'sClass': 'kDataPlayerNum',
		'extract': function (race, name) {
			var which = kPlayer(race, name);
			if (which == -1)
				return (0);
			return (race['players'][which]['rank'] == '4' ? 1 : 0);
		}
	},
	'Pl': {
		'sClass': 'kDataRacePl',
		'extract': function (race, name) {
			return ('P' + (kPlayer(race, name) + 1));
		}
	},
	'Pts': {
		'sClass': 'kDataPlayerNum',
		'extract': function (race, name) {
			var which = kPlayer(race, name);
			if (which == -1)
				return (0);
			var rank = race['players'][which]['rank'];
			return (rank == 4 ? 1 : 3 * (4 - rank));
		}
	},
	'PPR': {
		'sClass': 'kDataPlayerNum',
		'extract': function (race, name) {
			var which = kPlayer(race, name);
			if (which == -1)
				return ({ 'num': 0, 'denom': 0 });
			var rank = race['players'][which]['rank'];
			return ({
			    'num': rank == 4 ? 1 : 3 * (4 - rank),
			    'denom': 1
			});
		},
		'format': kFormatFraction
	},
	'Rank': {
		'sClass': 'kDataRaceRank',
		'extract': function (race, name) {
			var which = kPlayer(race, name);
			if (which == -1)
				return (0);
			return (ordinal(race['players'][which]['rank']));
		}
	},
	'RTime': {
		'sClass': 'kDataPlayerTime',
		'extract': function (race) {
			return (race['duration']);
		},
		'format': function (time) {
			return (kDuration(time, false));
		}
	},
	'Time': {
		'sClass': 'kDataRaceTime',
		'extract': function (race, name) {
			var which = kPlayer(race, name);
			if (which == -1)
				return (0);
			var time = race['players'][which]['time'];
			return (time || 0);
		},
		'format': function (time) {
			return (time !== 0 ? kDuration(time, true) : '-');
		}
	}
};

function kRaces(filter)
{
	var rv = [];
	kEachRace(filter, function (r) { rv.push(r); });
	return (rv);
}

function kColumnsByName(cols)
{
	return (cols.map(function (colname) {
		if (!kColumns.hasOwnProperty(colname)) {
			console.error('no such column: ' + colname);
			throw (new Error('no such column: ' + colname));
		}

		var conf = kColumns[colname];
		var rv = { '_name': colname, '_conf': conf };
		if (conf['sTitle'] === undefined)
			rv['sTitle'] = colname;
		[ 'mRender', 'sClass', 'sTitle', 'sWidth' ].forEach(
		    function (n) {
			if (conf[n])
				rv[n] = conf[n];
		    });
		return (rv);
	}));
}

function kExtractValues(columns, datum)
{
	var args = Array.prototype.slice.call(arguments, 1);

	return (columns.map(function (col) {
		return (col['_conf'].extract.apply(null, args));
	}));
}

function kTable(parent, rows, columns, options)
{
	var id, tblid, divid, html, header, label;
	var fullopts, key, rv, table;

	id = kId++;
	tblid = 'kTable' + id;
	divid = 'kDiv' + id;
	html = '';

	fullopts = {};
	for (key in kTableDefaults)
		fullopts[key] = kTableDefaults[key];

	if (options.dtOptions) {
		for (key in options.dtOptions)
			fullopts[key] = options.dtOptions[key];
	}

	header = options.title || '';
	label = options.label || '';

	fullopts.aoColumns = columns.map(function (col) {
		if (col['conf'])
			return (col['conf']);
		return (col);
	});

	fullopts.aaData = rows.map(function (row) {
		return (columns.map(function (col, i) {
			if (!col['_conf'] || !col['_conf']['format'])
				return (row[i]);
			return (col['_conf']['format'](row[i]));
		}));
	});

	html = '<div class="kDynamic kSubHeader" id="' + divid + '">' +
	    header + '</div>\n';
	if (label)
		html += '<div class="kDynamic kSubHeaderLabel">\n' + label +
		    '</div>\n';
	html += '<table id="' + tblid + '" class="kDynamic kDataTable">\n' +
	    '</table>';

	rv = $(html);
	rv.appendTo(parent);
	table = $('table#' + tblid);
	kTables.push(table.dataTable(fullopts));
	return (table);
}

function kRowsAggregate(oldrows, allcols, aggcols, aggregators)
{
	var groups = {};
	var rows = [];
	var keyindices = [], addindices = [];
	var i;

	for (i = 0; i < allcols.length; i++) {
		/* XXX should be name, but has to be applied to custom cols */
		if (aggcols.indexOf(allcols[i]['sTitle']) == -1)
			addindices.push(i);
		else
			keyindices.push(i);
	}

	oldrows.forEach(function (row) {
		var keyparts = keyindices.map(
		    function (j) { return (row[j]); });
		var key = keyparts.join(',');

		if (!groups[key]) {
			groups[key] = row;
			rows.push(row);
			return;
		}

		addindices.forEach(function (j) {
			/* XXX see above */
			var colname = allcols[j]['sTitle'];
			if (!aggregators || !aggregators[colname])
				groups[key][j] += row[j];
			else
				groups[key][j] = aggregators[colname](
				    groups[key][j], row[j]);
		});
	});

	return (rows);
}

function kDataTable(args)
{
	var parent = args['parent'];
	var entries = args['entries'];
	var columns = kColumnsByName(args['columns']);
	var extract_args = args['extract_args'] || [];
	var table_options = args['options'] || {};
	var group_by = args['group_by'];
	var aggregate = args['aggregate'];
	var sort = args['sort'];
	var limit = args['limit'];

	var rows = entries.map(function (entry) {
		var eargs = [ columns, entry ];

		if (typeof (extract_args) == 'function')
			eargs = eargs.concat(extract_args(entry));
		else
			eargs = eargs.concat(extract_args);

		return (kExtractValues.apply(null, eargs));
	});

	if (group_by)
		rows = kRowsAggregate(rows, columns, group_by, aggregate);

	if (sort)
		rows.sort(sort);

	if (limit)
		rows = rows.slice(0, limit);

	kTable(parent, rows, columns, table_options);
}

/*
 * Custom d3 line interpolation function which implements a step-after
 * interpolation, but with no vertical lines.
 */
function kd3_interpolate_step_norisers(points)
{
	var p = points[0];
	var path = [ p[0], ',', p[1] ];
	var i;

	for (i = 1; i < points.length; i++) {
		p = points[i];
		path.push('H', p[0], 'M', p[0], ',', p[1]);
	}

	return (path.join(''));
}

/*
 * Custom d3 line interpolation function which implements a step-after
 * interpolation, but with slightly angled vertical lines for improved clarity
 * when plotting multiple series.
 */
function kd3_interpolate_step_angledrisers(points)
{
	var p = points[0];
	var path = [ p[0], ',', p[1] ];
	var i;

	for (i = 1; i < points.length; i++) {
		p = points[i];
		path.push('H', p[0] - 3, 'L', p[0] + 3, ',', p[1]);
	}

	return (path.join(''));
}

/*
 * Google Analytics code: we only do this if the site is "kartlytics.com".
 */
if (window.location.host.indexOf('kartlytics.com') != -1) {
	var _gaq = _gaq || [];
	_gaq.push(['_setAccount', 'UA-42779455-1']);
	_gaq.push(['_trackPageview']);

	(function () {
		var ga = document.createElement('script');
		ga.type = 'text/javascript';
		ga.async = true;
		ga.src = ('https:' == document.location.protocol ?
		    'https://ssl' : 'http://www') +
		    '.google-analytics.com/ga.js';
		var s = document.getElementsByTagName('script')[0];
		s.parentNode.insertBefore(ga, s);
	})();
}
