/*
 * kart.js: kart web console
 */

$(document).ready(kInit);

var kNewSetElt;			/* "New Set" dialog DOM element */
var kNewSetDialog;		/* jquery dialog object */
var kNewSetPeopleTable;		/* jquery DataTable for list of people */
var kNewSetPeople = [];		/* raw list of people's names */

function kInit()
{
	kNewSetElt = document.getElementById('kNewSet');

	/*
	 * Throw up the modal "New Set" dialog, since we can't do anything
	 * useful without a current set.
	 */
	kNewSetDialog = $(kNewSetElt).dialog({
	    'buttons': {
	        'Begin': kNewSetDialogOk
	    },
	    'dialogClass': 'kNewSetDialog kDlgUnclosable',
	    'closeOnEscape': false,
	    'modal': true,
	    'resizable': false,
	    'title': 'Begin Set',
	    'width': '70%'
	});

	kNewSetPeopleTable = $('#kNewSetPeople').dataTable({
		'bAutoWidth': false,
		'bPaginate': false,
		'bLengthChange': false,
		'bFilter': false,
		'bSort': false,
		'bInfo': false,
		'bSearchable': false,
		'oLanguage': {
			'sEmptyTable': 'No players added.'
		},
		'aoColumns': [ {
		    'sTitle': '',
		    'sClass': 'kPlayerLabel'
		}, {
		    'sTitle': ''
		} ],
		'aaData': kNewSetPeopleData(kNewSetPeople)
	});

	kNewSetRefreshPeople();
}

/*
 * Returns the currently selected number of players (NOT the same as the number
 * of people configured)
 */
function kNewSetNPlayers()
{
	return (parseInt($('input[name="nplayers"]:checked').val(), 10));
}

/*
 * Given the current raw list of people, return data for the player DataTable.
 */
function kNewSetPeopleData(people)
{
	var npl = kNewSetNPlayers();

	/*
	 * Truncate the list of people to the maximum allowable given the number
	 * of players selected.  We do this here when displaying the list rather
	 * than truncating the raw data in order to "remember" the extra people
	 * in case the user bumps the number of players back up.
	 */
	var allowed = people.slice(0, npl + 1);

	return (allowed.map(function (name, i) {
		return ([ i < npl ? 'Player ' + (i + 1) : 'Alternate', name ]);
	}));
}

/*
 * Invoked when the selected number of players changes to update the list of
 * configured people.
 */
function kNewSetNPlayersChanged()
{
	kNewSetRefreshPeople();
}

/*
 * Invoked when the selected mode is changed to enable or disable the "level"
 * radio buttons.
 */
function kNewSetModeChanged()
{
	var mode = $('input[name="mode"]:checked').val();

	$('input[name="level"]').prop('disabled', mode == 'battle');
}

/*
 * Invoked when the user adds a new person to the set.
 */
function kNewSetAddPlayer()
{
	var name = $('input[name="newPlayer"]').val();

	if (name.length === 0) {
		kNewPlayerWarn('Enter a name.');
		return;
	}

	for (var i = 0; i < kNewSetPeople.length; i++) {
		if (kNewSetPeople[i] == name) {
			kNewPlayerWarn('Player already exists.');
			return;
		}
	}

	kNewSetPeople.push(name);
	kNewSetRefreshPeople();

	$('input[name="newPlayer"]').val('').focus();
}

/*
 * Displays a validation error next to the "new person" field.
 */
function kNewPlayerWarn(message)
{
	$('#kNewPlayerWarning').text(message);
}

/*
 * Refresh the list of configured people based on the current state of the form.
 */
function kNewSetRefreshPeople()
{
	var nplayers = kNewSetNPlayers();

	/*
	 * Refresh the actual table.
	 */
	kNewSetPeopleTable.fnClearTable();
	kNewSetPeopleTable.fnAddData(
	    kNewSetPeopleData(kNewSetPeople));

	/*
	 * Check whether the user is allowed to add more people, given the
	 * configured list of players.  Disable the controls to do so if not.
	 */
	if (nplayers <= kNewSetPeople.length - 1) {
		$('input[name="newPlayer"]').prop('disabled', true);
		$('input[name="newPlayerAdd"]').prop('disabled', true);
	} else {
		$('input[name="newPlayer"]').prop('disabled', false);
		$('input[name="newPlayerAdd"]').prop('disabled', false);
	}

	/*
	 * Check whether the user must add more people to proceed.  Disable the
	 * "OK" button if so.  This isn't quite the inverse of the above
	 * condition, since you may be able to add more players but not required
	 * to (since we support one alternate).
	 */
	var okay = nplayers == kNewSetPeople.length ||
	    nplayers == kNewSetPeople.length - 1;
	var button = $('.kNewSetDialog .ui-dialog-buttonset .ui-button');
	if (okay) {
		button.removeClass('ui-state-disabled');
		button.removeAttr('disabled');
	} else {
		button.addClass('ui-state-disabled');
		button.attr('disabled', 'disabled');
	}
}

function kNewSetDialogOk()
{
	/* This doesn't do anything yet. */
	$(this).dialog('close');
}
