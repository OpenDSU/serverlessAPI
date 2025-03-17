const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Initialize $$ global object for testing
if (typeof globalThis.$$ === "undefined") {
    globalThis.$$ = {
        loadPlugin: function() {},
        registerPlugin: function() {},
        throwError: async function(error, ...args) {
            if (typeof error === "string") {
                error = new Error(error + " " + args.join(" "));
            }
            throw error;
        }
    };
}

const PluginManager = require('../lib/PluginManager');

// Test utilities
const testDir = path.join(__dirname, 'test-plugins');
const pluginsDir = path.join(testDir, 'plugins');

/**
 * Setup function to create a test directory with mock plugins
 */
function setupTestEnvironment() {
    // Clean up previous test directory if it exists
    if (fs.existsSync(testDir)) {
        removeDir(testDir);
    }

    // Create the main test directory and plugins subdirectory
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(pluginsDir, { recursive: true });

    // Create plugin A - no dependencies
    createPluginDir('pluginA', []);

    // Create plugin B - depends on A
    createPluginDir('pluginB', ['pluginA']);

    // Create plugin C - depends on B
    createPluginDir('pluginC', ['pluginB']);

    // Create plugin D - depends on A and C
    createPluginDir('pluginD', ['pluginA', 'pluginC']);

    console.log('Test environment set up successfully');
}

/**
 * Create a plugin directory with manifest and js file
 */
function createPluginDir(pluginName, dependencies) {
    const pluginDir = path.join(pluginsDir, pluginName);
    fs.mkdirSync(pluginDir, { recursive: true });

    // Create manifest.json
    const manifest = {
        name: pluginName,
        dependencies: dependencies
    };
    fs.writeFileSync(
        path.join(pluginDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
    );

    // Create plugin JS file with mock implementation
    const pluginCode = `
        let instance = null;

        function getInstance() {
            if (!instance) {
                instance = {
                    name: "${pluginName}",
                    testMethod: function() {
                        return "Hello from ${pluginName}";
                    }
                };
            }
            return instance;
        }

        function getAllow() {
            return function(forWhom, name) {
                return true; // For testing, allow all operations
            };
        }

        module.exports = {
            getInstance,
            getAllow
        };
    `;

    fs.writeFileSync(path.join(pluginDir, `${pluginName}.js`), pluginCode);
}

/**
 * Remove a directory recursively
 */
function removeDir(dir) {
    if (fs.existsSync(dir)) {
        fs.readdirSync(dir).forEach(file => {
            const curPath = path.join(dir, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                removeDir(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(dir);
    }
}

/**
 * Clean up the test environment
 */
function cleanupTestEnvironment() {
    if (fs.existsSync(testDir)) {
        removeDir(testDir);
    }
    console.log('Test environment cleaned up');
}

/**
 * Run the tests
 */
async function runTests() {
    console.log('Starting PluginManager tests...');
    
    try {
        // Reset the $$ global object for each test run to ensure isolation
        if (typeof globalThis.$$ === "undefined") {
            globalThis.$$ = {};
        } else {
            // Reset plugin-related properties while keeping other properties
            delete globalThis.$$.loadPlugin;
            delete globalThis.$$.registerPlugin;
        }
        
        // Setup
        setupTestEnvironment();
        
        // Test plugin initialization and discovery
        await testPluginInitialization();
        
        // Test dependency order
        await testDependencyOrder();
        
        // Test command execution
        await testCommandExecution();
        
        // Test circular dependency detection
        await testCircularDependency();
        
        console.log('All tests passed!');
    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        cleanupTestEnvironment();
    }
}

/**
 * Test plugin initialization and discovery
 */
async function testPluginInitialization() {
    console.log('Testing plugin initialization...');
    const manager = new PluginManager(testDir);
    await manager.init();
    
    // Verify all plugins were registered
    const pluginA = globalThis.$$.loadPlugin('pluginA');
    const pluginB = globalThis.$$.loadPlugin('pluginB');
    const pluginC = globalThis.$$.loadPlugin('pluginC');
    const pluginD = globalThis.$$.loadPlugin('pluginD');
    
    assert(pluginA, 'Plugin A should be registered');
    assert(pluginB, 'Plugin B should be registered');
    assert(pluginC, 'Plugin C should be registered');
    assert(pluginD, 'Plugin D should be registered');
    
    console.log('✓ Plugin initialization test passed');
}

/**
 * Test that plugins are loaded in the correct dependency order
 */
async function testDependencyOrder() {
    console.log('Testing dependency order...');
    
    // Create a manager with a test recorder
    const registrationOrder = [];
    
    // Create a custom test manager with recording capability
    function TestManager(rootFolder) {
        const manager = new PluginManager(rootFolder);
        const originalRegisterPlugin = manager.registerPlugin;
        
        manager.registerPlugin = async (pluginName, pluginPath) => {
            registrationOrder.push(pluginName);
            return await originalRegisterPlugin.call(manager, pluginName, pluginPath);
        };
        
        return manager;
    }
    
    const manager = new TestManager(testDir);
    await manager.init();
    
    // Verify order: A should come before B, B before C, and A and C before D
    const indexA = registrationOrder.indexOf('pluginA');
    const indexB = registrationOrder.indexOf('pluginB');
    const indexC = registrationOrder.indexOf('pluginC');
    const indexD = registrationOrder.indexOf('pluginD');
    
    assert(indexA >= 0, 'Plugin A should be in the registration order');
    assert(indexB >= 0, 'Plugin B should be in the registration order');
    assert(indexC >= 0, 'Plugin C should be in the registration order');
    assert(indexD >= 0, 'Plugin D should be in the registration order');
    
    assert(indexA < indexB, 'Plugin A should be registered before Plugin B');
    assert(indexB < indexC, 'Plugin B should be registered before Plugin C');
    assert(indexA < indexD, 'Plugin A should be registered before Plugin D');
    assert(indexC < indexD, 'Plugin C should be registered before Plugin D');
    
    console.log('✓ Dependency order test passed');
}

/**
 * Test command execution through the plugin manager
 */
async function testCommandExecution() {
    console.log('Testing command execution...');
    
    const manager = new PluginManager(testDir);
    await manager.init();
    
    // Execute a command through Plugin A
    const command = {
        forWhom: 'tester',
        name: 'testMethod',
        pluginName: 'pluginA',
        args: []
    };
    
    const result = await manager.executeCommand(command);
    assert.strictEqual(result, 'Hello from pluginA', 'Command execution should return the correct result');
    
    console.log('✓ Command execution test passed');
}

/**
 * Test circular dependency detection
 */
async function testCircularDependency() {
    console.log('Testing circular dependency detection...');
    
    // Create a circular dependency situation
    const circularDir = path.join(testDir, 'circular-plugins');
    fs.mkdirSync(circularDir, { recursive: true });
    
    // Create plugins directory inside circular-plugins
    const circularPluginsDir = path.join(circularDir, 'plugins');
    fs.mkdirSync(circularPluginsDir, { recursive: true });
    
    // Create plugins with circular dependencies: X depends on Y, Y depends on Z, Z depends on X
    const pluginXDir = path.join(circularPluginsDir, 'pluginX');
    const pluginYDir = path.join(circularPluginsDir, 'pluginY');
    const pluginZDir = path.join(circularPluginsDir, 'pluginZ');
    
    fs.mkdirSync(pluginXDir, { recursive: true });
    fs.mkdirSync(pluginYDir, { recursive: true });
    fs.mkdirSync(pluginZDir, { recursive: true });
    
    // Create manifest files with circular dependencies
    fs.writeFileSync(
        path.join(pluginXDir, 'manifest.json'),
        JSON.stringify({ name: 'pluginX', dependencies: ['pluginY'] }, null, 2)
    );
    
    fs.writeFileSync(
        path.join(pluginYDir, 'manifest.json'),
        JSON.stringify({ name: 'pluginY', dependencies: ['pluginZ'] }, null, 2)
    );
    
    fs.writeFileSync(
        path.join(pluginZDir, 'manifest.json'),
        JSON.stringify({ name: 'pluginZ', dependencies: ['pluginX'] }, null, 2)
    );
    
    // Create plugin JS files (minimal implementation)
    const pluginCode = `
        module.exports = {
            getInstance: () => ({}),
            getAllow: () => (() => true)
        };
    `;
    
    fs.writeFileSync(path.join(pluginXDir, 'pluginX.js'), pluginCode);
    fs.writeFileSync(path.join(pluginYDir, 'pluginY.js'), pluginCode);
    fs.writeFileSync(path.join(pluginZDir, 'pluginZ.js'), pluginCode);
    
    // Initialize manager with circular dependencies dir, should throw an error
    const manager = new PluginManager(circularDir);
    try {
        await manager.init();
        // If we get here, the test failed because no error was thrown
        assert.fail('Should have thrown an error due to circular dependencies');
    } catch (error) {
        // Expected error, test passes
        assert(error.message.includes('Circular dependency'), 
            `Error should mention circular dependency, got: ${error.message}`);
        console.log('✓ Circular dependency test passed');
    }
}

// Run the tests
runTests().catch(console.error);

module.exports = {
    runTests
}; 