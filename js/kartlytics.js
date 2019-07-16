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
var mod_fs = require('fs');
var mod_path = require('path');

var mod_bunyan = require('bunyan');
var mod_getopt = require('posix-getopt');
var mod_formidable = require('formidable');
var mod_restify = require('restify');

var mod_kartvid = require('./kartvid');

var klName = 'kartlytics';
var klPort = 8085;
var klAuthfile;
var klAuth, klLog, klServer;

var klVideos = {};

function main()
{
	var parser, option;

	parser = new mod_getopt.BasicParser('l:a:', process.argv);

	while ((option = parser.getopt())) {
		if (option.error)
			usage();

		switch (option.option) {
		case 'l':
			klPort = parseInt(option.optarg, 10);
			if (isNaN(klPort))
				usage();
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
	var contents;

	if (klAuthfile) {
		klLog.info('loading auth file %s', klAuthfile);
		contents = mod_fs.readFileSync(klAuthfile);
		klAuth = JSON.parse(contents);
	}
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
	klServer.on('uncaughtException', function (_1, _2, _3, err) {
		klLog.fatal(err, 'uncaught exception from restify handler');
		throw (err);
	});

	klServer.use(mod_restify.authorizationParser());
	klServer.use(mod_restify.acceptParser(klServer.acceptable));
	klServer.use(mod_restify.queryParser());
	klServer.use(mod_restify.urlEncodedBodyParser());

	filespath = mod_path.normalize(mod_path.join(__dirname, '..', 'docs'));

	klServer.get('/', fileServer.bind(
	    null, mod_path.join(filespath, 'index.htm')));
	klServer.get('/resources/.*', dirServer.bind(null, '/resources/',
	    mod_path.join(filespath, 'resources')));
	klServer.post('/kart/video', auth, upload);

	klServer.on('after', mod_restify.auditLogger({ 'log': klLog }));

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
	mod_assert.equal(baseuri, request.path().substr(0, baseuri.length));

	var filename = mod_path.normalize(
	    mod_path.join(basedir, decodeURIComponent(
	    request.path().substr(baseuri.length))));

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
	headers['access-control-allow-origin'] = '*';

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
 * Restify handler for handling form uploads.
 */
function upload(request, response, next)
{
	next(new mod_restify.BadRequestError('Unauthorized'));
}

main();
