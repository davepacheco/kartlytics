/*
 * kartlytics.js: kartlytics server
 *
 * New videos go through the following state machine:
 *
 *   o uploading: the video is currently being uploaded
 *
 *   o waiting: the video has been uploaded, but has not yet been processed, and
 *     currently has tasks waiting in line to be processed
 *
 *   o processing: the video is currently being processed by one or more tasks,
 *     which includes the "kartvid" task that extracts detailed information as
 *     well as the webm transcode task
 *
 *   o unimported: the video has been processed, but its races have not yet been
 *     added to the general pool of race data because a person must confirm the
 *     results
 *
 *   o done: the video has been processed and its races have been imported
 *
 * When we come up, all videos are either (a) aborted uploads (which we won't
 * see at all), (b) done (fully processed), or (c) unprocessed, and are put
 * directly into the "waiting" state.
 */

var mod_assert = require('assert');
var mod_child = require('child_process');
var mod_fs = require('fs');
var mod_os = require('os');
var mod_path = require('path');

var mod_bunyan = require('bunyan');
var mod_carrier = require('carrier');
var mod_extsprintf = require('extsprintf');
var mod_getopt = require('posix-getopt');
var mod_jsprim = require('jsprim');
var mod_kang = require('kang');
var mod_formidable = require('formidable');
var mod_restify = require('restify');
var mod_vasync = require('vasync');

var mkdirp = require('mkdirp');

var mod_kartvid = require('./kartvid');

var klName = 'kartlytics';
var klPort = 8085;
var klDatadir = '/var/tmp/kartlytics_data';
var klAuthfile;
var klAuth, klLog, klServer;

var klVideos = {};
var klVideoQueue;

process.env['PATH'] += ':/usr/local/bin';

function main()
{
	var parser, option;

	parser = new mod_getopt.BasicParser('l:d:a:', process.argv);

	while ((option = parser.getopt())) {
		if (option.error)
			usage();

		switch (option.option) {
		case 'l':
			klPort = parseInt(option.optarg, 10);
			if (isNaN(klPort))
				usage();
			break;

		case 'd':
			klDatadir = option.optarg;
			break;

		case 'a':
			klAuthfile = option.optarg;
			break;

		default:
			/* can't happen */
			throw (new Error('unknown option: ' + option.option));
		}
	}

	klLog = new mod_bunyan({
	    'name': klName,
	    'level': process.env['LOG_LEVEL'] || 'info'
	});

	klVideoQueue = mod_vasync.queuev({
	    'concurrency': Math.min(mod_os.cpus().length - 1, 4),
	    'worker': vidTaskRun
	});

	/*
	 * kartvid assumes it's running out of the root of the repo in order to
	 * find its assets.
	 */
	initData();
	process.chdir(mod_path.join(__dirname, '..'));
	initServer();
}

function usage()
{
	console.error('usage: node kartlytics.js [-l port] [-d data_dir] ' +
	    '[-a authfile]');
	process.exit(2);
}

/*
 * Read all previously stored data.
 */
function initData()
{
	var ents, contents;

	if (klAuthfile) {
		klLog.info('loading auth file %s', klAuthfile);
		contents = mod_fs.readFileSync(klAuthfile);
		klAuth = JSON.parse(contents);
	}

	mkdirp.sync(klDatadir);

	klLog.info('loading data from %s', klDatadir);
	ents = mod_fs.readdirSync(klDatadir);
	ents.forEach(function (name) {
		if (!mod_jsprim.endsWith(name, '.md.json'))
			return;

		contents = mod_fs.readFileSync(mod_path.join(
		    klDatadir, name));
		var video = JSON.parse(contents);

		video.log = klLog.child({ 'video': video.name });
		video.ntasks = 0;
		klVideos[video.id] = video;
	});

	mod_jsprim.forEachKey(klVideos, function (_, video) {
		if (!video.processed) {
			klVideoQueue.push({
			    'vidid': video.id,
			    'action': 'kartvid'
			});

			video.ntasks++;

			return;
		}

		if (video.eventsFile) {
			var contents = mod_fs.readFileSync(video.eventsFile);
			var lines = contents.toString('utf8').split('\n');
			var func = mod_kartvid.parseKartvid(video);
			lines.forEach(func);
			vidParseRaces(video);
		}

		vidDispatchWebm(video);
	});
}

/*
 * Set up the HTTP server.
 */
function initServer()
{
	var filespath;

	klServer = mod_restify.createServer({
	    'name': klName,
	    'log': klLog
	});

	klServer.use(mod_restify.authorizationParser());
	klServer.use(mod_restify.acceptParser(klServer.acceptable));
	klServer.use(mod_restify.queryParser());
	klServer.use(mod_restify.urlEncodedBodyParser());

	klServer.get('/kang/.*', mod_kang.knRestifyHandler({
	    'uri_base': '/kang',
	    'service_name': 'kartlytics',
	    'version': '0.0.1',
	    'ident': mod_os.hostname(),
	    'list_types': kangListTypes,
	    'list_objects': kangListObjects,
	    'get': kangGetObject
	}));

	filespath = mod_path.normalize(mod_path.join(__dirname, '..', 'www'));

	klServer.get('/', fileServer.bind(
	    null, mod_path.join(filespath, 'index.htm')));
	klServer.get('/resources/.*', dirServer.bind(null, '/resources/',
	    mod_path.join(filespath, 'resources')));
	klServer.post('/kart/video', auth, upload);
	klServer.get('/api/videos', apiVideosGet);
	klServer.get('/api/files/:id/.*\.mov', apiFilesGetVideo);
	klServer.get('/api/files/:id/.*\.webm', apiFilesGetRaceVideo);
	klServer.get('/api/files/:id/pngs/.*', apiFilesGetFrame);
	klServer.put('/api/videos/:id', auth,
	    mod_restify.bodyParser({ 'mapParams': false }), apiVideosPut);
	klServer.put('/api/videos/:id/rerun', auth, apiVideosRerun);
	klServer.put('/api/rerun_all', auth, apiRerunAll);

	// klServer.on('after', mod_restify.auditLogger({ 'log': klLog }));

	klServer.listen(klPort, function () {
		klLog.info('%s server listening at %s',
		    klServer.name, klServer.url);
	});
}

/*
 * Restify handler to authenticate a request.
 */
function auth(request, response, next)
{
	if (!klAuth) {
		next();
		return;
	}

	if (request.authorization &&
	    request.authorization.basic &&
	    request.authorization.basic.username &&
	    klAuth[request.authorization.basic.username] ==
	    request.authorization.basic.password) {
		next();
		return;
	}

	response.header('WWW-authenticate', 'Basic realm="kartlytics"');
	next(new mod_restify.UnauthorizedError());
	response.end();
}

/*
 * Restify handler to redirect any request to the given path.
 */
function redirect(path, request, response, next)
{
	response.header('Location', path);
	response.send(301);
	next();
}

/*
 * Restify handler to serve flat files at "baseuri" out of "basedir".
 */
function dirServer(baseuri, basedir, request, response, next)
{
	/*
	 * This is only safe as long as there are no symlinks inside this
	 * directory tree.  We don't bother trying to avoid them, since doing
	 * it correctly (without races) is much more complex than we really
	 * need here.
	 */
	mod_assert.equal(baseuri, request.path.substr(0, baseuri.length));

	var filename = mod_path.normalize(
	    mod_path.join(basedir, decodeURIComponent(
	    request.path.substr(baseuri.length))));

	if (filename.substr(0, basedir.length) != basedir) {
		request.log.warn('denying request for file outside of %s',
		    basedir);
		next(new mod_restify.ResourceNotFoundError());
		return;
	}

	fileServer(filename, request, response, next);
}

/*
 * Restify handler to serve the given file.
 */
function fileServer(filename, request, response, next)
{
	var file = mod_fs.createReadStream(filename);
	var headers = {};

	if (mod_jsprim.endsWith(request.url, '.mov'))
		headers['Content-Type'] = 'video/quicktime';

	file.on('error', function (err) {
		if (err['code'] == 'ENOENT') {
			next(new mod_restify.ResourceNotFoundError());
			return;
		}

		request.log.error(err);
		next(err);
	});

	file.on('open', function () {
		file.removeAllListeners('error');
		response.writeHead(200, headers);
		file.pipe(response);

		file.on('error', function (err) {
			request.log.warn(err);
			response.end();
		});
	});

	file.on('end', next);
}

/*
 * GET /api/videos: returns all known videos
 */
function apiVideosGet(request, response, next)
{
	var rv = [];

	mod_jsprim.forEachKey(klVideos, function (uuid, video) {
		var races, obj;

		if (!video.processed)
			races = [];
		else
			races = video.races.map(function (rawrace, i) {
				var race = mod_jsprim.deepCopy(rawrace);
				var meta;

				if (video.metadata) {
					meta = video.metadata.races[i];
					race['level'] = meta['level'];
				}

				race['players'].forEach(function (p, j) {
					p['char'] = p['character'];
					delete (p['character']);

					if (meta)
						p['person'] = meta['people'][j];
				});

				return (race);
			});

		obj = {
			'id': uuid,
			'name': video.name,
			'crtime': video.crtime,
			'uploaded': video.uploaded,
			'mtime': video.lastUpdated,
			'error': video.error,
			'frameImages': video.pngDir ? true : false,
			'metadata': video.metadata,
			'races': races
		};

		if (obj['error'])
			obj['stderr'] = video.stderr;

		if (video.error) {
			obj.state = 'error';
		} else if (!video.saved) {
			obj.state = 'uploading';
			obj['frame'] = video.uploadForm.bytesReceived;
			obj['nframes'] = video.uploadForm.bytesExpected;
		} else if (!video.processed && video.child) {
			obj.state = 'reading';
			obj['frame'] = video.frame || 0;
			obj['nframes'] = video.maxframes || video.frame || 100;
		} else if (video.child) {
			obj.state = 'transcoding';
		} else if (video.ntasks > 0) {
			obj.state = 'waiting';
		} else if (!video.metadata) {
			obj.state = 'unimported';
		} else {
			obj.state = 'done';
		}

		rv.push(obj);
	});

	response.send(rv);
	next();
}

var klMetadataSchema = {
    'type': 'object',
    'additionalProperties': false,
    'properties': {
	'races': {
	    'type': 'array',
	    'items': {
		'type': 'object',
		'additionalProperties': false,
		'properties': {
		    'level': {
			'type': 'string',
			'enum': [ '50cc', '100cc', '150cc', 'Extra' ]
		    },
		    'people': {
			'type': 'array',
			'uniqueItems': true,
			'items': {
			    'type': 'string',
			    'minLength': 1
			}
		    }
		}
	    }
	}
    }
};

/*
 * GET /api/files/:id: retrieve an actual video file
 */
function apiFilesGetVideo(request, response, next)
{
	var uuid, video;

	uuid = request.params['id'];

	if (!klVideos.hasOwnProperty(uuid)) {
		next(new mod_restify.ResourceNotFoundError());
		return;
	}

	video = klVideos[uuid];
	fileServer(video.filename, request, response, next);
}

/*
 * GET /api/files/:vidid/:racenum.webm: retrieve a race video file
 */
function apiFilesGetRaceVideo(request, response, next)
{
	var uuid, video, num;

	uuid = request.params['id'];
	num = mod_path.basename(request.url);
	num = Math.floor(num.substr(0, num.length - '.webm'.length));

	if (!klVideos.hasOwnProperty(uuid) || isNaN(num)) {
		next(new mod_restify.ResourceNotFoundError());
		return;
	}

	video = klVideos[uuid];

	if (!video.races || num >= video.races.length ||
	    !video.races[num]['webm']) {
		next(new mod_restify.ResourceNotFoundError());
		return;
	}

	fileServer(video.webmDir + '/' + num + '.webm',
	    request, response, next);
}

/*
 * GET /api/files/:id/pngs/:frame: retrieve a video frame
 */
function apiFilesGetFrame(request, response, next)
{
	var uuid, video;

	uuid = request.params['id'];

	if (!klVideos.hasOwnProperty(uuid)) {
		next(new mod_restify.ResourceNotFoundError());
		return;
	}

	video = klVideos[uuid];

	if (!video.pngDir) {
		next(new mod_restify.ResourceNotFoundError());
		return;
	}

	dirServer('/api/files/' + uuid + '/pngs', video.pngDir,
	    request, response, next);
}

/*
 * PUT /api/videos/:id: saves video metadata
 */
function apiVideosPut(request, response, next)
{
	var uuid, body, error, video, race, i;

	uuid = request.params['id'];
	body = request.body;

	if (!klVideos.hasOwnProperty(uuid)) {
		next(new mod_restify.ResourceNotFoundError());
		return;
	}

	video = klVideos[uuid];
	if (video.error || !video.saved || !video.processed) {
		next(new mod_restify.ResourceNotFoundError());
		return;
	}

	error = mod_jsprim.validateJsonObject(klMetadataSchema, body);
	if (error) {
		next(new mod_restify.BadRequestError(error.message));
		return;
	}

	if (body['races'].length != video['races'].length) {
		next(new mod_restify.BadRequestError('wrong number of races'));
		return;
	}

	for (i = 0; i < body['races'].length; i++) {
		race = body['races'][i];

		if (race['people'].length !=
		    video.races[i]['players'].length) {
			next(new mod_restify.BadRequestError(
			    'wrong number of players for race ' + i));
			return;
		}
	}

	saveVideo(video, body, function (err) {
		if (err) {
			next(err);
			return;
		}

		response.send(200);
		next();
	});
}

/*
 * PUT /api/videos/:id/rerun: rerun kartvid for this video
 */
function apiVideosRerun(request, response, next)
{
	var uuid, video;

	uuid = request.params['id'];

	if (!klVideos.hasOwnProperty(uuid)) {
		next(new mod_restify.ResourceNotFoundError());
		return;
	}

	video = klVideos[uuid];

	if (!video.processed) {
		response.send(200);
		return;
	}

	video.frame = 0;
	video.processed = false;
	video.races = undefined;

	saveVideo(video, undefined, function (err) {
		if (err) {
			next(err);
			return;
		}

		response.send(200);
		klVideoQueue.push({ 'vidid': video.id, 'action': 'kartvid' });
		video.ntasks++;
	});
}

/*
 * PUT /api/rerun_all: rerun kartvid for this video
 */
function apiRerunAll(request, response, next)
{
	var uuid, video;
	var args = [];

	for (uuid in klVideos) {
		video = klVideos[uuid];

		if (!video.processed)
			continue;

		video.frame = 0;
		video.processed = false;
		video.races = undefined;

		args.push(uuid);
	}

	mod_vasync.forEachParallel({
	    'inputs': args,
	    'func': function (vidid, callback) {
		saveVideo(klVideos[vidid], undefined, function (err) {
			if (err) {
				callback(err);
				return;
			}

			klVideoQueue.push({
			    'vidid': vidid,
			    'action': 'kartvid'
			});

			klVideos[vidid].ntasks++;

			callback();
		});
	    }
	}, function (err) {
		if (err) {
			klLog.error(err, 'failed to rerun all');
			next(err);
			return;
		}

		response.send(200);
	});
}

/*
 * Restify handler for handling form uploads.
 */
function upload(request, response, next)
{
	var form = new mod_formidable.IncomingForm();
	var video;

	form.uploadDir = klDatadir;

	function onerr(err) {
		request.log.error(err);
		response.send(400, err.message);
	}

	function onbegin(name, file) {
		var filename = file['path'];
		var uuid = mod_path.basename(filename);

		/*
		 * formidable picks a unique id so we shouldn't see the same
		 * name twice.
		 */
		mod_assert.ok(!klVideos.hasOwnProperty(uuid));

		video = klVideos[uuid] = {
		    /* immutable state */
		    'id': uuid,
		    'name': file['name'],
		    'filename': filename,

		    /* state information */
		    'uploaded': undefined,
		    'saved': false,
		    'processed': false,
		    'lastUpdated': mod_jsprim.iso8601(new Date()),
		    'crtime': undefined,
		    'metadataFile': filename + '.md.json',
		    'eventsFile': filename + '.events.json',
		    'pngDir': filename + '.pngs',
		    'webmDir': filename + '.webm',
		    'error': undefined,

		    /* user data */
		    'metadata': undefined,

		    /* kartvid output */
		    'races': undefined,

		    /* form, for upload progress */
		    'uploadForm': form,

		    /* kartvid progress */
		    'frame': undefined,
		    'maxframes': undefined,

		    /* current process */
		    'child': undefined,
		    'stdout': undefined,
		    'stderr': undefined,

		    'ntasks': 0,
		    'log': klLog.child({ 'video': uuid })
		};
	}

	form.on('error', onerr);
	form.on('fileBegin', onbegin);

	form.parse(request, function (err, fields, files) {
		form.removeListener('error', onerr);
		form.removeListener('fileBegin', onbegin);

		if (!video) {
			next(new mod_restify.BadRequestError(
			    'no file specified'));
			return;
		}

		response.send(201);
		next();

		video.uploaded = mod_jsprim.iso8601(new Date());
		saveVideo(video, undefined, function (suberr) {
			if (suberr)
				return;

			video.saved = true;

			klVideoQueue.push({
			    'vidid': video.id,
			    'action': 'kartvid'
			});

			video.ntasks++;
		});
	});
}

function saveVideo(video, metadata, callback)
{
	mod_assert.equal(arguments.length, 3);

	/*
	 * Once the upload completes, we write a blank metadata file.  If we
	 * don't find this file on startup, we assume the upload failed partway.
	 */
	var tmpfile = video.metadataFile + 'tmp';
	var keys = [ 'id', 'name', 'filename', 'uploaded', 'saved', 'processed',
	    'crtime', 'metadataFile', 'eventsFile', 'pngDir', 'webmDir', 'webm',
	    'error', 'metadata', 'races', 'error' ];
	var obj = {};
	var when = mod_jsprim.iso8601(new Date());

	keys.forEach(function (key) {
		obj[key] = video[key];
	});

	obj['saved'] = true;
	obj['lastUpdated'] = when;

	if (metadata)
		obj['metadata'] = metadata;

	mod_fs.writeFile(tmpfile, JSON.stringify(obj, null, 4),
	    function (err) {
		if (err) {
			klLog.error(err, 'failed to write metadata file %s',
			    tmpfile);
			callback(err);
			return;
		}

		mod_fs.rename(tmpfile, video.metadataFile, function (suberr) {
			if (err) {
				klLog.error(err, 'failed to rename %s',
				    tmpfile);
				callback(err);
				return;
			}

			if (metadata)
				video.metadata = metadata;
			video.lastUpdated = when;
			klLog.info('saved video record %s', video.id);
			callback();
		});
	    });
}

function vidTaskRun(arg, callback)
{
	var video;

	video = klVideos[arg.vidid];
	video.ntasks--;

	if (arg.action == 'webm') {
		vidTaskRaceWebm(arg, callback);
		return;
	}

	if (!video.pngDir)
		video.pngDir = video.filename + '.pngs';

	mod_fs.mkdir(video['pngDir'], function (err) {
		if (err && err['code'] != 'EEXIST') {
			video.error = err.message;
			video.log.error(video.error);
			callback();
			return;
		}

		vidTaskKartvid(arg.vidid, callback);
	});
}

function vidTaskRaceWebm(arg, callback)
{
	var video = arg.video;
	var race = video['races'][arg.racenum];
	var ffmpeg_args = arg.args;

	mod_fs.mkdir(video['webmDir'], function (err) {
		if (err && err['code'] != 'EEXIST') {
			video.error = err.message;
			video.log.error(video.error);
			callback();
			return;
		}

		var child = vidStartCommand(video, 'ffmpeg', ffmpeg_args);
		child.on('exit', function (code) {
			video.child = undefined;

			if (code !== 0) {
				video.error = mod_extsprintf.sprintf(
				    'ffmpeg exited with code %d; ' +
				    'stderr = %s', code, video.stderr);
				video.log.error(video.error);
				callback();
				return;
			}

			video.log.info('created webm for race %d',
			    arg.racenum);
			race['webm'] = video.id + '.webm/race' +
			    arg.racenum + '.webm';
			saveVideo(video, undefined, callback);
			vidDispatchWebm(video);
		});
	});

}

function vidStartCommand(video, cmd, args)
{
	var child;

	mod_assert.ok(video.child === undefined);

	video.stdout = '';
	video.stderr = '';
	video.child = child = mod_child.spawn(cmd, args);
	video.log.info('invoking %s %j', cmd, args);

	child.stdout.on('data', function (chunk) { video.stdout += chunk; });
	child.stderr.on('data', function (chunk) { video.stderr += chunk; });
	return (child);
}

/*
 * Invoke "kartvid" to process all frames in the video.
 */
function vidTaskKartvid(vidid, callback)
{
	var video, child;

	/*
	 * We run through this process in phases: first we run "kartvid", which
	 * emits events for "important" frames.  Except for determining when
	 * something "important" has happened, kartvid's processing is
	 * stateless.  We use the carrier module with parseKartvid() to group
	 * these frame records into distinct races.  Then we take a pass over
	 * the race records using vidParseRaces() to flesh out our records.
	 * Finally, now that we know what races are present and when they start
	 * and end, we submit tasks to extract webm clips for each one.
	 */
	video = klVideos[vidid];
	child = vidStartCommand(video, 'out/kartvid',
	    [ 'video', '-d', video.pngDir, '-j', video.filename ]);
	mod_carrier.carry(child.stdout, mod_kartvid.parseKartvid(video));

	child.on('exit', function (code) {
		video.child = undefined;

		if (code !== 0) {
			video.error = mod_extsprintf.sprintf(
			    'kartvid exited with code %d; stderr = %s',
			    code, video.stderr);
			video.log.error(video.error);
			callback();
			return;
		}

		var steps = [];

		steps.push(function (_, subcallback) {
			mod_fs.writeFile(video.eventsFile, video.stdout,
			    subcallback);
		});

		steps.push(function (_, subcallback) {
			video.log.info('successfully ran kartvid');
			video.processed = true;
			saveVideo(video, undefined, subcallback);
		});

		steps.push(function (_, subcallback) {
			vidParseRaces(video);
			saveVideo(video, undefined, subcallback);
		});

		steps.push(function (_, subcallback) {
			vidDispatchWebm(video);
			subcallback();
		});

		mod_vasync.pipeline({ 'funcs': steps }, function (err) {
			if (err) {
				video.error = 'failed: ' + err.message;
				video.log.error(err, 'failed to finish');
			}

			callback();
		});
	});
}

function vidParseRaces(video)
{
	video.races.forEach(function (race, i) {
		var players, k;

		race['raceid'] = video.id + '/' + i;
		race['vidid'] = video.id;
		race['num'] = i;
		race['start_time'] = video.crtime + race['vstart'];
		race['end_time'] = video.crtime + race['vend'];
		race['duration'] = race['vend'] - race['vstart'];

		players = race['players'];
		race['segments'].forEach(function (seg, j) {
			for (k = 0; k < players.length; k++) {
				if (players[k].hasOwnProperty('time'))
					continue;

				if (seg['players'][k]['lap'] == 4)
					players[k]['time'] =
					    seg['vstart'] - race['vstart'];
			}

			seg['raceid'] = race['raceid'];
			seg['segnum'] = j;
			seg['duration'] = seg['vend'] - seg['vstart'];
		});

		for (k = 0; k < players.length; k++) {
			if (players[k].hasOwnProperty('time'))
				continue;

			if (players[k]['rank'] == players.length)
				continue;

			players[k]['time'] = race.vend - race.vstart;
		}
	});
}

function vidDispatchWebm(video)
{
	var i, race;

	if (!video.races || video.races.length === 0)
		return;

	/* jsl:ignore */
	for (i = 0; i < video.races.length; i++) {
	/* jsl:end */
		race = video.races[i];

		if (race['webm'] || !race['vend'] || !race['vstart'])
			continue;

		if (!video.webmDir)
			video.webmDir = video.filename + '.webm';

		/*
		 * We disable audio recording with ffmpeg because the vorbis
		 * audio encoder is "experimental" in our SmartOS build and
		 * doesn't seem to work that well.
		 */
		var extract_start =
		    Math.max(0, Math.floor(race['vstart'] / 1000) - 10);
		var extract_duration =
		    Math.ceil((race['vend'] - race['vstart']) / 1000) + 20;
		var args = [ '-y', '-ss', extract_start, '-t', extract_duration,
		    '-i', video.filename, '-an', video.webmDir + '/' +
		    race['num'] + '.webm' ];

		klVideoQueue.push({
		    'action': 'webm',
		    'vidid': video['id'],
		    'video': video,
		    'racenum': i,
		    'args': args
		});

		video.ntasks++;

		/* We can only dispatch one at a time. */
		break;
	}
}

/*
 * Kang (introspection) entry points
 */
function kangListTypes()
{
	return ([ 'queue', 'video' ]);
}

function kangListObjects(type)
{
	if (type == 'queue')
		return ([ 0 ]);

	return (Object.keys(klVideos));
}

function kangGetObject(type, ident)
{
	if (type == 'queue')
		return (klVideoQueue);

	var video = klVideos[ident];

	return ({
		'name': video.name,
		'uploaded': video.uploaded,
		'saved': video.saved,
		'metadata': video.metadata,
		'frame': video.frame,
		'maxframes': video.maxframes,
		'races': video.races,
		'error': video.error
	});
}

main();
