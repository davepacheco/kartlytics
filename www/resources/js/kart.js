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

var kId = 0;
var kDomConsole;
var kDomUpdated;

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

function kFatal(_, text, err)
{
	var message = 'Error loading data';

	if (text)
		message += ': ' + text;

	if (err && err.message)
		message += ' (' + err.message + ')';

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
	var videos = [];

	$('.kDynamic').remove();

	for (var vid in kVideos) {
		var video = kVideos[vid];

		if (video.state != 'error' &&
		    video.state != 'unconfirmed' &&
		    video.state != 'reading')
			continue;

		var elt = [ video.name, video.uploaded,
		    kCapitalize(video.state) ];

		if (video.state == 'error')
			elt.push(video.error);
		else if (video.state == 'reading')
			elt.push(Math.floor(
			    (video.frame / video.nframes) * 100) + '%');
		else
			elt.push('Import');

		elt.push(video.id);
		videos.push(elt);
	}

	kDomConsole.append('<div class="kDynamic kSubHeader" ' +
	    'id="' + divid + '">' +
	    'Videos requiring attention</div>',
	    '<table id="' + tblid + '" ' +
	    'class="kDynamic kDataTable"></table>');

	var table = $('table#' + tblid);

	table.dataTable({
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
	    }, {
		'bVisible': false
	    } ],
	    'aaData': videos,
	    'fnCreatedRow': function (tr, data) {
		var uuid = data[4];
		var lasttd = tr.lastChild;
		if ($(lasttd).text() == 'Import') {
			lasttd.replaceChild($(
			    '<a href="javascript:kImportDialog(\'' + uuid +
			    '\')">Import</a>')[0], lasttd.firstChild);
		}
	    }
	});
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
	    '            <td id="label$id" colspan="2"></td>',
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
		var tbody = $(div).find('tbody');
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
			'fnCreatedRow': function (tr, data, j) {
				$(tr.lastChild).html(
				    '<input type="text" id="race' +
				    i + 'p' + j + '"></input>');
			}
		});
	});

	$(div).dialog({
		'buttons': {
			'Import': function () {
				alert('not yet implemented');
				$(div).dialog('destroy');
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
