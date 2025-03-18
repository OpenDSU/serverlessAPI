const fs = require('fs');
const path = require('path');

function PluginManager(rootFolder) {
    const plugins = {};
    this.rootFolder = rootFolder || process.cwd();
    let loadOrder = []; // Track the order plugins were loaded in
    
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

    /**
     * Load a plugin module from a file path and get its exports
     * @param {string} pluginPath - Path to the plugin file
     * @returns {Object} - The plugin module exports
     */
    const loadPluginModule = (pluginPath) => {
        try {
            return require(pluginPath);
        } catch (e) {
            throw Error(`Cannot load plugin module at path ${pluginPath}: ${e.message}`);
        }
    };

    this.registerPlugin = async (pluginName, pluginPath) => {
        let pluginModule;
        try {
            pluginModule = loadPluginModule(pluginPath);
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
        plugin.allow = pluginModule.getAllow();
        if (!plugin) {
            throw Error(`Module at path ${pluginPath} did not return a plugin instance`);
        }

        if(plugins[pluginName]){
            throw Error(`Plugin ${pluginName} already registered`);
        }

        plugins[pluginName] = plugin;
        loadOrder.push(pluginName); // Track the loading order
    }

    /**
     * Build a dependency graph from plugins' getDependencies functions
     * @param {Object} pluginModules - Object containing plugin modules keyed by plugin name
     * @returns {Object} - Adjacency list representing the dependency graph
     */
    const buildDependencyGraph = (pluginModules) => {
        const graph = {};
        
        // Initialize the graph with all nodes
        Object.keys(pluginModules).forEach(pluginName => {
            graph[pluginName] = [];
        });
        
        // Add edges for each dependency
        Object.keys(pluginModules).forEach(pluginName => {
            const pluginModule = pluginModules[pluginName];
            // Get dependencies from getDependencies function if it exists
            const dependencies = typeof pluginModule.getDependencies === 'function' 
                ? pluginModule.getDependencies() 
                : [];
                
            dependencies.forEach(dep => {
                if (graph[dep]) {
                    graph[dep].push(pluginName);
                } else {
                    console.warn(`Warning: Plugin ${pluginName} depends on ${dep}, but ${dep} was not found.`);
                }
            });
        });
        
        return graph;
    };
    
    /**
     * Perform a topological sort on the dependency graph
     * @param {Object} graph - Adjacency list representing the dependency graph
     * @returns {Array} - Plugins in topologically sorted order
     */
    const topologicalSort = (graph) => {
        const visited = {};
        const temp = {};
        const order = [];
        
        // Mark all nodes as not visited
        Object.keys(graph).forEach(node => {
            visited[node] = false;
            temp[node] = false;
        });
        
        const visit = (node) => {
            // If node is already in temp, we have a cycle
            if (temp[node]) {
                throw new Error(`Circular dependency detected involving plugin ${node}`);
            }
            
            // If node is already visited, skip
            if (visited[node]) {
                return;
            }
            
            // Mark node as being visited
            temp[node] = true;
            
            // Visit all dependencies
            graph[node].forEach(dependency => {
                visit(dependency);
            });
            
            // Mark node as visited
            temp[node] = false;
            visited[node] = true;
            
            // Add node to order
            order.unshift(node);
        };
        
        // Visit all nodes
        Object.keys(graph).forEach(node => {
            if (!visited[node]) {
                visit(node);
            }
        });
        
        return order;
    };
    
    /**
     * Initialize the plugin manager by discovering and registering plugins
     * based on their dependenciesW
     * @returns {Promise<void>}
     */
    this.init = async () => {
        // Reset the load order on init
        loadOrder = [];
        
        const pluginsDir = path.join(this.rootFolder, 'plugins');
        
        // Check if plugins directory exists
        if (!fs.existsSync(pluginsDir)) {
            console.warn(`Plugins directory not found at ${pluginsDir}`);
            return;
        }
        
        // Discover plugin files
        const pluginFiles = fs.readdirSync(pluginsDir)
            .filter(file => file.endsWith('.js'))
            .map(file => path.join(pluginsDir, file));
        
        if (pluginFiles.length === 0) {
            console.warn(`No plugin files found in ${pluginsDir}`);
            return;
        }
        
        // Load plugin modules and map them by name (derived from filename)
        const pluginModules = {};
        
        for (const pluginFile of pluginFiles) {
            try {
                const pluginModule = loadPluginModule(pluginFile);
                // Use filename (without extension) as the plugin name
                const pluginName = path.basename(pluginFile, '.js');
                pluginModules[pluginName] = pluginModule;
            } catch (error) {
                console.error(`Error loading plugin from ${pluginFile}: ${error.message}`);
            }
        }
        
        // Build dependency graph
        const graph = buildDependencyGraph(pluginModules);
        
        // Sort plugins topologically based on dependencies
        const sortedPlugins = topologicalSort(graph);
        
        // Register plugins in order
        for (const pluginName of sortedPlugins) {
            try {
                const pluginModule = pluginModules[pluginName];
                const pluginFile = path.join(pluginsDir, `${pluginName}.js`);
                
                if (fs.existsSync(pluginFile)) {
                    await this.registerPlugin(pluginName, pluginFile);
                    console.log(`Registered plugin: ${pluginName}`);
                } else {
                    console.error(`Plugin file not found for ${pluginName}`);
                }
            } catch (error) {
                console.error(`Error registering plugin ${pluginName}: ${error.message}`);
            }
        }
        
        console.log(`Initialized PluginManager with ${sortedPlugins.length} plugins`);
    };

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

module.exports = PluginManager; 