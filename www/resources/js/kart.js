/*
 * kart.js: kart web console
 */

$(document).ready(kInit);

var kVideos = {};
var kUploading = {};
var kReading = {};
var kUnconfirmed = {};
var kFailed = {};

var kPlayers = {};
var kPlayersAutocomplete = {
    'dap': true,
    'rm': true
};

var kId = 0;
var kDomConsole;
var kDomUpdated;
var kTables = [];

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
	if (!data) {
		var message = 'invalid data';
		if (text)
			message += ': ' + text;
		alert(message);
		return;
	}

	/* XXX remove old videos */
	data.forEach(function (video) {
		if (kVideos.hasOwnProperty(video.id) &&
		    kVideos[video.id].used === true)
			return;

		kVideos[video.id] = video;

		if (video.state == 'error')
			kFailed[video.id] = true;
		else
			delete (kFailed[video.id]);

		if (video.state == 'uploading')
			kUploading[video.id] = true;
		else
			delete (kUploading[video.id]);

		if (video.state == 'reading')
			kReading[video.id] = true;
		else
			delete (kReading[video.id]);

		if (video.state == 'unconfirmed')
			kUnconfirmed[video.id] = true;
		else
			delete (kUnconfirmed[video.id]);

		kUpdateStats(video);
	});

	kDomUpdated.text(new Date());
	kRefresh();

	if (!isEmpty(kReading))
		setTimeout(kLoadData, 1000);
}

function kUpdateStats(video)
{
	/* XXX */
}

function kRefresh()
{
	var id = kId++;
	var tblid = 'kTable' + id;
	var divid = 'kDiv' + id;
	var done = [], unimported = [];
	var table;

	kTables.forEach(function (t) { t.fnDestroy(); });
	kTables = [];
	$('.kDynamic').remove();

	for (var vid in kVideos) {
		var video = kVideos[vid];

		if (video.state != 'done' &&
		    video.state != 'error' &&
		    video.state != 'unconfirmed' &&
		    video.state != 'reading')
			continue;

		var elt = [ video.id, video.name, video.uploaded ];

		if (video.state == 'done') {
			elt.push(video.races.length);
			done.push(elt);
		} else {
			elt.push(kCapitalize(video.state));

			if (video.state == 'error')
				elt.push(video.error);
			else if (video.state == 'reading')
				elt.push('');
			else
				elt.push('Import');

			unimported.push(elt);
		}
	}

	kDomConsole.append('<div class="kDynamic kSubHeader" ' +
	    'id="' + divid + '">' + 'Unimported videos</div>',
	    '<table id="' + tblid + '" ' +
	    'class="kDynamic kDataTable"></table></div>');

	table = $('table#' + tblid);

	kTables.push(table.dataTable({
	    'bAutoWidth': false,
	    'bPaginate': false,
	    'pLengthChange': false,
	    'bFilter': false,
	    'bSort': false,
	    'bInfo': false,
	    'bSearchable': false,
	    'oLanguage': {
		'sEmptyTable': 'No videos added.'
	    },
	    'aoColumns': [ {
		'bVisible': false
	    }, {
	        'sTitle': 'Video',
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
	}));

	divid += '2';
	tblid += '2';
	kDomConsole.append('<div class="kDynamic kSubHeader" ' +
	    'id="' + divid + '">' + 'Imported videos</div>',
	    '<table id="' + tblid + '2" ' +
	    'class="kDynamic kDataTable"></table></div>');

	table = $('table#' + tblid + '2');

	kTables.push(table.dataTable({
	    'bAutoWidth': false,
	    'bPaginate': false,
	    'pLengthChange': false,
	    'bFilter': false,
	    'bSort': false,
	    'bInfo': false,
	    'bSearchable': false,
	    'oLanguage': {
		'sEmptyTable': 'No videos added.'
	    },
	    'aoColumns': [ {
		'bVisible': false
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
	}));

}

function kCapitalize(str)
{
	return (str[0].toUpperCase() + str.substr(1));
}

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
		var time = Math.floor(race.start_time / 1000) + '.' +
		    (race.start_time % 1000);
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
