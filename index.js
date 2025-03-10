const path = require("path");
const bundlePath = path.join(process.env.PSK_ROOT_INSTALATION_FOLDER, 'builds/output/pskWebServer.js');
require(bundlePath);

process.on('uncaughtException', err => {
    console.error('There was an uncaught error', err);
    // Notify parent process of the error
    if (process.connected) {
        process.send({ type: 'error', error: err.message });
    }
});

process.on('SIGTERM', (signal) => {
    process.shuttingDown = true;
    console.info('Received signal:', signal, ". Activating the gracefulTerminationWatcher.");
    shutdown();
});

let server = null;

function shutdown() {
    if (server) {
        server.close(() => {
            console.info('Server has been gracefully shut down');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
}

function ServerlessAPI(config) {
    let {storage, port, dynamicPort, host, urlPrefix, coreConfigs} = config;
    const httpWrapper = require("./httpWrapper");
    const Server = httpWrapper.Server;
    const bodyReaderMiddleware = require("./httpWrapper/utils/middlewares").bodyReaderMiddleware;
    const CoreContainer = require("./lib/CoreContainer");
    const coreContainer = new CoreContainer(coreConfigs);
    const CHECK_FOR_RESTART_COMMAND_FILE_INTERVAL = 500;
    host = host || "127.0.0.1";
    port = port || 8082;

    const server = new Server();
    server.config = config.serverConfig || config;
    if (!config.storage) {
        config.storage = storage;
    }

    let accessControlAllowHeaders = new Set();
    accessControlAllowHeaders.add("Content-Type");
    accessControlAllowHeaders.add("Content-Length");
    accessControlAllowHeaders.add("X-Content-Length");
    accessControlAllowHeaders.add("Access-Control-Allow-Origin");
    accessControlAllowHeaders.add("User-Agent");
    accessControlAllowHeaders.add("Authorization");

    let listenCallback = (err) => {
        if (err) {
            if (dynamicPort && err.code === 'EADDRINUSE') {
                console.debug("Failed to listen on port <" + port + ">", err);

                function getRandomPort() {
                    const min = 9000;
                    const max = 65535;
                    return Math.floor(Math.random() * (max - min) + min);
                }

                port = getRandomPort();
                if (Number.isInteger(dynamicPort)) {
                    dynamicPort -= 1;
                }
                setTimeout(boot, CHECK_FOR_RESTART_COMMAND_FILE_INTERVAL);
                return
            }
            console.error(err);
            // Notify parent process of the error
            if (process.connected) {
                process.send({ type: 'error', error: err.message || 'Failed to start server' });
            }
        }
    };

    function bindFinished(err) {
        if (err) {
            console.error(err);
            // Notify parent process of the error
            if (process.connected) {
                process.send({ type: 'error', error: err.message || 'Failed to bind server' });
            }
            return;
        }

        console.info(`LightDB server running at port: ${port}`);
        registerEndpoints();

        // Notify parent process that server is ready with the URL
        if (process.connected) {
            const serverUrl = server.getUrl();
            process.send({
                type: 'ready',
                url: serverUrl,
                port: port
            });
            console.info(`Server URL: ${serverUrl} sent to parent process`);
        }
    }

    function boot() {
        console.debug(`Trying to listen on port ${port}`);
        server.listen(port, host, listenCallback);
    }

    boot();

    server.on('listening', bindFinished);
    server.on('error', listenCallback);

    function registerEndpoints() {
        server.getAccessControlAllowHeadersAsString = function () {
            let headers = "";
            let notFirst = false;
            for (let header of accessControlAllowHeaders) {
                if (notFirst) {
                    headers += ", ";
                }
                notFirst = true;
                headers += header;
            }
            return headers;
        }

        server.use(function gracefulTerminationWatcher(req, res, next) {
            if (process.shuttingDown) {
                //uncaught exception was caught so server is shutting down gracefully and not accepting any requests
                res.statusCode = 503;
                console.log(0x02, `Rejecting ${req.url} with status code ${res.statusCode} because process is shutting down.`);
                res.end();
                return;
            }
            //if the shuttingDown flag not present, we let the request go on...
            next();
        });


        server.use(function (req, res, next) {
            res.setHeader('Access-Control-Allow-Origin', req.headers.origin || req.headers.host || "*");
            res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
            res.setHeader('Access-Control-Allow-Credentials', true);
            next();
        });

        server.put(`${urlPrefix}/executeCommand`, bodyReaderMiddleware);

        function errorReplacer(key, value) {
            // Check if the value is an Error object
            if (value instanceof Error) {
                // Return an object with the properties you want
                return {
                    name: value.name,
                    message: value.message,
                    stack: value.stack,
                    // Optionally, include any other custom properties
                    ...value
                };
            }
            return value;
        }

        const executeCommand = async (req, res) => {
            let command = req.body;
            try {
                command = JSON.parse(command);
            } catch (e) {
                console.error("Invalid body", command);
                res.statusCode = 400;
                return res.end(JSON.stringify({err: "Invalid body"}));
            }
            let resObj = {err: undefined, result: undefined};
            try {
                resObj.result = await coreContainer.executeCommand(command);
                res.statusCode = 200;

            } catch (e) {
                res.statusCode = 500;
                resObj.err = e;
            }
            try {
                res.end(JSON.stringify(resObj, errorReplacer));
            } catch (e) {
                res.statusCode = 500;
                res.end(JSON.stringify({err: e}, errorReplacer));
            }

        }

        server.put(`${urlPrefix}/executeCommand`, executeCommand);

        server.put(`${urlPrefix}/registerPlugin`, bodyReaderMiddleware);
        server.put(`${urlPrefix}/registerPlugin`, async (req, res) => {
            let parsedBody;
            try {
                parsedBody = JSON.parse(req.body);
            } catch (e) {
                res.statusCode = 400;
                res.end(JSON.stringify({err: "Invalid body"}));
                return;
            }
            let {pluginPath, pluginName} = parsedBody;
            try {
                await coreContainer.registerPlugin(pluginName, pluginPath);
                res.statusCode = 200;
                res.end();
            } catch (e) {
                res.statusCode = 500;
                res.end(JSON.stringify({err: e}));
            }
        })
    }
    server.getUrl = () => {
        return `http://${host}:${port}${urlPrefix}`;
    }
    return server;
}

// Listen for messages from the parent process
process.on('message', (message) => {
    if (message.type === 'start') {
        // Start the server with the provided configuration
        server = ServerlessAPI(message.config);
    } else if (message.type === 'shutdown') {
        // Gracefully shut down the server
        shutdown();
    }
});