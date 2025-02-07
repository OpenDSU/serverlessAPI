process.on('uncaughtException', err => {
    console.error('There was an uncaught error', err);
});

process.on('SIGTERM', (signal) => {
    process.shuttingDown = true;
    console.info('Received signal:', signal, ". Activating the gracefulTerminationWatcher.");
});

function ServerlessAPI(config, callback) {
    let {storage, port, dynamicPort, host, urlPrefix, corePath, coreConfig} = config;
    const httpWrapper = require("./httpWrapper");
    const Server = httpWrapper.Server;
    const bodyParser = require("./httpWrapper/utils/middlewares").bodyReaderMiddleware;
    const Core = require(corePath);
    let core;
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
            if (!dynamicPort && callback) {
                return callback(err);
            }
        }
    };

    function bindFinished(err) {
        if (err) {
            console.error(err);
            if (callback) {
                return callback(err);
            }
            return;
        }

        console.info(`LightDB server running at port: ${port}`);
        registerEndpoints();
        if (callback) {
            callback(undefined, server);
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

        server.put(`${urlPrefix}/executeCommand`, bodyParser);

        const executeCommand = async (req, res) => {
            if (!core) {
                core = await Core.getCoreInstance(coreConfig);
            }
            let command = req.body;
            try {
                command = JSON.parse(command);
            } catch (e) {
                console.error("Invalid body", command);
                res.statusCode = 400;
                res.write("Invalid body");
                return res.end();
            }

            if(core.allow(command.forWhom, command.name, command.args) === false){
                res.statusCode = 401;
                return res.end(`User ${command.forWhom} is not allowed to execute commands`);
            }

            core[command.name](...command.args, (err, result) => {
                let res = {err, result};
                if (err) {
                    res.statusCode = 500;
                } else {
                    res.statusCode = 200;
                }
                res.end(JSON.stringify(res));
            });
        }

        server.put(`${urlPrefix}/executeCommand`, executeCommand);
    }

    server.getUrl = () => {
        return `http://${host}:${port}${urlPrefix}`;
    }

    return server;
}

const createServerlessAPI = (config, callback) => {
    return new ServerlessAPI(config, callback);
}
module.exports = {
    createServerlessAPI
}
