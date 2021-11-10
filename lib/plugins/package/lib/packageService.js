'use strict';

const path = require('path');
const fsp = require('fs').promises;
const { fdir: Fdir } = require('fdir');
const _ = require('lodash');
const picomatch = require('picomatch');
const ServerlessError = require('../../../serverless-error');
const parseS3URI = require('../../aws/utils/parse-s3-uri');
const { legacy, log } = require('@serverless-rewrite/utils/log');

const patternIsInclude = (pattern) => {
  return !pattern.startsWith('!');
};

function filterIncludePatterns(list) {
  list = list || [];
  return list.filter(patternIsInclude);
}

function filterExcludePatterns(list) {
  list = list || [];
  return list.filter(_.negate(patternIsInclude)).map((s) => s.slice(1));
}

const defaultExcludes = [
  '!**/.git',
  '!**/.gitignore',
  '!**/.DS_Store',
  '!**/npm-debug.log',
  '!**/yarn-*.log',
  '!**/.serverless',
  '!**/.serverless_plugins',
];

module.exports = {
  getIncludes(patterns) {
    return _.union(
      ...[this.serverless.service.package.patterns, patterns].map(filterIncludePatterns)
    );
  },

  getExcludes(patterns, excludeLayers) {
    const lists = [defaultExcludes, this.serverless.service.package.patterns, patterns];
    if (excludeLayers) {
      const layerNames = this.serverless.service.getAllLayers();
      lists.push(
        ...layerNames
          .map(this.serverless.service.getLayer.bind(this.serverless.service))
          .map((layer) => [
            `!${layer.path}/**`,
            ...(layer.package
              ? filterIncludePatterns(layer.package.patterns).map((s) => `!${s}`)
              : []),
          ])
      );
    }

    return _.union(...lists.map(filterExcludePatterns));
  },

  async packageService() {
    legacy.log('Packaging service...');
    let shouldPackageService = false;
    const allFunctions = this.serverless.service.getAllFunctions();
    let packagePromises = allFunctions.map(async (functionName) => {
      const functionObject = this.serverless.service.getFunction(functionName);
      if (functionObject.image) return;
      functionObject.package = functionObject.package || {};
      if (functionObject.package.disable) {
        legacy.log(`Packaging disabled for function: "${functionName}"`);
        log.info(`Packaging disabled for function: "${functionName}"`);
        return;
      }
      if (functionObject.package.artifact) {
        if (parseS3URI(functionObject.package.artifact)) return;
        try {
          await fsp.access(
            path.resolve(this.serverless.serviceDir, functionObject.package.artifact)
          );
          return;
        } catch (error) {
          throw new ServerlessError(
            'Cannot access package artifact at ' +
              `"${functionObject.package.artifact}" (for "${functionName}"): ${error.message}`,
            'INVALID_PACKAGE_ARTIFACT_PATH'
          );
        }
      }
      if (functionObject.package.individually || this.serverless.service.package.individually) {
        await this.packageFunction(functionName);
        return;
      }
      shouldPackageService = true;
    });
    const allLayers = this.serverless.service.getAllLayers();
    packagePromises = packagePromises.concat(
      allLayers.map(async (layerName) => {
        const layerObject = this.serverless.service.getLayer(layerName);
        layerObject.package = layerObject.package || {};
        if (layerObject.package.artifact) return;
        await this.packageLayer(layerName);
      })
    );

    await Promise.all(packagePromises);
    if (shouldPackageService) {
      if (this.serverless.service.package.artifact) {
        if (parseS3URI(this.serverless.service.package.artifact)) {
          return;
        }
        try {
          await fsp.access(
            path.resolve(this.serverless.serviceDir, this.serverless.service.package.artifact)
          );
          return;
        } catch (error) {
          throw new ServerlessError(
            'Cannot access package artifact at ' +
              `"${this.serverless.service.package.artifact}": ${error.message}`,
            'INVALID_PACKAGE_ARTIFACT_PATH'
          );
        }
      }
      await this.packageAll();
    }
  },

  async packageAll() {
    const zipFileName = `${this.serverless.service.service}.zip`;

    return this.resolveFilePathsAll().then((filePaths) =>
      this.zipFiles(filePaths, zipFileName).then((filePath) => {
        // only set the default artifact for backward-compatibility
        // when no explicit artifact is defined
        if (!this.serverless.service.package.artifact) {
          this.serverless.service.package.artifact = filePath;
          this.serverless.service.artifact = filePath;
        }
        return filePath;
      })
    );
  },

  async packageFunction(functionName) {
    const functionObject = this.serverless.service.getFunction(functionName);
    if (functionObject.image) return null;

    const funcPackageConfig = functionObject.package || {};

    // use the artifact in function config if provided
    if (funcPackageConfig.artifact) {
      const filePath = path.resolve(this.serverless.serviceDir, funcPackageConfig.artifact);
      functionObject.package.artifact = filePath;
      return filePath;
    }

    // use the artifact in service config if provided
    // and if the function is not set to be packaged individually
    if (this.serverless.service.package.artifact && !funcPackageConfig.individually) {
      const filePath = path.resolve(
        this.serverless.serviceDir,
        this.serverless.service.package.artifact
      );
      funcPackageConfig.artifact = filePath;

      return filePath;
    }

    const zipFileName = `${functionName}.zip`;

    const filePaths = await this.resolveFilePathsFunction(functionName);
    const artifactPath = await this.zipFiles(filePaths, zipFileName);
    funcPackageConfig.artifact = artifactPath;
    return artifactPath;
  },

  async packageLayer(layerName) {
    const layerObject = this.serverless.service.getLayer(layerName);

    const zipFileName = `${layerName}.zip`;

    return (
      this.resolveFilePathsLayer(layerName)
        // .then((filePaths) => filePaths.map((f) => path.join(layerObject.path, f)))
        .then((filePaths) =>
          this.zipFiles(filePaths, zipFileName, layerObject.path).then((artifactPath) => {
            layerObject.package = {
              artifact: artifactPath,
            };
            return artifactPath;
          })
        )
    );
  },

  async resolveFilePathsAll() {
    return this.resolveFilePathsFromPatterns({
      exclude: this.getExcludes([], true),
      include: this.getIncludes([]),
    });
  },

  async resolveFilePathsFunction(functionName) {
    const functionObject = this.serverless.service.getFunction(functionName);
    const funcPackageConfig = functionObject.package || {};

    return this.resolveFilePathsFromPatterns({
      exclude: this.getExcludes(funcPackageConfig.patterns, true),
      include: this.getIncludes(funcPackageConfig.patterns),
    });
  },

  async resolveFilePathsLayer(layerName) {
    const layerObject = this.serverless.service.getLayer(layerName);
    const layerPackageConfig = layerObject.package || {};
    layerPackageConfig.patterns = layerPackageConfig.patterns || [];

    return await this.resolveFilePathsFromPatterns({
      exclude: this.getExcludes(layerPackageConfig.patterns, false),
      include: this.getIncludes([`${layerObject.path}/**`, ...layerPackageConfig.patterns]),
    });
  },

  async resolveFilePathsFromPatterns(params) {
    params.include = _.union(params.include, await this.includeProdDeps());

    const matchExclude = picomatch(params.exclude);
    const matchInclude = picomatch(params.include);
    const paths = new Fdir()
      .withBasePath()
      .exclude((base, fullPath) => matchExclude(removeDotDir(fullPath)))
      .filter((filePath, isDirectory) => isDirectory || matchInclude(removeDotDir(filePath)))
      .crawl('.')
      .sync();
    return paths.filter(_.negate(matchExclude)).map(removeDotDir);
  },
};

function removeDotDir(filePath) {
  return filePath.slice(2);
}
