/*
 * kartlytics.js: kartlytics server
 */

var mod_assert = require('assert');
var mod_fs = require('fs');
var mod_path = require('path');

var mod_bunyan = require('bunyan');
var mod_restify = require('restify');

var klPort = 8085;
var klLog, klServer;

function main()
{
	var filespath;

	klLog = new mod_bunyan({
	    'name': 'kartlytics'
	});

	klServer = mod_restify.createServer({
	    'name': 'kartlytics',
	    'log': klLog
	});

	klServer.use(mod_restify.acceptParser(klServer.acceptable));
	klServer.use(mod_restify.queryParser());
	klServer.use(mod_restify.urlEncodedBodyParser());

	filespath = mod_path.normalize(mod_path.join(__dirname, '..', 'www'));

	klServer.get('/', redirect.bind(null, '/index.htm'));
	klServer.get('/.*', fileServer.bind(null, '/', filespath));

	klServer.on('after', mod_restify.auditLogger({ 'log': klLog }));

	klServer.listen(klPort, function () {
		klLog.info('%s server listening at %s',
		    klServer.name, klServer.url);
	});
}

function redirect(path, request, response, next)
{
	response.header('Location', path);
	response.send(301);
	next();
}

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

main();
