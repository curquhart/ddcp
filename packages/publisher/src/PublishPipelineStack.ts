import {App, Aws, CfnOutput, Construct, Duration, RemovalPolicy, Stack, StackProps} from '@aws-cdk/core';
import {Repository} from '@aws-cdk/aws-codecommit';
import {BlockPublicAccess, Bucket, BucketAccessControl} from '@aws-cdk/aws-s3';
import {BucketDeployment, Source} from '@aws-cdk/aws-s3-deployment';
import {LambdaIntegration, PassthroughBehavior, RestApi} from '@aws-cdk/aws-apigateway';
import {CfnStack} from '@aws-cdk/aws-cloudformation';
import {createHash} from 'crypto';
import * as fs from 'fs';
import {Code, Function, LayerVersion, Runtime} from '@aws-cdk/aws-lambda';
import {PolicyStatement} from '@aws-cdk/aws-iam';

const app = new App();

const distZipLocation = `${__dirname}/../dist/dist.zip`;

class PublisherPipelineInitStack extends Stack {
    constructor(distHash: string, scope?: Construct, id?: string, props?: StackProps) {
        super(scope, id, props);

        const repo = new Repository(this, 'Repo', {
            repositoryName: 'ddcp',
        });

        const privateBucket = new Bucket(this, 'PrivateBucket', {
            removalPolicy: RemovalPolicy.DESTROY,
            accessControl: BucketAccessControl.PRIVATE,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        });
        const publicBucket = new Bucket(this, 'PublicBucket', {
            removalPolicy: RemovalPolicy.DESTROY,
            accessControl: BucketAccessControl.PUBLIC_READ,
        });

        const assetsPrefix = `managerassets/${distHash}/`;

        const deployment = new BucketDeployment(this, 'DeployArtifacts', {
            sources: [
                Source.asset(distZipLocation),
            ],
            destinationBucket: privateBucket,
            destinationKeyPrefix: assetsPrefix
        });

        const managerStack = new CfnStack(this, 'PipelineManager', {
            templateUrl: privateBucket.urlForObject(`${assetsPrefix}manager.yaml`),
            parameters: {
                SourceS3BucketName: privateBucket.bucketName,
                LocalStorageS3BucketName: privateBucket.bucketName,
                SourceS3Key: `${assetsPrefix}@ddcpsynthesizer.zip`,
                RepositoryName: repo.repositoryName,
                SynthPipelineName: 'synthesizer',
                StackName: 'ddcp-pipeline',
            }
        });
        managerStack.node.addDependency(deployment);

        const githubMirror = new Function(this, 'GitHubMirror', {
            code: Code.fromBucket(privateBucket, `${assetsPrefix}@ddcpgithub-mirror.zip`),
            runtime: Runtime.NODEJS_12_X,
            handler: 'dist/index.handle',
            initialPolicy: [
                new PolicyStatement({
                    actions: [ 'codecommit:GitPush' ],
                    resources: [ repo.repositoryArn ],
                })
            ],
            memorySize: 512,
            timeout: Duration.seconds(60),
            layers: [
                // https://github.com/lambci/git-lambda-layer
                LayerVersion.fromLayerVersionArn(this, 'GitLayer', `arn:aws:lambda:${Aws.REGION}:553035198032:layer:git-lambda2:4`),
            ]
        });
        githubMirror.node.addDependency(deployment);

        const restApi = new RestApi(this, 'WebhookEndpoint');
        restApi.root.addMethod('POST', new LambdaIntegration(githubMirror, {
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

        new CfnOutput(this, 'PrivateBucketArn', {
            exportName: 'PrivateBucketArn',
            value: privateBucket.bucketArn
        });

        new CfnOutput(this, 'PublicBucketArn', {
            exportName: 'PublicBucketArn',
            value: publicBucket.bucketArn
        });
    }
}

const distReadStream = fs.createReadStream(distZipLocation);
const shasum = createHash('sha1');
distReadStream.on('data', (data) => shasum.update(data));
distReadStream.on('end', () => new PublisherPipelineInitStack(shasum.digest('hex'), app, 'ddcp'));
distReadStream.on('error', (err: Error) => {
    console.error(err);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
});
