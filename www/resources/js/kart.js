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

/*
 * TODO:
 * - add table of basic stats by player
 * - video details screen, including video download link
 * - race details screen (race transcript)
 * - player details screen (list of races including character played)
 * - clean up "upload" dialog
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
var kId = 0;			/* used to generate unique ids */
var kDomConsole;		/* DOM element for main console */
var kDomUpdated;		/* DOM element for "last updated" text */
var kTables = [];		/* list of dynamic tables */

/*
 * Initialization and data load.  Data is reloaded on page load, after making a
 * server-side change, and periodically when we know there are videos being
 * processed (and updated) on the server.
 */
$(document).ready(kInit);

function kInit()
{
	kLoadData();

	kDomConsole = $('.kConsole');
	kDomUpdated = $('.kLastUpdateTime');
}

function kLoadData()
{
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
		if (kVideos.hasOwnProperty(video.id) &&
		    kVideos[video.id].used === true)
			return;

		kVideos[video.id] = video;

		if (video.state == 'reading')
			nreading++;

		if (video.state == 'done')
			kUpdateStats(video);
	});

	for (key in kVideos) {
		if (!kVideos[key].deleteMark)
			continue;

		delete (kVideos[key]);
	}

	kDomUpdated.text(new Date());
	kRefresh();

	if (nreading > 0)
		setTimeout(kLoadData, 1000);
}

function kUpdateStats(video)
{
	/*
	 * Update the set of players for autocomplete.
	 */
	video.metadata.races.forEach(function (race) {
		race.people.forEach(function (p) {
			kPlayersAutocomplete[p] = true;
		});
	});
}


/*
 * Rendering.
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
	console.log(table);
	kTables.push(table.dataTable(fullopts));
}

function kRemoveDynamicTables()
{
	kTables.forEach(function (t) { t.fnDestroy(); });
	kTables = [];
	$('.kDynamic').remove();
}

function kRefresh()
{
	var done = [], unimported = [];
	var id, video, elt, races, players, pnames, pdata;

	kRemoveDynamicTables();

	for (id in kVideos) {
		video = kVideos[id];

		elt = [ video.id, video.name, video.uploaded || '' ];

		if (video.state == 'done') {
			elt.push(video.races.length);
			done.push(elt);
		} else {
			elt.push(ucfirst(video.state));

			if (video.state == 'error')
				elt.push(video.error);
			else if (video.state == 'unconfirmed')
				elt.push('Import');
			else
				elt.push('');

			unimported.push(elt);
		}
	}

	kMakeDynamicTable(kDomConsole, 'Unimported videos', {
	    'oLanguage': {
		'sEmptyTable': 'No videos to import.'
	    },
	    'aoColumns': [ {
		'sTitle': 'Video ID'
	    }, {
		'sTitle': 'Filename',
		'sClass': 'kDataColumnVideoName',
		'sWidth': '100px'
	    }, {
		'sTitle': 'Uploaded',
		'sClass': 'kDataColumnUploaded',
		'sWidth': '200px'
	    }, {
	        'sTitle': 'State',
		'sClass': 'kDataColumnState',
		'sWidth': '100px'
	    }, {
		'sTitle': 'Details',
		'sClass': 'kDataColumnDetails',
		'sWidth': '200px'
	    } ],
	    'aaData': unimported,
	    'fnCreatedRow': function (tr, data) {
		var uuid = data[0];
		var vidobj = kVideos[uuid];
		var td;

		if (vidobj.state == 'unconfirmed') {
			td = $(tr).find('td.kDataColumnDetails');
			td.html('<a href="javascript:kImportDialog(\'' + uuid +
			    '\')">Import</a>');
			return;
		}

		if (vidobj.state == 'reading') {
			td = $(tr).find('td.kDataColumnDetails');
			$('<div class="kProgressBar"></div>').appendTo(td).
			    progressbar({ 'value': Math.floor(
				(vidobj.frame / vidobj.nframes) * 100) });
			return;
		}
	    }
	});

	kMakeDynamicTable(kDomConsole, 'Imported videos', {
	    'oLanguage': {
		'sEmptyTable': 'No videos imported.'
	    },
	    'aoColumns': [ {
		'sTitle': 'Video ID'
	    }, {
	        'sTitle': 'Video',
		'sClass': 'kDataColumnVideoName',
		'sWidth': '100px'
	    }, {
	        'sTitle': 'Uploaded',
		'sClass': 'kDataColumnUploaded',
		'sWidth': '200px'
	    }, {
	        'sTitle': 'Races',
		'sClass': 'kDataColumnNumRaces',
		'sWidth': '100px'
	    } ],
	    'aaData': done
	});

	races = [];
	kEachRace(true, function (race) {
		races.push([
		    race,
		    race['raceid'],
		    race['players'].length + 'P',
		    race['mode'],
		    race['level'] || '',
		    race['track'],
		    kDuration(race['vstart']),
		    kDuration(race['vend']),
		    kDuration(race['duration'])
		]);
	});

	kMakeDynamicTable(kDomConsole, 'All Races', {
	    'bFilter': true,
	    'oLanguage': {
		'sEmptyTable': 'No races found.'
	    },
	    'aoColumns': [ {
		'bVisible': false
	    }, {
		'sTitle': 'RaceID',
		'sClass': 'kDataRaceID'
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
		'sTitle': 'VStart',
		'sClass': 'kDataRaceVStart'
	    }, {
		'sTitle': 'VEnd',
		'sClass': 'kDataRaceVEnd'
	    }, {
		'sTitle': 'Time',
		'sClass': 'kDataRaceTime'
	    } ],
	    'aaData': races
	});

	players = {};
	kEachRace(true, function (race) {
		race.players.forEach(function (p) {
			if (!players[p.person])
				players[p.person] = {
					'nraces': 0,
					'n1': 0,
					'n2': 0,
					'n3': 0,
					'n4': 0
				};

			players[p.person]['nraces']++;
			players[p.person]['n' + p.rank]++;
		});
	});

	pnames = Object.keys(players);
	pnames.sort();
	pdata = pnames.map(function (p) {
	    return ([ p, players[p]['nraces'], players[p]['n1'],
		players[p]['n2'], players[p]['n3'], players[p]['n4'] ]);
	});

	kMakeDynamicTable(kDomConsole, 'Players', {
	    'oLanguage': {
		'sEmptyTable': 'No videos imported.'
	    },
	    'aoColumns': [ {
	        'sTitle': 'Player'
	    }, {
	        'sTitle': 'Races'
	    }, {
	        'sTitle': '1'
	    }, {
	        'sTitle': '2'
	    }, {
	        'sTitle': '3'
	    }, {
	        'sTitle': '4'
	    } ],
	    'aaData': pdata
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
	    '    <div id="uploadText"></div>',
	    '</div>'
	].join('\n'));

	$(div).dialog({
		'buttons': {
			'Upload': function () {
				$('#uploadText').text('Uploading...');
				$('#upload').ajaxForm().ajaxSubmit({
					'success': function () {
						$('#uploadText').text('Done!');
						$(div).dialog('destroy');
						kLoadData();
						$(div).remove();
					},
					'error': function () {
						alert('Upload failed!');
						$(div).dialog('destroy');
						$(div).remove();
					}
				});
			}
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
		var time = kDuration(race.start_time);
		var label = '<strong>Race ' + (i+1) + ': ' +
		    race.players.length + 'P ' + race.mode + ' on ' +
		    race.track + '</strong> (start time: ' + time + 's)';
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
		kLoadData();
	    }
	});
}


/*
 * Utility functions.
 */

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

function kDuration(ms)
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
		rv += '0' + sec + '.';
	else
		rv += sec + '.';

	if (ms < 10)
		rv += '00' + ms;
	else if (ms < 100)
		rv += '0' + ms;
	else
		rv += ms;

	return (rv);
}

/*
 * Stat computation.  The rest of this file is essentially a library for doing
 * stat queries on the race data.
 *
 * As described above, the goal is to be able to slice and dice the data in all
 * kinds of ways.  We start with just one type of object, the "race", which
 * defines the following properties:
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
 * We provide a primitive, kSelectRaces([filter]), which selects all races
 * matching the given filter (a standard JS filter function).
 *
 * The current data also allows us to define a "segment" type, which would
 * enable us to compute per-segment data (e.g., the percentage of time a person
 * was in 1st place, or the number of times they went from 1st to 4th within 5
 * seconds).  This is not yet implemented.
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
	return (kChars(character) || 'Unknown');
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
	var racemeta, players, i, rv;

	racemeta = video.metadata.races[num];
	players = new Array(race.players.length);

	for (i = 0; i < race.players.length; i++)
		players[i] = {
		    'char': race.players[i].character,
		    'person': racemeta.people[i],
		    'rank': race.results[i].position
		};

	if (num < 10)
		num = '0' + num;

	rv = {
	    'raceid': video.id + '/' + num,
	    'vidid': video.id,
	    'num': num,
	    'start_time': undefined,	/* XXX need video start time */
	    'end_time': undefined, 	/* XXX ditto */
	    'vstart': race.start_time,
	    'vend': race.end,
	    'duration': race.end - race.start_time,
	    'mode': race.mode,
	    'level': racemeta.level,
	    'track': race.track,
	    'players': players
	};

	return (rv);
}
