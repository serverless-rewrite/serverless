'use strict';

const BbPromise = require('bluebird');
const archiver = require('archiver');
const os = require('os');
const path = require('path');
const { createWriteStream, existsSync } = require('fs');
const fs = require('fs/promises');
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);
const _ = require('lodash');
const ServerlessError = require('../../../serverless-error');
const { fdir: Fdir } = require('fdir');
const pMap = require('p-map');
const { log } = require('@serverless-rewrite/utils/log');

const includeNodeProdDepsMemoized = _.memoize(includeNodeProdDeps);

module.exports = {
  async includeProdDeps() {
    return this.serverless.service.package.includeProdDeps === false
      ? []
      : includeNodeProdDepsMemoized();
  },

  async zipFiles(files, zipFileName, prefix) {
    if (files.length === 0) {
      const error = new ServerlessError('No files to package', 'NO_FILES_TO_PACKAGE');
      return BbPromise.reject(error);
    }

    const archive = archiver.create('zip', {
      statConcurrency: os.cpus().length,
    });

    await ensureDir('.serverless');
    const zipFilePath = path.join('.serverless', zipFileName);
    const outputStream = createWriteStream(zipFilePath);

    return new Promise((resolve, reject) => {
      outputStream.on('close', () => resolve(zipFilePath));
      outputStream.on('error', reject);
      archive.on('error', reject);

      outputStream.on('open', () => {
        archive.pipe(outputStream);

        // First package all additional files
        Promise.all(
          files
            .map(path.normalize)
            .sort((a, b) => a.localeCompare(b))
            .map(this.zipFile.bind(this, archive, prefix))
        )
          // Finish up the process. This will result in a "close event" on the outputStream,
          // which will then resolve the Promise, so everything should be ok
          .then(() => archive.finalize())
          .catch(reject);
      });
    });
  },

  async zipFile(archive, prefix, filePath) {
    const stat = await fs.stat(filePath);
    const zipPath = prefix && filePath.startsWith(prefix) ? filePath.slice(prefix + 1) : filePath;
    try {
      archive.append(await fs.readFile(filePath), {
        name: zipPath,
        stats: stat,
        mode: stat.mode,
        // Make sure zip files with same content end up having same hash
        date: new Date(0),
      });
    } catch (e) {
      throw new ServerlessError(
        `Cannot read file ${filePath} due to: ${e.message}`,
        'CANNOT_READ_FILE'
      );
    }
  },
};

// eslint-disable-next-line consistent-return
async function ensureDir(dir) {
  if (!existsSync(dir)) {
    return fs.mkdir(dir);
  }
}

async function includeNodeProdDeps() {
  const packageJsonPaths = await new Fdir()
    .exclude((dirName) => {
      return dirName === 'node_modules';
    })
    .filter((filePath, isDirectory) => {
      const base = path.basename(filePath);
      if (isDirectory) {
        return true;
      }
      return base === 'package.json';
    })
    .withBasePath()
    .crawl('.')
    .withPromise();

  const cwd = process.cwd();
  const dependencyLists = await pMap(
    packageJsonPaths,
    async (packageJson) => {
      const moduleDir = path.dirname(packageJson);
      const output = await execFile(
        'npm',
        ['ls', '--prod=true', '--parseable=true', '--long=false', '--silent', '--all'],
        {
          cwd: moduleDir,
          env: {
            ...process.env,
            NODE_ENV: 'production',
          },
        }
      );
      return output.stdout
        .split(/\r?\n/)
        .filter((dep) => dep.length && dep.match(/\/node_modules\//))
        .map((dep) => `${path.relative(cwd, dep)}/**`);
    },
    {
      concurrency: os.cpus().length,
    }
  ).catch((error) => {
    log.error(`Unexpected error during dependency resolution: ${error.message}`);
  });
  return _.uniq(dependencyLists.flat());
}
