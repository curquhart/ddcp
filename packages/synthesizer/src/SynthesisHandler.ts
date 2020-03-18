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
import {Tokenizer} from '@ddcp/tokenizer';
import {BaseResourceFactory} from './resource/BaseResourceFactory';
import {throwError} from '@ddcp/errorhandling';
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

export interface SynthesisHandlerProps {
    event: CodePipelineEvent;
    resolver: Resolver;
    orchestratorFactories: Record<string, BaseOrchestratorFactory>;
    resourceFactories: Record<string, BaseResourceFactory>;
    uniquifier: Uniquifier;
    tokenizer: Tokenizer;
    context: Context;
}

interface SynthesisHandlerManagerProps {
    synthPipeline: ManagerResources;
    cdkOutDir: string;
}

export class SynthesisHandler {
    async handle(props: SynthesisHandlerProps & SynthesisHandlerManagerProps): Promise<void> {
        const app = new App({
            outdir: props.cdkOutDir,
        });

        const s3 = getArtifactS3Client(props.event);

        const inputArtifact = await s3.getObject({
            Bucket: props.event['CodePipeline.job'].data.inputArtifacts[0].location.s3Location.bucketName,
            Key: props.event['CodePipeline.job'].data.inputArtifacts[0].location.s3Location.objectKey
        }).promise();

        const inZip = new AdmZip(inputArtifact.Body as Buffer);
        const pipelineConfigYaml = inZip.readAsText('pipeline-config.yaml');

        new SynthesisStack(app, STACK_ID, {
            managerResources: props.synthPipeline,
            resolver: props.resolver,
            unresolvedPipelineConfig: yaml.safeLoad(pipelineConfigYaml),
            orchestratorFactories: props.orchestratorFactories,
            resourceFactories: props.resourceFactories,
            uniquifier: props.uniquifier,
            tokenizer: props.tokenizer
        });
        const template = app.synth().getStackArtifact(STACK_ID).template;

        const outZip = new AdmZip();
        outZip.addFile('template.json', Buffer.from(JSON.stringify(template)));

        await s3.putObject({
            Bucket: props.event['CodePipeline.job'].data.outputArtifacts[0].location.s3Location.bucketName,
            Key: props.event['CodePipeline.job'].data.outputArtifacts[0].location.s3Location.objectKey,
            Body: outZip.toBuffer()
        }).promise();
    }

    async safeHandle(props: SynthesisHandlerProps): Promise<void> {
        let cleanupCb = EMPTY_VOID_FN;
        const cp = new CodePipeline();

        try {
            const userData = JSON.parse(props.event['CodePipeline.job'].data.actionConfiguration.configuration.UserParameters);

            const scratchDir = userData.scratchDir;
            const scratchDirCleanup = userData.scratchDirCleanup;
            const synthPipeline: ManagerResources = userData.synthPipeline;

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

            Object.assign(synthPipeline, {
                assetKeys: JSON.parse(process.env.ASSET_KEYS ?? throwError(new Error('ASSET_KEYS env var is missing.')))
            });
            await this.handle({...props, synthPipeline, cdkOutDir: cdkOutDir.name});
            await cp.putJobSuccessResult({jobId: props.event['CodePipeline.job'].id}).promise();
        }
        catch (err) {
            console.error(err);
            await cp.putJobFailureResult({jobId: props.event['CodePipeline.job'].id, failureDetails: {
                type: 'JobFailed',
                message: `Failed to synthesize pipeline. Ref# ${props.context.awsRequestId}`
            }}).promise();
        }
        finally {
            cleanupCb();
        }
    }
}