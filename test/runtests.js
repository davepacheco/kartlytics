#!/usr/bin/env node

var mod_assert = require('assert');
var mod_child = require('child_process');
var mod_path = require('path');
var mod_util = require('util');

var mod_vasync = require('vasync');

process.chdir(mod_path.join(__dirname, '..'));

var tests = [
    [ '1.mov', 30,	'luigi',	'yoshi', 'peach', 'toad', 'mario'],
    [ '1.mov', 200,	'moo',		'yoshi', 'peach', 'toad', 'mario'],
    [ '1.mov', 351,	'royal',	'yoshi', 'peach', 'toad', 'mario'],
    [ '2.mov', 8,	'sherbet',	'yoshi', 'peach', 'toad', 'mario'],
    [ '3.mov', 16,	'frappe',	'yoshi', 'peach', 'toad', 'mario'],
    [ '3.mov', 176,	'choco',	'yoshi', 'peach', 'toad', 'mario'],
    [ '4.mov', 8,	'yoshi',	'yoshi', 'peach', 'toad', 'mario'],
    [ '4.mov', 193,	'banshee',	'yoshi', 'peach', 'toad', 'mario'],
    [ '5.mov', 12,	'bowser',	'yoshi', 'peach', 'toad', 'mario'],
    [ 'Recording_0000.mov', 8,	'luigi',   'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0002.mov', 7,	'frappe',  'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0003.mov', 7,	'beach',   'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0004.mov', 7,	'choco',   'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0005.mov', 14,	'desert',  'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0006.mov', 7,	'sherbet', 'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0007.mov', 3,	'banshee', 'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0008.mov', 8,	'yoshi',   'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0009.mov', 7,	'bowser',  'peach', 'wario', 'yoshi', 'toad' ],
    [ 'Recording_0010.mov', 9,	'dk',	   'peach', 'wario', 'yoshi', 'toad' ]
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

	var frame = mod_path.join(__dirname, 'frames',
	    'start_' + t[0] + '.' + t[1] + '.png');
	mod_child.exec('out/kartvid ident ' + frame,
	    function (err, stdout, stderr) {
		if (err) {
			console.log('FAILED: child exited with %d', err.code);
			console.log('stderr: %s', stderr);
			callback();
			return;
		}

		checkTest(t, JSON.parse(stdout));
		callback();
	    });
}

function checkTest(t, json)
{
	try {
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
