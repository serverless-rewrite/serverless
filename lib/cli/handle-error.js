'use strict';

const path = require('path');
const isObject = require('type/object/is');
const chalk = require('chalk');
const stripAnsi = require('strip-ansi');
const { style, writeText, legacy, log } = require('@serverless-rewrite/utils/log');
const slsVersion = require('./../../package').version;
const { logWarning } = require('../classes/Error');
const isStandaloneExecutable = require('../utils/isStandaloneExecutable');
const tokenizeException = require('../utils/tokenize-exception');
const logDeprecation = require('../utils/logDeprecation');
const resolveIsLocallyInstalled = require('../utils/is-locally-installed');
const resolveLocalServerlessPath = require('./resolve-local-serverless-path');

const writeMessage = (title, message) => {
  let line = '';
  while (line.length < 56 - title.length) {
    line = `${line}-`;
  }

  legacy.consoleLog(' ');
  legacy.consoleLog(chalk.yellow(` ${title} ${line}`));
  legacy.consoleLog(' ');

  if (message) {
    legacy.consoleLog(`  ${message.split('\n').join('\n  ')}`);
  }

  legacy.consoleLog(' ');
};

module.exports = async (exception, options = {}) => {
  if (!isObject(options)) options = {};
  // Due to the fact that the handler can be invoked via fallback, we need to support both `serverless`
  // and `isLocallyInstalled` + `isInvokedByGlobalInstallation` properties
  // TODO: Support for these properties should be removed with next major
  const {
    isUncaughtException,
    isLocallyInstalled: passedIsLocallyInstalled,
    isInvokedByGlobalInstallation: passedIsInvokedByGlobalInstallation,
    serverless,
    commandUsage,
    variableSourcesInConfig,
  } = options;
  const { command, options: cliOptions, commandSchema, serviceDir, configuration } = options;

  const isLocallyInstalled = serverless ? serverless.isLocallyInstalled : passedIsLocallyInstalled;
  const isInvokedByGlobalInstallation = serverless
    ? serverless.isInvokedByGlobalInstallation
    : passedIsInvokedByGlobalInstallation;

  // If provided serverless instance is a local fallback, and we're not in context of it
  // Pass error handling to this local fallback implementation
  if (isInvokedByGlobalInstallation && !resolveIsLocallyInstalled()) {
    const localServerlessPath = resolveLocalServerlessPath();

    const localErrorHandlerData = (() => {
      try {
        return {
          handle: require(path.resolve(localServerlessPath, 'lib/cli/handle-error')),
          options: {
            serverless,
            isLocallyInstalled,
            isUncaughtException,
            command,
            options: cliOptions,
            commandSchema,
            serviceDir,
            configuration,
            commandUsage,
            variableSourcesInConfig,
          },
        };
      } catch {
        try {
          // Ugly mock of serverless below is used to ensure that Framework version will be logged with `(local)` suffix
          return {
            handle: require(path.resolve(localServerlessPath, 'lib/classes/Error')).logError,
            options: {
              serverless: serverless || { isLocallyInstalled },
              forceExit: isUncaughtException,
            },
          };
        } catch {
          // Corner case of local installation being removed during command processing.
          // It can happen e.g. during "plugin uninstall" command, where "serverless" originally
          // installed a as peer dependency was removed
          logWarning('Could not resolve path to locally installed error handler');
          log.debug('Could not resolve path to locally installed error handler');
          return null;
        }
      }
    })();

    if (localErrorHandlerData) {
      localErrorHandlerData.handle(exception, localErrorHandlerData.options);
      return;
    }
  }

  const exceptionTokens = tokenizeException(exception);
  const isUserError = !isUncaughtException && exceptionTokens.isUserError;

  writeMessage(
    exceptionTokens.title,
    exceptionTokens.stack && (!isUserError || process.env.SLS_DEBUG)
      ? exceptionTokens.stack
      : exceptionTokens.message
  );

  if (!isUserError && !process.env.SLS_DEBUG) {
    const debugInfo = [
      '    ',
      ' For debugging logs, run again after setting the',
      ' "SLS_DEBUG=*" environment variable.',
    ].join('');
    legacy.consoleLog(chalk.red(debugInfo));
    legacy.consoleLog(' ');
  }

  const platform = process.platform;
  const nodeVersion = process.version.replace(/^[v|V]/, '');
  const installationModePostfix = (() => {
    if (isStandaloneExecutable) return ' (standalone)';
    if (isLocallyInstalled != null) return isLocallyInstalled ? ' (local)' : '';
    return resolveIsLocallyInstalled() ? ' (local)' : '';
  })();
  const componentsVersion = (() => {
    try {
      return require('@serverless/components/package').version;
    } catch (error) {
      return 'Unavailable';
    }
  })();

  const detailsTextTokens = [
    `Environment: ${platform}, node ${nodeVersion}, framework ${slsVersion}${installationModePostfix}`,
  ];

  if (serverless && serverless.service.provider.name === 'aws') {
    const credentials = serverless.getProvider('aws').cachedCredentials;
    if (credentials && credentials.credentials) {
      if (credentials.credentials.profile) {
        detailsTextTokens.push(`Credentials: Local, "${credentials.credentials.profile}" profile`);
      } else {
        // The only alternative here are credentials from environment variables
        detailsTextTokens.push('Credentials: Local, environment variables');
      }
    }
  }

  detailsTextTokens.push(
    'Docs:        docs.serverless.com',
    'Support:     forum.serverless.com',
    'Bugs:        github.com/serverless/serverless/issues'
  );

  writeText(style.aside(...detailsTextTokens));

  // TODO: Ideally after migrating to new logger complete this strip should not be needed
  //       (it can be removed after we clear all chalk error message decorations from internals)
  const errorMsg =
    exceptionTokens.decoratedMessage ||
    stripAnsi(
      exceptionTokens.stack && !isUserError ? exceptionTokens.stack : exceptionTokens.message
    );
  writeText(null, style.error('Error:'), errorMsg);

  legacy.consoleLog(chalk.yellow('  Get Support --------------------------------------------'));
  legacy.consoleLog(`${chalk.yellow('     Docs:          ')}docs.serverless.com`);
  legacy.consoleLog(
    `${chalk.yellow('     Bugs:          ')}github.com/serverless/serverless/issues`
  );
  legacy.consoleLog(`${chalk.yellow('     Issues:        ')}forum.serverless.com`);

  legacy.consoleLog(' ');
  legacy.consoleLog(chalk.yellow('  Your Environment Information ---------------------------'));
  legacy.consoleLog(chalk.yellow(`     Operating System:          ${platform}`));
  legacy.consoleLog(chalk.yellow(`     Node Version:              ${nodeVersion}`));

  legacy.consoleLog(
    chalk.yellow(`     Framework Version:         ${slsVersion}${installationModePostfix}`)
  );

  legacy.consoleLog(chalk.yellow(`     Components Version:        ${componentsVersion}`));
  legacy.consoleLog(' ');

  await logDeprecation.printSummary();

  process.exitCode = 1;
  if (isUncaughtException) process.exit();
};
