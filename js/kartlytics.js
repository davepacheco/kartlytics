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
var mod_kang = require('kang');
var mod_formidable = require('formidable');
var mod_restify = require('restify');
var mod_vasync = require('vasync');

var mkdirp = require('mkdirp');

var klName = 'kartlytics';
var klPort = 8085;
var klDatadir = '/var/tmp/kartlytics_data';
var klLog, klServer;

var klVideos = {};
var klVideoQueue;

function main()
{
	klLog = new mod_bunyan({ 'name': klName });
	klVideoQueue = mod_vasync.queuev({
	    'concurrency': 2,
	    'worker': vidProcessFrames
	});

	initData();
	initServer();
}

/*
 * Read all previously stored data.
 */
function initData()
{
	mkdirp.sync(klDatadir);
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

	klServer.use(mod_restify.acceptParser(klServer.acceptable));
	klServer.use(mod_restify.queryParser());
	klServer.use(mod_restify.urlEncodedBodyParser());

	filespath = mod_path.normalize(mod_path.join(__dirname, '..', 'www'));

	klServer.get('/kang/.*', mod_kang.knRestifyHandler({
	    'uri_base': '/kang',
	    'service_name': 'kartlytics',
	    'version': '0.0.1',
	    'ident': mod_os.hostname(),
	    'list_types': kangListTypes,
	    'list_objects': kangListObjects,
	    'get': kangGetObject
	}));

	klServer.get('/', redirect.bind(null, '/f/index.htm'));
	klServer.get('/f/.*', fileServer.bind(null, '/f/', filespath));
	klServer.post('/kart/video', upload);

	klServer.on('after', mod_restify.auditLogger({ 'log': klLog }));

	klServer.listen(klPort, function () {
		klLog.info('%s server listening at %s',
		    klServer.name, klServer.url);
	});
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
function fileServer(baseuri, basedir, request, response, next)
{
	/*
	 * This is only safe as long as there are no symlinks inside this
	 * directory tree.  We don't bother trying to avoid them, since doing
	 * it correctly (without races) is much more complex than we really
	 * need here.
	 */
	mod_assert.equal(baseuri, request.path.substr(0, baseuri.length));

	var filename = mod_path.normalize(
	    mod_path.join(basedir, request.path.substr(baseuri.length)));

	if (filename.substr(0, basedir.length) != basedir) {
		request.log.warn('denying request for file outside of %s',
		    basedir);
		next(new mod_restify.ResourceNotFoundError());
		return;
	}

	var file = mod_fs.createReadStream(filename);

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
		response.writeHead(200);
		file.pipe(response);

		file.on('error', function (err) {
			request.log.warn(err);
			response.end();
		});
	});

	file.on('end', next);
}

/*
 * Restify handler for handling form uploads.
 */
function upload(request, response, next)
{
	var form = new mod_formidable.IncomingForm();

	form.uploadDir = klDatadir;
	form.keepExtensions = true;

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
	    'uploaded': new Date(),
	    'metadataFile': filename + '.md.json',
	    'eventsFile': filename + '.events.json',
	    'saved': false,
	    'confirmed': false,
	    'maxframes': undefined,
	    'frame': undefined,
	    'log': undefined,
	    'races': undefined,
	    'error': undefined,
	    'child': undefined,
	    'stdout': undefined,
	    'stderr': undefined
	};

	/*
	 * Once the upload completes, we write a blank metadata file.  If we
	 * don't find this file on startup, we assume the upload failed partway.
	 */
	mod_fs.writeFile(video.metadataFile, JSON.stringify(video, null, 4),
	    function (err) {
		if (err) {
			klLog.error(err, 'failed to write metadata file %s',
			    video['metadataFile']);
			return;
		}

		video.saved = true;
		video.log = klLog.child({ 'video': vidname });
		klVideoQueue.push(video.id);
	    });
}

/*
 * Invoke "kartvid" to process all frames in the video.
 */
function vidProcessFrames(vidid, callback)
{
	var video, child, stdout, stderr;

	video = klVideos[vidid];
	mod_assert.ok(video.child === undefined);

	video.stdout = stdout = '';
	video.stderr = stderr = '';
	video.child = child = mod_child.spawn('out/kartvid',
	    [ 'video', '-j', video.filename ]);
	video.log.info('invoking "out/kartvid video -j %s"', video.filename);

	child.stdout.on('data', function (chunk) { stdout += chunk; });

	mod_carrier.carry(child.stdout, parseKartvid(video));

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

		video.log.info('kartvid successfully processed %s',
		    video.filename);
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

			callback();
		});
	});
}

/*
 * Returns a function that takes individual lines of kartvid output and parses
 * it, storing the results in video.races.
 */
function parseKartvid(video)
{
	var log = video.log;
	var races = video.races = [];
	var i = 0;
	var race, segment, entry;

	return (function (line) {
		++i;

		if (line.length === 0)
			return;

		try {
			entry = JSON.parse(line);
		} catch (ex) {
			log.warn(ex, 'ignoring bad JSON object at line %s', i);
			return;
		}

		if (i == 1 && entry.nframes) {
			video.maxframes = entry.nframes;
			return;
		}

		video.frame = entry.frame;

		if (entry.start) {
			if (race !== undefined)
				log.warn('ignoring race aborted at %s',
				    entry.source);

			race = { 'start': entry, 'segments': [] };
			return;
		}

		if (race === undefined) {
			log.warn('ignoring line %d (not in a race)');
			return;
		}

		if (!entry.done) {
			if (segment !== undefined) {
				segment.end = entry.time;
				race['segments'].push(segment);
			}

			segment = {
				'start': entry.time,
				'players': entry.players
			};

			return;
		}

		if (segment !== undefined) {
			segment.end = entry.time;
			race['segments'].push(segment);
		}

		race.end = entry.time;
		race.results = entry.players;
		races.push(race);
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
		'confirmed': video.confirmed,
		'frame': video.frame,
		'maxframes': video.maxframes,
		'races': video.races,
		'error': video.error
	});
}

main();
