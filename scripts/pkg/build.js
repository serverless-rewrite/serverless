#!/usr/bin/env node

// Node.js v8+ only

'use strict';

require('essentials');

const path = require('path');
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);
const fs = require('fs');

const serverlessPath = path.join(__dirname, '../..');

(async () => {
  // To bundle npm with a binary we need to install it
  process.stdout.write('Install npm\n');
  // Hard code npm version to one that comes with lastest Node.js
  // It's due to fact that npm tends to issue buggy releases
  // Node.js confirms on given version before including it within its bundle
  // Version mappings reference: https://nodejs.org/en/download/releases/
  await execFile('npm', ['install', '--no-save', 'npm@6.14.15'], {
    cwd: serverlessPath,
    stdio: 'inherit',
  });

  process.stdout.write('Build binaries\n');
  await execFile(
    'node',
    [
      './node_modules/.bin/pkg',
      '-c',
      'scripts/pkg/config.js',
      '--targets',
      'node14-linux-x64,node14-mac-x64,node14-win-x64',
      '--out-path',
      'dist',
      'bin/serverless.js',
    ],
    {
      cwd: serverlessPath,
      stdio: 'inherit',
    }
  ).catch();

  await fs.unlinkSync(path.join(serverlessPath, 'node_modules/npm'));
})();
