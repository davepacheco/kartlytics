#!/usr/bin/env node

var mod_assert = require('assert');
var mod_child = require('child_process');
var mod_path = require('path');
var mod_util = require('util');

var mod_vasync = require('vasync');

process.chdir(mod_path.join(__dirname, '..'));

var tests = [
    [ '1.mov', 28,	'luigi',	'yoshi', 'peach', 'toad', 'mario'],
    [ '1.mov', 197,	'moo',		'yoshi', 'peach', 'toad', 'mario'],
    [ '1.mov', 348,	'royal',	'yoshi', 'peach', 'toad', 'mario'],
    [ '2.mov', 5,	'sherbet',	'yoshi', 'peach', 'toad', 'mario'],
    [ '3.mov', 13,	'frappe',	'yoshi', 'peach', 'toad', 'mario'],
    [ '3.mov', 173,	'choco',	'yoshi', 'peach', 'toad', 'mario'],
    [ '4.mov', 5,	'yoshi',	'yoshi', 'peach', 'toad', 'mario'],
    [ '4.mov', 190,	'banshee',	'yoshi', 'peach', 'toad', 'mario'],
    [ '5.mov', 9,	'bowser',	'yoshi', 'peach', 'toad', 'mario'],
    [ 'Recording_0000.mov', 5,	'luigi',   'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0002.mov', 4,	'frappe',  'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0003.mov', 4,	'beach',   'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0004.mov', 4,	'choco',   'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0005.mov', 11,	'desert',  'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0006.mov', 4,	'sherbet', 'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0007.mov', 0,	'banshee', 'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0008.mov', 5,	'yoshi',   'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0009.mov', 4,	'bowser',  'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0010.mov', 6,	'dk',	   'peach', 'wario', 'yoshi', 'toad' ]
];

var nerrors = 0;
var queue = mod_vasync.queue(runTest, 1);
tests.forEach(function (t) { queue.pushOne(t); });
queue.pushOne(undefined);

function runTest(t, callback)
{
	if (t === undefined)
		process.exit(nerrors);

	process.stdout.write(mod_util.format('%s@%s: ', t[0], t[1]));

	var frame = mod_path.join(__dirname, 'frames_' + t[0] + '_' + t[1]);
	mod_child.exec('out/kartvid frames -j ' + frame,
	    function (err, stdout, stderr) {
		if (err) {
			console.log('FAILED: child exited with %d', err.code);
			console.log('stderr: %s', stderr);
			callback();
			return;
		}

		var lines = stdout.split('\n');
		if (lines.length === 0) {
			console.log('FAIL: no output');
		}

		checkTest(t, lines[0]);
		callback();
	    });
}

function checkTest(t, line)
{
	try {
		var json = JSON.parse(line);
		mod_assert.equal(json['track'], t[2]);
		mod_assert.deepEqual(json['players'].map(function (c) {
		    return (c['character']); }), t.slice(3));
		mod_assert.ok(json['start'], 'didn\'t recognize start');
		console.log('OK');
	} catch (ex) {
		console.log('FAIL: ', ex);
		console.log(json);
		nerrors++;
	}
}
