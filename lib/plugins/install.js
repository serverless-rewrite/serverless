'use strict';

const BbPromise = require('bluebird');

const cliCommandsSchema = require('../cli/commands-schema');
const download = require('../utils/downloadTemplateFromRepo');
const { legacy, log, progress, style } = require('@serverless-rewrite/utils/log');

class Install {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.commands = {
      install: {
        ...cliCommandsSchema.get('install'),
      },
    };

    this.hooks = {
      'install:install': async () => BbPromise.bind(this).then(this.install),
    };
  }

  async install() {
    const commandRunStartTime = Date.now();
    progress.get('main').notice(`Downloading service from provided url: ${this.options.url}`);
    const serviceName = await download.downloadTemplateFromRepo(
      this.options.url,
      this.options.name
    );
    const message = [
      `Successfully installed "${serviceName}" `,
      `${
        this.options.name && this.options.name !== serviceName ? `as "${this.options.name}"` : ''
      }`,
    ].join('');

    legacy.log(message);
    log.notice();
    log.notice.success(
      `${message} ${style.aside(`(${Math.floor((Date.now() - commandRunStartTime) / 1000)}s)`)}`
    );
  }
}

module.exports = Install;
