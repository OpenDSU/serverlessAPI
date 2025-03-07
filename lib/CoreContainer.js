function CoreContainer() {
    const plugins = {};
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

        const plugin = plugins[namespace];
        if (!plugin) {
            throw new Error(`Could not get instance for plugin ${namespace}`);
        }
        if (typeof plugin.allow !== 'function') {
            throw new Error(`The plugin for namespace ${namespace} does not implement the "allow" method`);
        }

        const canExecute = await plugin.allow(forWhom, name, ...args);
        if (canExecute === false) {
            throw Error(`User ${forWhom} is not allowed to execute commands`);
        }

        if (typeof plugin[name] !== 'function') {
            throw new Error(`The plugin for namespace ${namespace} does not implement the "${name}" method`);
        }

        return await plugin[name].call(plugin, ...args);
    }

    this.registerPlugin = async (pluginPath, namespace, config) => {
        let pluginModule;
        try {
            pluginModule = require(pluginPath);
        } catch (e) {
            throw Error(`Cannot load plugin module at path ${pluginPath}`);
        }
        if (!pluginModule) {
            throw Error(`Module at path ${pluginPath} does not export anything`);
        }
        if (typeof pluginModule.getInstance !== 'function') {
            throw Error(`Module at path ${pluginPath} does not export a function called getInstance`);
        }

        const plugin = await pluginModule.getInstance(config);
        if (!plugin) {
            throw Error(`Module at path ${pluginPath} did not return a plugin instance`);
        }
        plugins[namespace] = plugin;
    }

    this.getPluginInterface = (namespace) => {
        const plugin = plugins[namespace];
        if (!plugin) {
            throw new Error(`Could not get instance for plugin ${namespace}`);
        }
        return Object.keys(plugin);
    }

    if(!$$.loadPlugin){
        $$.loadPlugin = (namespace) => {
            return plugins[namespace];
        }
    }
}

module.exports = CoreContainer;