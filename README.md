# Serverless API with Plugin Management

This module provides a serverless API with plugin management capabilities for ApiHub. It allows you to:

- Organize plugins in a directory structure
- Define dependencies between plugins directly in the plugin code
- Load plugins in the correct order based on dependencies
- Execute commands on plugins

## Structure

- `PluginManager`: Core component that discovers, loads, and manages plugins
- `ServerlessAPI`: High-level API for serverless functionality
- `ApiHubIntegration`: Integration with ApiHub server

## Plugin Structure

Plugins should be organized in a flat directory structure like this:

```
rootFolder/
  plugins/
    pluginA.js
    pluginB.js
    pluginC.js
```

Each plugin JavaScript file should export the following functions:

- `getName()`: Returns the unique name of the plugin
- `getDependencies()`: Returns an array of other plugin names that this plugin depends on
- `getInstance()`: Returns an instance of the plugin with its functionality
- `getAllow()`: Returns a function that determines if a user can execute a method

### Plugin Implementation

```javascript
/**
 * Returns the unique name of this plugin
 */
function getName() {
    return "myPlugin";
}

/**
 * Returns an array of dependencies for this plugin
 */
function getDependencies() {
    return ["dependencyPlugin1", "dependencyPlugin2"];
}

/**
 * Returns a plugin instance with methods and properties
 */
function getInstance() {
    return {
        methodName: function() {
            // Method implementation
            return "some result";
        }
    };
}

/**
 * Returns a function that controls access permissions
 */
function getAllow() {
    return function(forWhom, name, ...args) {
        // Return true if the user is allowed to execute the method
        return true;
    };
}

module.exports = {
    getName,
    getDependencies,
    getInstance,
    getAllow
};
```

## Usage

### Creating a PluginManager

```javascript
const PluginManager = require('./lib/PluginManager');
const manager = new PluginManager('/path/to/root/folder');
await manager.init();
```

### Using ServerlessAPI

```javascript
const ServerlessAPI = require('./lib/ServerlessAPI');
const api = new ServerlessAPI({
  urlPrefix: 'myapi',
  rootFolder: '/path/to/root/folder'
});
await api.initPlugins();
```

### Integration with ApiHub

```javascript
const { createServerlessAPI } = require('./lib/ApiHubIntegration');
const serverlessAPI = await createServerlessAPI(server, {
  urlPrefix: 'myapi',
  rootFolder: '/path/to/root/folder'
});
await serverlessAPI.initPlugins();
```

## Plugin Dependency Resolution

The PluginManager uses topological sorting to determine the correct order to load plugins based on their dependencies. This ensures that plugins are loaded only after all of their dependencies have been loaded.

If circular dependencies are detected, the initialization will fail with an error.