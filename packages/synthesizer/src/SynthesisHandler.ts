import {App} from '@aws-cdk/core';
import {SynthesisStack} from './SynthesisStack';
import {S3, CodePipeline} from 'aws-sdk';
import * as AdmZip from 'adm-zip';
import {CodePipelineEvent, Context} from 'aws-lambda';
import * as tmp from 'tmp';
import {EMPTY_VOID_FN} from './helpers';
import {Resolver} from './Resolver';
import * as yaml from 'js-yaml';
import {BaseOrchestratorFactory} from './orchestrator/BaseOrchestratorFactory';
import {Uniquifier} from './Uniquifier';
const STACK_ID = 'generated';

export interface ManagerResources {
    arn: string;
    buildStateSnsTopicArn: string;
    sourceBranch: string;
    sourceType: string;
    sourceRepoName: string;
    eventBusArn: string;
    assetBucketName: string;
    assetKeys: Record<string, string>;
}

const getArtifactS3Client = (event: CodePipelineEvent): S3 => {
    const accessKeyId = event['CodePipeline.job'].data.artifactCredentials.accessKeyId;
    const secretAccessKey = event['CodePipeline.job'].data.artifactCredentials.secretAccessKey;
    const sessionToken = event['CodePipeline.job'].data.artifactCredentials.sessionToken;

    return new S3({
        accessKeyId,
        secretAccessKey,
        sessionToken
    });
};

export class SynthesisHandler {
    async handle(
        synthPipeline: ManagerResources,
        cdkOutDir: string,
        event: CodePipelineEvent,
        resolver: Resolver,
        orchestrators: Record<string, BaseOrchestratorFactory>,
        uniquifier: Uniquifier
    ): Promise<void> {
        const app = new App({
            outdir: cdkOutDir,
        });

        const s3 = getArtifactS3Client(event);

        const inputArtifact = await s3.getObject({
            Bucket: event['CodePipeline.job'].data.inputArtifacts[0].location.s3Location.bucketName,
            Key: event['CodePipeline.job'].data.inputArtifacts[0].location.s3Location.objectKey
        }).promise();

        const inZip = new AdmZip(inputArtifact.Body as Buffer);
        const pipelineConfigYaml = inZip.readAsText('pipeline-config.yaml');

        new SynthesisStack(app, STACK_ID, synthPipeline, resolver, yaml.safeLoad(pipelineConfigYaml), orchestrators, uniquifier);
        const template = app.synth().getStackArtifact(STACK_ID).template;

        const outZip = new AdmZip();
        outZip.addFile('template.json', Buffer.from(JSON.stringify(template)));

        await s3.putObject({
            Bucket: event['CodePipeline.job'].data.outputArtifacts[0].location.s3Location.bucketName,
            Key: event['CodePipeline.job'].data.outputArtifacts[0].location.s3Location.objectKey,
            Body: outZip.toBuffer()
        }).promise();
    }

    async safeHandle(
        event: CodePipelineEvent,
        context: Context,
        resolver: Resolver,
        orchestrators: Record<string, BaseOrchestratorFactory>,
        uniquifier: Uniquifier
    ): Promise<void> {
        let cleanupCb = EMPTY_VOID_FN;
        const cp = new CodePipeline();

        try {
            const userData = JSON.parse(event['CodePipeline.job'].data.actionConfiguration.configuration.UserParameters);

            const scratchDir = userData.scratchDir;
            const scratchDirCleanup = userData.scratchDirCleanup;
            const synthPipeline = userData.synthPipeline;

            if (typeof scratchDir !== 'string') {
                throw new Error('scratchDir userParam is required.');
            }
            if (typeof scratchDirCleanup !== 'boolean') {
                throw new Error('scratchDirCleanup userParam is required.');
            }
            if (typeof synthPipeline !== 'object') {
                throw new Error('synthPipeline userParam is required.');
            }

            const cdkOutDir = tmp.dirSync({
                dir: scratchDir,
                unsafeCleanup: scratchDirCleanup
            });
            if (scratchDirCleanup) {
                cleanupCb = cdkOutDir.removeCallback;
            }

            await this.handle(synthPipeline, cdkOutDir.name, event, resolver, orchestrators, uniquifier);
            await cp.putJobSuccessResult({jobId: event['CodePipeline.job'].id}).promise();
        }
        catch (err) {
            console.error(err);
            await cp.putJobFailureResult({jobId: event['CodePipeline.job'].id, failureDetails: {
                type: 'JobFailed',
                message: `Failed to synthesize pipeline. Ref# ${context.awsRequestId}`
            }}).promise();
        }
        finally {
            cleanupCb();
        }
    }
}