function CoreContainer(coreConfigs) {
    const cores = {};
    // cores[coreConfig.namespace] = await require(coreConfig.corePath).getCoreInstance(coreConfig.coreConfig);

    // {forWhom, name, namespace, args}
    this.executeCommand = async (command) => {
        const {forWhom, name, namespace, args} = command;

        if (!command || typeof command !== 'object') {
            throw new Error('Invalid command: Command must be an object');
        }
        if (!forWhom || typeof forWhom !== 'string') {
            throw new Error('Invalid command: "forWhom" must be a non-empty string');
        }
        if (!name || typeof name !== 'string') {
            throw new Error('Invalid command: "name" must be a non-empty string');
        }
        if (!namespace || typeof namespace !== 'string') {
            throw new Error('Invalid command: "namespace" must be a non-empty string');
        }
        if (!Array.isArray(args)) {
            throw new Error('Invalid command: "args" must be an array');
        }

        if (!cores[namespace]) {
            if (!coreConfigs[namespace] || !coreConfigs[namespace].corePath) {
                throw Error(`corePath missing for namespace ${namespace}`)
            }
            let coreModule;
            try {
                coreModule = require(coreConfigs[namespace].corePath)
            } catch (e) {
                throw Error(`Cannot load core module at path ${coreConfigs[namespace].corePath}`)
            }

            if (!coreModule) {
                throw Error(`Module at path ${coreConfigs[namespace].corePath} does not export anything`)
            }

            if (typeof coreModule.getCoreInstance !== "function") {
                throw Error(`Core module at path ${coreConfigs[namespace].corePath} does not implement the "getCoreInstance" method`);
            }

            cores[namespace] = await coreModule.getCoreInstance(coreConfigs[namespace].coreConfig);
        }

        const core = cores[namespace];
        if (!core) {
            throw new Error(`Could not get instance for core at path ${coreConfigs[namespace].corePath}`);
        }
        if (typeof core.allow !== 'function') {
            throw new Error(`The core for namespace ${namespace} does not implement the "allow" method`);
        }

        const canExecute = await core.allow(forWhom, name, ...args);
        if (canExecute === false) {
            throw Error(`User ${forWhom} is not allowed to execute commands`);
        }

        return await core[name].call(core, ...args);
    }
}

module.exports = CoreContainer;