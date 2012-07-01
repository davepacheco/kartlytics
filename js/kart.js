#!/usr/bin/env node

/*
 * kart.js: process kartvid output
 */

var mod_bunyan = require('bunyan');
var mod_carrier = require('carrier');
var mod_getopt = require('posix-getopt');

var mod_kartvid = require('./kartvid');

function main()
{
	var parser, option, video;
	var raw = false;
	var log = new mod_bunyan({ 'name': 'kart' });

	parser = new mod_getopt.BasicParser('r', process.argv);
	while ((option = parser.getopt()) !== undefined) {
		switch (option.option) {
		case 'r':
			raw = true;
			break;

		default:
			/* error message already emitted */
			usage();
			break;
		}
	}

	video = { 'log': log };
	mod_carrier.carry(process.stdin, mod_kartvid.parseKartvid(video));
	process.stdin.resume();

	process.stdin.on('end', function () {
		if (raw)
			console.log('%s', JSON.stringify(video, null, 4));
		else
			video.races.forEach(summarize);
	});
}

function usage()
{
	console.error('usage: node kart.js [-r]');
	process.exit(2);
}

function summarize(race)
{
	var summary = mod_kartvid.summarize(race);
	summary.forEach(function (s) { console.log('%s', s); });
}

main();
