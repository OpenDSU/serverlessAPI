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
            // validate coreConfig
            if (!coreConfigs[namespace] || !coreConfigs[namespace].corePath) {
                throw Error(`corePath missing for namespace ${namespace}`)
            }
            cores[namespace] = await require(coreConfigs[namespace].corePath).getCoreInstance(coreConfigs[namespace].coreConfig);
        }

        const core = cores[namespace];
        const canExecute = await core.allow(forWhom, name, ...args);
        if (canExecute === false) {
            throw Error(`User ${forWhom} is not allowed to execute commands`);
        }

        return await core[name](...args);
    }
}

module.exports = CoreContainer;