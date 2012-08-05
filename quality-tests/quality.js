#!/usr/bin/env node

/*
 * quality.js: prints out a table of bitrate and file size information for the
 *     given input files, using ffprobe to extract the video details.
 */

var mod_child = require('child_process');
var mod_fs = require('fs');

var mod_extsprintf = require('extsprintf');
var mod_tab = require('tab');
var mod_vasync = require('vasync');
var mod_verror = require('verror');

var VError = mod_verror.VError;
var sprintf = mod_extsprintf.sprintf;

function main()
{
	var stream, i;

	stream = new mod_tab.TableOutputStream({
		'columns': [ {
		    'label': 'FILE',
		    'align': 'left',
		    'width': 24
		}, {
		    'label': 'BITRATE',
		    'align': 'right',
		    'width': 12
		}, {
		    'label': 'LEN(s)',
		    'align': 'right',
		    'width': 8
		}, {
		    'label': 'ESTMB',
		    'align': 'right',
		    'width': 5
		}, {
		    'label': 'MB',
		    'align': 'right',
		    'width': 5
		} ]
	});

	for (i = 2; i < process.argv.length; i++)
		runFile(stream, process.argv[i]);
}

/*
 * Print quality information about each file.
 */
function runFile(stream, filename)
{
	mod_vasync.parallel({
	    'funcs': [
	        function doStat(callback) { mod_fs.stat(filename, callback); },
		function doProbe(callback) { ffprobe(filename, callback); }
	    ]
	}, function (err, results) {
		if (err) {
			console.error('failed to process "%s": %s', filename,
			    err.message);
			return;
		}

		var st = results.operations[0].result;
		var probe = results.operations[1].result;

		if (!probe.format)
			console.error(probe);

		stream.writeRow([
		    filename,
		    sprintf('%4d Kbps', probe.format.bit_rate / 1024),
		    sprintf('%ds', probe.format.duration),
		    sprintf('%3dM',
		        probe.format.bit_rate * probe.format.duration /
		        8 / 1024 / 1024),
		    sprintf('%3dM', st.size / 1024 / 1024)
		]);
	});
}

/*
 * Invoke ffprobe and emit the entire JSON results payload.
 */
function ffprobe(filename, callback)
{
	var child;
	
	child = mod_child.exec('ffprobe -show_format -print_format json ' +
	    filename, function (err, stdout, stderr) {
		var val;

	    	if (err) {
			callback(new VError(err, 'failed to run ffprobe'));
			return;
		}

		try {
			val = JSON.parse(stdout);
		} catch (ex) {
			callback(new VError(ex,
			    'failed to parse ffprobe output'));
		}

		callback(null, val);
	    });
}

main();
