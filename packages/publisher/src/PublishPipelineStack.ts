import {App, CfnOutput, Construct, RemovalPolicy, Stack, StackProps} from '@aws-cdk/core';
import {Repository} from '@aws-cdk/aws-codecommit';
import {BlockPublicAccess, Bucket, BucketAccessControl} from '@aws-cdk/aws-s3';
import {BucketDeployment, Source} from '@aws-cdk/aws-s3-deployment';
import {CfnStack} from '@aws-cdk/aws-cloudformation';
import {throwError} from '@ddcp/errorhandling';

const app = new App();

const distLambdasLocation = `${__dirname}/../dist/dist-lambdas.zip`;
const distManagerLocation = `${__dirname}/../dist/dist-manager.zip`;

const lambdasDistBucketName = process.env.LAMBDA_DIST_BUCKET_NAME ?? throwError(new Error('LAMBDA_DIST_BUCKET_NAME is required.'));
const cfnDistBucketName = process.env.CFN_DIST_BUCKET_NAME ?? throwError(new Error('CFN_DIST_BUCKET_NAME is required.'));

/**
 * This is used for local account bootstrapping. It is NOT used for automated deploys.
 */
class PublisherPipelineInitStack extends Stack {
    constructor(scope?: Construct, id?: string, props?: StackProps) {
        super(scope, id, props);

        const repo = new Repository(this, 'Repo', {
            repositoryName: 'ddcp',
        });

        const localStorageBucket = new Bucket(this, 'PrivateBucket', {
            removalPolicy: RemovalPolicy.DESTROY,
            accessControl: BucketAccessControl.PRIVATE,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        });

        const assetsPrefix = `${process.env.BUILD_VERSION}/`;

        const lambdaBucket = Bucket.fromBucketName(this, 'LambdasBucket', lambdasDistBucketName);
        const cfnBucket = Bucket.fromBucketName(this, 'CfnBucket', cfnDistBucketName);

        const lambdaDeployment = new BucketDeployment(this, 'DeployLambdaArtifacts', {
            sources: [
                Source.asset(distLambdasLocation),
            ],
            destinationBucket: lambdaBucket,
            destinationKeyPrefix: assetsPrefix
        });
        const cfnDeployment = new BucketDeployment(this, 'DeployManagerArtifact', {
            sources: [
                Source.asset(distManagerLocation),
            ],
            destinationBucket: cfnBucket,
            destinationKeyPrefix: assetsPrefix
        });

        const managerStack = new CfnStack(this, 'PipelineManager', {
            templateUrl: cfnBucket.urlForObject(`${assetsPrefix}manager.yaml`),
            parameters: {
                LocalStorageS3BucketName: localStorageBucket.bucketName,
                RepositoryName: repo.repositoryName,
                SynthPipelineName: 'synthesizer',
                StackName: 'ddcp-pipeline',
            }
        });
        managerStack.node.addDependency(lambdaDeployment, cfnDeployment);
    }
}

new PublisherPipelineInitStack(app, 'ddcp');