'use strict';

const BbPromise = require('bluebird');
const _ = require('lodash');
const { legacy, log } = require('@serverless-rewrite/utils/log');

module.exports = {
  async disassociateUsagePlan() {
    const apiKeys = _.get(this.serverless.service.provider.apiGateway, 'apiKeys');

    if (apiKeys && apiKeys.length) {
      legacy.log('Removing usage plan association...');
      log.info('Removing usage plan association');
      const stackName = `${this.provider.naming.getStackName()}`;
      return BbPromise.all([
        this.provider.request('CloudFormation', 'describeStackResource', {
          StackName: stackName,
          LogicalResourceId: this.provider.naming.getRestApiLogicalId(),
        }),
        this.provider.request('APIGateway', 'getUsagePlans', {}),
      ])
        .then((data) =>
          data[1].items.filter((item) =>
            item.apiStages
              .map((apistage) => apistage.apiId)
              .includes(data[0].StackResourceDetail.PhysicalResourceId)
          )
        )
        .then((items) =>
          BbPromise.all(
            _.flattenDeep(
              items.map((item) =>
                item.apiStages.map((apiStage) =>
                  this.provider.request('APIGateway', 'updateUsagePlan', {
                    usagePlanId: item.id,
                    patchOperations: [
                      {
                        op: 'remove',
                        path: '/apiStages',
                        value: `${apiStage.apiId}:${apiStage.stage}`,
                      },
                    ],
                  })
                )
              )
            )
          )
        );
    }

    return BbPromise.resolve();
  },
};
