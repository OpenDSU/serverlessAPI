function CoreContainer() {
    const plugins = {};
    // {forWhom, name, pluginName, args}
    this.executeCommand = async (command) => {
        const {forWhom, name, pluginName, args} = command;

        if (!command || typeof command !== 'object') {
            throw new Error('Invalid command: Command must be an object');
        }
        if (!forWhom || typeof forWhom !== 'string') {
            throw new Error('Invalid command: "forWhom" must be a non-empty string');
        }
        if (!name || typeof name !== 'string') {
            throw new Error('Invalid command: "name" must be a non-empty string');
        }
        if (!pluginName || typeof pluginName !== 'string') {
            throw new Error('Invalid command: "pluginName" must be a non-empty string');
        }
        if (!Array.isArray(args)) {
            throw new Error('Invalid command: "args" must be an array');
        }

        const plugin = plugins[pluginName];
        if (!plugin) {
            throw new Error(`Could not get instance for plugin ${pluginName}`);
        }
        if (typeof plugin.allow !== 'function') {
            throw new Error(`The plugin for pluginName ${pluginName} does not implement the "allow" method`);
        }

        const canExecute = await plugin.allow(forWhom, name, ...args);
        if (canExecute === false) {
            throw Error(`User ${forWhom} is not allowed to execute commands`);
        }

        if (typeof plugin[name] !== 'function') {
            throw new Error(`The plugin for pluginName ${pluginName} does not implement the "${name}" method`);
        }

        return await plugin[name].call(plugin, ...args);
    }

    this.registerPlugin = async (pluginName, pluginPath) => {
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

        const plugin = await pluginModule.getInstance();
        if (!plugin) {
            throw Error(`Module at path ${pluginPath} did not return a plugin instance`);
        }
        plugins[pluginName] = plugin;
    }

    if (typeof globalThis.$$.throwError === "undefined") {
        async function throwError(error, ...args) {
            if (typeof error === "string") {
                error = new Error(error + " " + args.join(" "));
            }
            let errStr = args.join(" ");
            console.debug("Throwing err:", error, errStr);
            throw error;
        }

        if (typeof globalThis.$$ === "undefined") {
            globalThis.$$ = {}
        }
        $$.throwError = throwError;
    }

    if (typeof globalThis.$$.registerPlugin === "undefined") {
        globalThis.$$.registerPlugin = this.registerPlugin;
    }

    if (typeof globalThis.$$.loadPlugin === "undefined") {
        function loadPlugin(pluginName) {
            return plugins[pluginName];
        }

        globalThis.$$.loadPlugin = loadPlugin;
    }
}

module.exports = CoreContainer;