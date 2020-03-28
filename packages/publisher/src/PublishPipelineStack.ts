import {App, CfnOutput, Construct, RemovalPolicy, Stack, StackProps} from '@aws-cdk/core';
import {Repository} from '@aws-cdk/aws-codecommit';
import {BlockPublicAccess, Bucket, BucketAccessControl} from '@aws-cdk/aws-s3';
import {BucketDeployment, Source} from '@aws-cdk/aws-s3-deployment';
import {CfnStack} from '@aws-cdk/aws-cloudformation';
import {createHash} from 'crypto';
import * as fs from 'fs';
import {error} from '@ddcp/lib-logger';

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
                SourceS3Prefix: assetsPrefix,
                RepositoryName: repo.repositoryName,
                SynthPipelineName: 'synthesizer',
                StackName: 'ddcp-pipeline',
            }
        });
        managerStack.node.addDependency(deployment);

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
    error('NA', err);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
});
