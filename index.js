// Process environment variables from parent process if available
process.on('message', (message) => {
    if (message.type === 'start') {
        // Start the server with the provided configuration
        server = ServerlessAPI(message.config);
    } else if (message.type === 'shutdown') {
        // Gracefully shut down the server
        shutdown();
    }
});

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
    let { storage, port, dynamicPort = true, host, urlPrefix } = config;
    console.log("++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++")
    console.log("SERVERLESS_ID before", process.env.SERVERLESS_ID)
    process.env.SERVERLESS_ID = config.urlPrefix;
    console.log("SERVERLESS_ID after", process.env.SERVERLESS_ID)
    console.log("++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++")
    // Validate that storage is defined
    if (!storage) {
        throw new Error("Storage path must be defined for ServerlessAPI initialization");
    }

    urlPrefix = `/${urlPrefix}`;
    const httpWrapper = require("../http-wrapper");
    const Server = httpWrapper.Server;
    const bodyReaderMiddleware = require("../http-wrapper/utils/middlewares").bodyReaderMiddleware;
    const PluginManager = require("./lib/PluginManager");

    // Create the plugin manager with storage path for plugin discovery
    const pluginManager = new PluginManager(storage);

    // Initialize plugin manager to discover and load plugins
    (async () => {
        try {
            console.log(`Initializing PluginManager with storage path: ${storage}`);
            await pluginManager.init();
            console.log('PluginManager initialization completed');
        } catch (error) {
            console.error('Error initializing PluginManager:', error);
        }
    })();

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

                // Try to find a free port recursively
                const net = require('net');
                const testServer = net.createServer();

                function tryNextPort() {
                    port = getRandomPort();
                    if (Number.isInteger(dynamicPort)) {
                        dynamicPort -= 1;
                    }

                    testServer.once('error', (err) => {
                        if (err.code === 'EADDRINUSE') {
                            // Port is in use, try another one
                            testServer.close();
                            tryNextPort();
                        } else {
                            // Only send non-port-related errors to parent
                            if (process.connected) {
                                process.send({ type: 'error', error: err.message || 'Failed to start server' });
                            }
                        }
                    });

                    testServer.once('listening', () => {
                        testServer.close();
                        boot();
                    });

                    testServer.listen(port);
                }

                tryNextPort();
                return;
            }
            // Only send non-port-related errors to parent
            console.error(err);
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
                type: 'ready', url: serverUrl, port: port
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

        const executeCommand = async (req, res) => {
            let resObj = { statusCode: undefined, result: undefined, operationType: undefined };
            let command = req.body;
            try {
                command = JSON.parse(command);
            } catch (e) {
                console.error("Invalid body", command);
                res.statusCode = 400;
                resObj.statusCode = 400;
                resObj.result = "Invalid body";
                return res.end(JSON.stringify(resObj));
            }
            try {
                let pluginResult = await pluginManager.executeCommand(command);
                resObj.statusCode = 200;
                resObj.operationType = pluginResult.operationType;
                resObj.result = pluginResult.result;
                res.statusCode = 200;
            } catch (e) {
                res.statusCode = 500;
                resObj.statusCode = 500;
                console.error(e);
                resObj.result = {
                    message: e.message,
                    stack: e.stack
                };
            }
            res.end(JSON.stringify(resObj));
        }

        server.put(`${urlPrefix}/executeCommand`, executeCommand);

        server.get(`${urlPrefix}/ready`, async (req, res) => {
            let resObj = { statusCode: undefined, result: undefined };
            let isInitialized = false;
            try {
                isInitialized = pluginManager.isInitialized();
                if (isInitialized) {
                    resObj.statusCode = 200;
                    resObj.result = {
                        status: 'ready',
                        timestamp: Date.now()
                    };
                } else {
                    resObj.statusCode = 200;
                    resObj.result = 'not-ready';
                }
            } catch (e) {
                console.error('Error checking if plugins are initialized:', e);
                res.statusCode = 500;
                resObj.statusCode = 500;
                resObj.result = e.message;
            }
            res.end(JSON.stringify(resObj));
        });

        server.get(`${urlPrefix}/getPublicMethods/:pluginName`, async (req, res) => {
            let resObj = { statusCode: undefined, result: undefined };
            let pluginName = req.params.pluginName;
            if (!pluginName) {
                resObj.statusCode = 400;
                resObj.result = "Plugin name is required";
                return res.end(JSON.stringify(resObj));
            }
            try {
                let publicMethods = pluginManager.getPublicMethods(pluginName);
                resObj.statusCode = 200;
                resObj.result = publicMethods;
            } catch (error) {
                resObj.statusCode = 404;
                resObj.result = error.message;
            }
            res.end(JSON.stringify(resObj));
        });
    }

    server.getUrl = () => {
        return `http://${host}:${port}${urlPrefix}`;
    }

    return server;
}