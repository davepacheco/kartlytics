/*
 * kartlytics.js: kartlytics server
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
	    'worker': vidProcessFrames
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
		klVideos[video.id] = video;
	});

	mod_jsprim.forEachKey(klVideos, function (_, video) {
		if (video.processed)
			return;

		klVideoQueue.push(video.id);
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
	klServer.get('/api/files/:id', apiFilesGetVideo);
	klServer.get('/api/files/:id/pngs/.*', apiFilesGetFrame);
	klServer.put('/api/videos/:id', auth,
	    mod_restify.bodyParser({ 'mapParams': false }), apiVideosPut);
	klServer.put('/api/videos/:id/rerun', auth, apiVideosRerun);

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

	if (mod_jsprim.endsWith(filename, '.mov'))
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
		var obj = {
			'id': uuid,
			'name': video.name,
			'crtime': video.crtime,
			'uploaded': video.uploaded,
			'mtime': video.lastUpdated,
			'races': video.races,
			'metadata': video.metadata,
			'error': video.error,
			'stderr': video.stderr,
			'frameImages': video.pngDir ? true : false
		};

		if (video.error) {
			obj.state = 'error';
		} else if (!video.saved) {
			obj.state = 'uploading';
		} else if (!video.processed && !video.child) {
			obj.state = 'waiting';
		} else if (!video.processed) {
			obj.state = 'reading';
			obj['frame'] = video.frame || 0;
			obj['nframes'] = video.maxframes || video.frame || 100;
		} else if (!video.metadata) {
			obj.state = 'unconfirmed';
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
 * GET /api/files/:id/pngs/:frame: retrieve a video frame
 */
function apiFilesGetFrame(request, response, next)
{
	var uuid, video;

	uuid = request.params['id'];

	request.log.info('video uuid', uuid);

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
		klVideoQueue.push(video.id);
	});
}

/*
 * Restify handler for handling form uploads.
 */
function upload(request, response, next)
{
	var form = new mod_formidable.IncomingForm();

	form.uploadDir = klDatadir;

	form.on('error', function (err) {
		request.log.error(err);
		response.send(400, err.message);
	});

	form.parse(request, function (err, fields, files) {
		form.removeAllListeners('error');
		response.send(201);
		next();
		processVideo(files['file']);
	});
}

/*
 * After a video has finished uploading, begin processing it.
 */
function processVideo(file)
{
	var vidname = file['name'];
	var filename = file['path'];
	var uuid = mod_path.basename(file['path']);
	var video;

	/*
	 * formidable picks a unique id so we shouldn't see the same name twice.
	 */
	mod_assert.ok(!klVideos.hasOwnProperty(uuid));

	video = klVideos[uuid] = {
	    'id': uuid,
	    'name': vidname,
	    'filename': filename,
	    'uploaded': mod_jsprim.iso8601(new Date()),
	    'lastUpdated': mod_jsprim.iso8601(new Date()),
	    'metadataFile': filename + '.md.json',
	    'eventsFile': filename + '.events.json',
	    'pngDir': filename + '.pngs',
	    'log': klLog.child({ 'video': vidname }),
	    'saved': false,
	    'processed': false,
	    'metadata': undefined,
	    'maxframes': undefined,
	    'frame': undefined,
	    'races': undefined,
	    'error': undefined,
	    'child': undefined,
	    'stdout': undefined,
	    'stderr': undefined
	};

	saveVideo(video, undefined, function (err) {
		if (err)
			return;

		video.saved = true;
		klVideoQueue.push(video.id);
	});
}

function saveVideo(video, metadata, callback)
{
	/*
	 * Once the upload completes, we write a blank metadata file.  If we
	 * don't find this file on startup, we assume the upload failed partway.
	 */
	var tmpfile = video.metadataFile + 'tmp';
	var keys = [ 'id', 'name', 'filename', 'uploaded', 'metadataFile',
	    'eventsFile', 'saved', 'processed', 'metadata', 'races', 'error',
	    'stdout', 'stderr', 'crtime', 'pngDir' ];
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

function vidProcessFrames(vidid, callback)
{
	var video;

	video = klVideos[vidid];

	if (!video.pngDir)
		video.pngDir = video.filename + '.pngs';

	mod_fs.mkdir(video['pngDir'], function (err) {
		if (err && err['code'] != 'EEXIST') {
			video.error = err.message;
			video.log.error(video.error);
			callback();
			return;
		}

		vidRunKartvid(vidid, callback);
	});
}

/*
 * Invoke "kartvid" to process all frames in the video.
 */
function vidRunKartvid(vidid, callback)
{
	var video, child, stdout, stderr;

	video = klVideos[vidid];
	mod_assert.ok(video.child === undefined);

	video.stdout = stdout = '';
	video.stderr = stderr = '';
	video.child = child = mod_child.spawn('out/kartvid',
	    [ 'video', '-d', video.pngDir, '-j', video.filename ]);
	video.log.info('invoking "out/kartvid video -d %s -j %s"',
	    video.pngDir, video.filename);

	child.stdout.on('data', function (chunk) { stdout += chunk; });

	mod_carrier.carry(child.stdout, mod_kartvid.parseKartvid(video));

	child.stderr.on('data', function (chunk) { stderr += chunk; });

	child.on('exit', function (code) {
		video.child = undefined;

		if (code !== 0) {
			video.error = mod_extsprintf.sprintf(
			    'kartvid exited with code %d; stderr = %s',
			    code, stderr);
			video.log.error(video.error);
			callback();
			return;
		}

		mod_fs.writeFile(video.eventsFile, stdout, function (err) {
			if (err) {
				video.error = mod_extsprintf.sprintf(
				    'failed to write %s: %s', video.eventsFile,
				    err.message);
				video.log.error(err, 'failed to write %s',
				    video.eventsFile);
				callback();
				return;
			}

			video.log.info('kartvid successfully ' +
			    'processed %s', video.filename);
			video.processed = true;
			saveVideo(video, undefined, callback);
		});
	});
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
