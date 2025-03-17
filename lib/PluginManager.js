const fs = require('fs');
const path = require('path');

function PluginManager(rootFolder) {
    const plugins = {};
    this.rootFolder = rootFolder || process.cwd();
    
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
        plugin.allow = pluginModule.getAllow();
        if (!plugin) {
            throw Error(`Module at path ${pluginPath} did not return a plugin instance`);
        }
        plugins[pluginName] = plugin;
    }

    /**
     * Build a dependency graph from plugin manifests
     * @param {Object} manifests - Object containing plugin manifests
     * @returns {Object} - Adjacency list representing the dependency graph
     */
    const buildDependencyGraph = (manifests) => {
        const graph = {};
        
        // Initialize the graph with all nodes
        Object.keys(manifests).forEach(plugin => {
            graph[plugin] = [];
        });
        
        // Add edges for each dependency
        Object.keys(manifests).forEach(plugin => {
            const dependencies = manifests[plugin].dependencies || [];
            dependencies.forEach(dep => {
                if (graph[dep]) {
                    graph[dep].push(plugin);
                } else {
                    console.warn(`Warning: Plugin ${plugin} depends on ${dep}, but ${dep} was not found.`);
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
     * based on their dependencies
     * @returns {Promise<void>}
     */
    this.init = async () => {
        const pluginsDir = path.join(this.rootFolder, 'plugins');
        
        // Check if plugins directory exists
        if (!fs.existsSync(pluginsDir)) {
            console.warn(`Plugins directory not found at ${pluginsDir}`);
            return;
        }
        
        // Get all directories in the plugins folder
        const pluginFolders = fs.readdirSync(pluginsDir)
            .filter(file => fs.statSync(path.join(pluginsDir, file)).isDirectory());
        
        // Read manifest files and build dependency information
        const manifests = {};
        pluginFolders.forEach(folder => {
            const manifestPath = path.join(pluginsDir, folder, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
                try {
                    const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    manifests[manifestData.name] = manifestData;
                } catch (error) {
                    console.error(`Error reading manifest for ${folder}: ${error.message}`);
                }
            } else {
                console.warn(`No manifest.json found for plugin ${folder}`);
            }
        });
        
        // Build dependency graph
        const graph = buildDependencyGraph(manifests);
        
        // Sort plugins topologically based on dependencies
        const sortedPlugins = topologicalSort(graph);
        
        // Register plugins in order
        for (const pluginName of sortedPlugins) {
            try {
                const manifestData = manifests[pluginName];
                const pluginDir = pluginFolders.find(folder => {
                    const manifestPath = path.join(pluginsDir, folder, 'manifest.json');
                    if (fs.existsSync(manifestPath)) {
                        const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                        return data.name === pluginName;
                    }
                    return false;
                });
                
                if (pluginDir) {
                    const pluginPath = path.join(pluginsDir, pluginDir, `${pluginName}.js`);
                    if (fs.existsSync(pluginPath)) {
                        await this.registerPlugin(pluginName, pluginPath);
                        console.log(`Registered plugin: ${pluginName}`);
                    } else {
                        console.error(`Plugin file not found for ${pluginName}`);
                    }
                } else {
                    console.error(`Plugin directory not found for ${pluginName}`);
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