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

	for (var id in kVideos) {
		var video = kVideos[id];

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
			elt.push('');

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
	    } ],
	    'aaData': videos
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

	var dlog = $(div).dialog({
		'buttons': {
			'Upload': function () {
				$('#uploadText').text('Uploading...');
				$('#upload').ajaxForm().ajaxSubmit({
					'success': function () {
						$('#uploadText').text('Done!');
						$(div).dialog('destroy');
						kLoadData();
					},
					'error': function () {
						alert('Upload failed!');
						$(div).dialog('destroy');
					}
				});
			}
		},
		'dialogClass': 'kUploadDialog',
		'modal': true,
		'title': 'Upload video',
		'width': '400px'
	});
}
