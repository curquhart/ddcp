import {App, Construct, RemovalPolicy, Stack, StackProps} from '@aws-cdk/core';
import {Repository} from '@aws-cdk/aws-codecommit';
import {Bucket} from '@aws-cdk/aws-s3';
import {BucketDeployment, Source} from '@aws-cdk/aws-s3-deployment';
import {CfnStack} from '@aws-cdk/aws-cloudformation';

const app = new App();

const assetsPrefix = 'managerassets/';

new class PublisherPipelineInitStack extends Stack {
    constructor(scope?: Construct, id?: string, props?: StackProps) {
        super(scope, id, props);

        const repo = new Repository(this, 'Repo', {
            repositoryName: 'ddcp',
        });

        const privateBucket = new Bucket(this, 'PrivateBucket', { removalPolicy: RemovalPolicy.DESTROY });
        const deployment = new BucketDeployment(this, 'DeployArtifacts', {
            sources: [
                Source.asset(`${__dirname}/../dist/dist.zip`),
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
    }
}(app, 'ddcp');
