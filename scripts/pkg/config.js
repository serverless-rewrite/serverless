'use strict';

module.exports = {
  // Open license ensures JS files are accessible as is
  // which is important for local templates installation
  license: 'MIT',
  files: [
    // Standalone commands
    '../../commands',
    // Custom resources
    '../../lib/plugins/aws/customResources/resources',
    // Basic CF templates
    '../../lib/plugins/aws/package/lib/*.json',
    // Service templates
    '../../lib/plugins/create/templates',
    // Local invocation artifacts
    '../../lib/plugins/aws/invokeLocal/runtimeWrappers',
    // Ensure npm is bundled as a dependency
    '../../node_modules/npm/bin/npm-cli.js',
    // Below module is not automatically traced by pkg, we need to point it manually
    // See: https://github.com/npm/npm-lifecycle/pull/41
    '../../node_modules/node-gyp/bin/node-gyp.js',
    '../../node_modules/npm/node_modules/node-gyp/bin/node-gyp.js',
    '../../node_modules/npm/node_modules/npm-lifecycle/node_modules/node-gyp/bin/node-gyp.js',
  ],
};
