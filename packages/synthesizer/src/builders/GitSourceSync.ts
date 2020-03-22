import {Function} from '@aws-cdk/aws-lambda';
import {Construct} from '@aws-cdk/core';
import {Source} from '../PipelineConfig';
import {PolicyStatement} from '@aws-cdk/aws-iam';
import {IRepository} from '@aws-cdk/aws-codecommit';
import {LambdaIntegration, PassthroughBehavior, RestApi} from '@aws-cdk/aws-apigateway';
import {Uniquifier} from '../Uniquifier';

export class GitSourceSync {
    setupSync(
        scope: Construct,
        mirrorFunction: Function,
        source: Source,
        localRepository: IRepository,
        uniquifier: Uniquifier
    ): string | undefined {
        mirrorFunction.addToRolePolicy(new PolicyStatement({
            actions: [ 'codecommit:GitPush' ],
            resources: [ localRepository.repositoryArn ],
        }));
        if (source.Auth?.PrivateKey !== undefined) {
            mirrorFunction.addEnvironment('PRIVATE_KEY', source.Auth?.PrivateKey);
        }

        if (source.Uri === undefined) {
            throw new Error('Uri is required for mirroring.');
        }
        mirrorFunction.addEnvironment('LOCAL_URI', localRepository.repositoryCloneUrlHttp);
        mirrorFunction.addEnvironment('REMOTE_URI', source.Uri);

        if (source.Trigger !== 'GitHubWebHook') {
            throw new Error('Only GitHubWebHook Trigger is currently supported.');
        }

        const restApi = new RestApi(scope, uniquifier.next('WebhookEndpoint'));
        restApi.root.addMethod('POST', new LambdaIntegration(mirrorFunction, {
            passthroughBehavior: PassthroughBehavior.WHEN_NO_MATCH,
            proxy: false,
            requestParameters: {
                'integration.request.header.X-Amz-Invocation-Type': '\'Event\'',
            },
            integrationResponses: [{
                statusCode: '202',
            }]
        }), {
            methodResponses: [{
                statusCode: '202'
            }]
        });

        return source.Auth?.PrivateKey;
    }
}
