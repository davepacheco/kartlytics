#!/usr/bin/env node

/*
 * prototype for showing table of item events by rank
 */

var mod_extsprintf = require('extsprintf');
var mod_fs = require('fs');
var mod_path = require('path');

function println() {
	var args = Array.prototype.slice.call(arguments);
	console.log(mod_extsprintf.sprintf.apply(null, args));
}

function fatal(message)
{
	console.error(mod_path.basename(process.argv[1]) + ': ' + message);
	process.exit(1);
}

function main()
{
	var filename, stream;

	if (process.argv.length <= 2) {
		json_normalize(process.stdin);
		process.stdin.resume();
	} else {
		filename = process.argv[2];
		stream = mod_fs.createReadStream(filename);
		stream.on('open', function () {
			stream.removeAllListeners('error');
			json_normalize(stream);
		});
		stream.on('error', function (err) {
			fatal('open "' + filename + '": ' + err.message);
		});
	}
}

function json_normalize(stream)
{
	var buffer = '';
	var obj;

	stream.on('data', function (chunk) {
		buffer += chunk.toString('utf8');
	});

	stream.on('end', function () {
		try {
			obj = JSON.parse(buffer);
		} catch (ex) {
			fatal('invalid json: ' + ex.message);
		}

		iteminfo(obj);
	});
}

function iteminfo(videos)
{
	/* XXX copied from js/kartvid.js */
	var allitems = {}, itemsbyr0 = {}, itemsbyr1 = {};
	var items;
	var nraces = 0;
	videos.forEach(function (v) {
		v['races'].forEach(function (r) {
			if (r['itemstates'].length != 4)
				return;

			nraces++;
			r['itemstates'].forEach(function (p) {
				p.forEach(function (evt) {
					allitems[evt['item']] = true;

					if (!evt['r0'] || !evt['r1'])
						/* XXX why not? */
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
	});

	println('Results from %d 4-player races', nraces);

	items = Object.keys(allitems).sort();
	println('');
	println('Items picked up, by rank when player hits item block');
	println('%4s  %4s  %4s  %4s  Item', '1st', '2nd', '3rd', '4th');
	items.forEach(function (it) {
		println('%4d  %4d  %4d  %4d  %s',
		    itemsbyr0['1'][it] || 0, itemsbyr0['2'][it] || 0,
		    itemsbyr0['3'][it] || 0, itemsbyr0['4'][it] || 0, it);
	});

	println('');
	println('Items picked up, by rank when player gets the item');
	println('%4s  %4s  %4s  %4s  Item', '1st', '2nd', '3rd', '4th');
	items.forEach(function (it) {
		println('%4d  %4d  %4d  %4d  %s',
		    itemsbyr1['1'][it] || 0, itemsbyr1['2'][it] || 0,
		    itemsbyr1['3'][it] || 0, itemsbyr1['4'][it] || 0, it);
	});
}

main();
