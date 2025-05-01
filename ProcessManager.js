/**
 * ProcessManager.js
 * 
 * A class that abstracts process management functionality for serverless APIs
 * in the OpenDSU framework. It handles process creation, communication, and lifecycle
 * management for child processes.
 */

const { fork } = require('child_process');
const path = require('path');

class ProcessManager {
    constructor() {
        this.processes = new Map(); // Map to track all managed processes
        this.restartingProcesses = new Set(); // Set to track processes that are currently restarting
    }

    /**
     * Checks if a process is currently restarting
     * 
     * @param {string} processId - Process identifier
     * @returns {boolean} - Whether the process is restarting
     */
    isRestarting(processId) {
        return this.restartingProcesses.has(processId);
    }

    /**
     * Forks a new child process with the given configuration
     * 
     * @param {string} scriptPath - Path to the script to be executed
     * @param {Object} config - Configuration for the script
     * @param {Object} envVars - Environment variables to pass to the child process
     * @returns {Promise<Object>} - A promise that resolves with information about the process
     */
    forkProcess(scriptPath, config, envVars = {}) {
        return new Promise((resolve, reject) => {
            const processId = config.id || `process-${Date.now()}`;
            const forkOptions = {
                env: { ...process.env, ...envVars }
            };

            console.log(`Forking process: ${scriptPath} with env keys: ${Object.keys(envVars).join(', ')}`);
            const childProcess = fork(scriptPath, [], forkOptions);
            let isReady = false;

            // Setup logging
            if (childProcess.stdout) {
                childProcess.stdout.on('data', (data) => {
                    console.log(`[${processId} PID:${childProcess.pid} STDOUT]: ${data.toString().trim()}`);
                });
            } else {
                console.warn(`[${processId} PID:${childProcess.pid}] Forked process object is missing stdout stream!`);
            }

            if (childProcess.stderr) {
                childProcess.stderr.on('data', (data) => {
                    console.error(`[${processId} PID:${childProcess.pid} STDERR]: ${data.toString().trim()}`);
                });
            } else {
                console.warn(`[${processId} PID:${childProcess.pid}] Forked process object is missing stderr stream!`);
            }

            const readyTimeout = setTimeout(() => {
                if (!isReady && childProcess && !childProcess.killed) {
                    console.error(`Timeout waiting for new process ${processId} (PID: ${childProcess.pid}) to become ready. Killing process.`);
                    childProcess.kill('SIGTERM');
                }
                reject(new Error(`Timeout waiting for process ${processId} to become ready.`));
            }, 30000);

            const cleanupTimeout = () => clearTimeout(readyTimeout);

            childProcess.on('message', (message) => {
                if (message.type === 'ready') {
                    cleanupTimeout();
                    isReady = true;
                    console.log(`Process ${processId} (PID: ${childProcess.pid}) reported ready at ${message.url}`);

                    const processInfo = {
                        process: childProcess,
                        url: message.url,
                        port: message.port,
                        config,
                        scriptPath,
                        id: processId
                    };

                    this.processes.set(processId, processInfo);

                    this._setupPersistentHandlers(processId, processInfo);

                    resolve(processInfo);
                } else if (message.type === 'error') {
                    cleanupTimeout();
                    console.error(`Process ${processId} (PID: ${childProcess.pid}) reported an error during startup:`, message.error);
                    if (childProcess && !childProcess.killed) {
                        childProcess.kill();
                    }
                    reject(new Error(message.error));
                }
            });

            childProcess.on('error', (err) => {
                cleanupTimeout();
                console.error(`Error spawning or communicating with process ${processId} (PID: ${childProcess.pid || 'N/A'}):`, err);
                if (childProcess && !childProcess.killed) {
                    childProcess.kill();
                }
                reject(err);
            });

            childProcess.on('exit', (code, signal) => {
                cleanupTimeout();
                if (!isReady) {
                    console.error(`Child process ${processId} (PID: ${childProcess.pid || 'N/A'}) exited prematurely with code ${code}, signal ${signal}.`);
                    reject(new Error(`Child process ${processId} exited prematurely with code ${code}, signal ${signal}.`));
                }
            });

            console.log(`Sending 'start' command to process ${processId} (PID: ${childProcess.pid})`);
            childProcess.send({ type: 'start', config });
        });
    }

    /**
     * Loads environment variables from secrets for a process
     * 
     * @param {string} processId - The process identifier
     * @param {string} storagePath - Path to the storage for secrets service
     * @returns {Promise<Object>} - A promise that resolves with the environment variables
     * @private
     */
    async _loadEnvironmentFromSecrets(processId, storagePath) {
        console.log(`Loading environment variables from secrets for ${processId}`);
        let envVars = {};

        try {
            const secretsService = await require('../components/secrets/SecretsService')
                .getSecretsServiceInstanceAsync(storagePath);

            let secretsEnv = await secretsService.getSecretsAsync(processId);

            if (!secretsEnv && processId !== 'env') {
                console.log(`No env vars found for ID ${processId}, trying generic 'env' key.`);
                secretsEnv = await secretsService.getSecretsAsync('env');
            }

            if (typeof secretsEnv === 'object' && secretsEnv !== null) {
                envVars = secretsEnv;
                console.log(`Loaded environment variables from secrets service for ${processId}.`);
            } else {
                console.log(`Environment variables from secrets service for ${processId} were not an object, using empty env.`);
            }
        } catch (err) {
            console.log(`No environment variables found in secrets service for ${processId}, continuing with empty env:`, err.message);
        }

        return envVars;
    }

    /**
     * Creates a serverless API by forking a child process
     * 
     * @param {Object} config - Configuration for the serverless API
     * @returns {Promise<Object>} - A promise that resolves with the serverless API proxy
     */
    async createServerlessAPI(config) {
        if (!config || !config.storage) {
            throw new Error("Storage path must be defined for ServerlessAPI initialization");
        }

        const serverlessAPIPath = path.resolve(path.join(process.env.PSK_ROOT_INSTALATION_FOLDER, `.${__dirname}`, 'index.js'))

        const serverId = config.urlPrefix || `process-${Date.now()}`;
        if (!config.id) {
            config.id = serverId;
        }

        let initialEnv = {};

        if (config.env && typeof config.env === 'object') {
            initialEnv = { ...config.env };
            console.log(`Using provided environment variables for process ${serverId}.`);
        } else {
            console.log(`No env vars in config for ${serverId}, trying secrets service.`);
            initialEnv = await this._loadEnvironmentFromSecrets(serverId, config.storage);
        }

        const processInfo = await this.forkProcess(serverlessAPIPath, config, initialEnv);

        return {
            url: processInfo.url,
            port: processInfo.port,
            process: processInfo.process,
            config: config,
            scriptPath: serverlessAPIPath,

            close: () => {
                return new Promise((resolveClose) => {
                    processInfo.process.send({ type: 'shutdown' });
                    processInfo.process.on('exit', () => {
                        this.processes.delete(processInfo.id);
                        resolveClose();
                    });
                });
            },

            getUrl: () => processInfo.url,

            kill: () => {
                processInfo.process.kill('SIGTERM');
                this.processes.delete(processInfo.id);
            }
        };
    }

    /**
     * Sets up persistent handlers for a registered process
     * 
     * @param {string} processId - Identifier for the process
     * @param {Object} processInfo - Information about the process
     * @private
     */
    _setupPersistentHandlers(processId, processInfo) {
        const { process: childProcess } = processInfo;

        childProcess.on('exit', (code, signal) => {
            console.warn(`Registered process ${processId} (PID: ${childProcess.pid || 'N/A'}) exited with code ${code}, signal ${signal}. Removing registration.`);
            this.processes.delete(processId);
        });

        childProcess.on('error', (err) => {
            console.error(`Error from registered process ${processId} (PID: ${childProcess.pid || 'N/A'}):`, err);
            this.processes.delete(processId);
        });
    }

    /**
     * Attempts to restart a process with updated environment variables
     * 
     * @param {string} processId - Identifier of the process to restart
     * @param {Object} envVars - New environment variables
     * @returns {Promise<Object>} - A promise that resolves with information about the new process
     */
    async restartProcess(processId, envVars = {}) {
        const processInfo = this.processes.get(processId);

        if (!processInfo) {
            throw new Error(`No process found with ID ${processId}`);
        }

        this.restartingProcesses.add(processId);

        const { config, scriptPath } = processInfo;

        if (Object.keys(envVars).length === 0 && config.storage) {
            envVars = await this._loadEnvironmentFromSecrets(processId, config.storage);
        }

        console.log(`Stopping old process ${processId} (PID: ${processInfo.process.pid}) before restart.`);
        if (processInfo.process && !processInfo.process.killed) {
            const shutdownPromise = new Promise((resolve) => {
                const forceKillTimeout = setTimeout(() => {
                    console.warn(`Force killing process ${processId} (PID: ${processInfo.process.pid}) after waiting for shutdown`);
                    if (!processInfo.process.killed) {
                        processInfo.process.kill('SIGKILL'); // Force kill with SIGKILL
                    }
                }, 5000);

                processInfo.process.once('exit', (code, signal) => {
                    clearTimeout(forceKillTimeout);
                    console.log(`Process ${processId} (PID: ${processInfo.process.pid}) exited with code ${code}, signal ${signal}`);
                    resolve();
                });

                processInfo.process.removeAllListeners('error');

                processInfo.process.once('error', (err) => {
                    clearTimeout(forceKillTimeout);
                    console.error(`Error during shutdown of process ${processId}:`, err);
                    resolve();
                });

                try {
                    processInfo.process.send({ type: 'shutdown' });
                } catch (err) {
                    console.warn(`Could not send shutdown message to process ${processId}, killing directly:`, err.message);
                    if (!processInfo.process.killed) {
                        processInfo.process.kill('SIGTERM');
                    }
                }
            });

            await shutdownPromise;
            console.log(`Process ${processId} shutdown confirmed`);
        }

        this.processes.delete(processId);

        console.log(`Attempting to fork new process ${processId} with updated environment.`);

        try {
            const newProcessInfo = await this.forkProcess(scriptPath, config, envVars);

            this.restartingProcesses.delete(processId);

            return newProcessInfo;
        } catch (error) {
            this.restartingProcesses.delete(processId);
            throw error;
        }
    }

    /**
     * Gets information about a managed process
     * 
     * @param {string} processId - The process identifier
     * @returns {Object|null} - Process information or null if not found
     */
    getProcessInfo(processId) {
        if (this.isRestarting(processId) && this.processes.has(processId)) {
            const processInfo = this.processes.get(processId);
            return {
                ...processInfo,
                restarting: true
            };
        }
        return this.processes.get(processId) || null;
    }

    /**
     * Gets all managed processes
     * 
     * @returns {Map<string, Object>} - Map of all managed processes
     */
    getAllProcesses() {
        return this.processes;
    }

    /**
     * Terminates all managed processes
     * 
     * @returns {Promise<void>}
     */
    async terminateAll() {
        const shutdownPromises = [];

        for (const [processId, processInfo] of this.processes.entries()) {
            console.log(`Shutting down process ${processId}`);
            const shutdownPromise = new Promise((resolve) => {
                if (!processInfo.process || processInfo.process.killed) {
                    resolve();
                    return;
                }

                processInfo.process.send({ type: 'shutdown' });

                const timeoutId = setTimeout(() => {
                    console.warn(`Process ${processId} didn't exit gracefully, forcing termination`);
                    if (!processInfo.process.killed) {
                        processInfo.process.kill('SIGTERM');
                    }
                    resolve();
                }, 5000);

                processInfo.process.once('exit', () => {
                    clearTimeout(timeoutId);
                    resolve();
                });
            });

            shutdownPromises.push(shutdownPromise);
        }

        await Promise.all(shutdownPromises);
        this.processes.clear();
    }
}

module.exports = ProcessManager; 