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
import {Base as BaseFn} from './fn/Base';
import {Join} from './fn/resolvers/Join';
import {Path} from './fn/resolvers/Path';
import {PathForAlias} from './fn/resolvers/PathForAlias';
import {Import} from './fn/resolvers/Import';
import {SsmString} from './fn/resolvers/SsmString';
import {Secret} from './fn/resolvers/Secret';
import {Script} from './fn/resolvers/Script';
import {CodePipelineOrchestratorFactory} from './orchestrator/CodePipelineOrchestratorFactory';
import {CloudWatchOrchestratorFactory} from './orchestrator/CloudWatchOrchestratorFactory';
import {CounterResourceFactory} from './resource/CounterResourceFactory';
import {ArtifactStore} from './index';
import {Param} from './fn/resolvers/Param';
import {GitSourceSync} from './builders/GitSourceSync';
import {error} from '@ddcp/logger';
import {LambdaOutputArtifacts} from '@ddcp/module-collection';
const STACK_ID = 'generated';

export interface ManagerResources {
    arn: string;
    sourceBranch: string;
    sourceType: 'CodeCommit';
    sourceRepoName: string;
    eventBusArn: string;
    assetBucketName: string;
    assetKeys: LambdaOutputArtifacts;
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
    artifactStore: Record<string, Buffer>;
    gitSourceBuilder: GitSourceSync;
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

        await new SynthesisStack(app, STACK_ID, {
            managerResources: props.synthPipeline,
            resolver: props.resolver,
            unresolvedPipelineConfig: yaml.safeLoad(pipelineConfigYaml),
            orchestratorFactories: props.orchestratorFactories,
            resourceFactories: props.resourceFactories,
            uniquifier: props.uniquifier,
            tokenizer: props.tokenizer,
            artifactStore: props.artifactStore,
            gitSourceBuilder: props.gitSourceBuilder,
        }).init();
        const template = app.synth().getStackArtifact(STACK_ID).template;

        const outZip = new AdmZip();
        outZip.addFile('template.json', Buffer.from(JSON.stringify(template)));
        Object.entries(props.artifactStore).forEach(([fileName, fileContents]) => {
            outZip.addFile(fileName, fileContents);
        });

        await s3.putObject({
            Bucket: props.event['CodePipeline.job'].data.outputArtifacts[0].location.s3Location.bucketName,
            Key: props.event['CodePipeline.job'].data.outputArtifacts[0].location.s3Location.objectKey,
            Body: outZip.toBuffer()
        }).promise();
    }

    async safeHandle(event: CodePipelineEvent, context: Context): Promise<void> {
        let cleanupCb = EMPTY_VOID_FN;
        const cp = new CodePipeline();

        try {
            const userData = JSON.parse(event['CodePipeline.job'].data.actionConfiguration.configuration.UserParameters);

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

            const artifactStore: ArtifactStore = {};
            const uniquifier = new Uniquifier();
            const tokenizer = new Tokenizer();

            const resolvers: Record<string, BaseFn<unknown, Array<unknown>>> = {};
            const resourceFactories: Record<string, BaseResourceFactory> = {};
            const orchestratorFactories: Record<string, BaseOrchestratorFactory> = {};

            new Join(resolvers).init();
            new Path(resolvers, resourceFactories).init();
            new PathForAlias(resolvers).init();
            new Import(resolvers).init();
            new SsmString(resolvers, uniquifier).init();
            new Secret(resolvers, tokenizer).init();
            new Script(resolvers, artifactStore, tokenizer).init();
            new Param(resolvers, synthPipeline).init();

            const resolver = new Resolver(resolvers, context.awsRequestId);

            new CodePipelineOrchestratorFactory(orchestratorFactories).init();
            new CloudWatchOrchestratorFactory(orchestratorFactories).init();

            new CounterResourceFactory(resourceFactories, tokenizer, uniquifier).init();

            const gitSourceBuilder = new GitSourceSync();

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
            await this.handle({
                event,
                resolver,
                orchestratorFactories,
                resourceFactories,
                uniquifier,
                tokenizer,
                artifactStore,
                synthPipeline,
                cdkOutDir: cdkOutDir.name,
                gitSourceBuilder
            });
            await cp.putJobSuccessResult({jobId: event['CodePipeline.job'].id}).promise();
        }
        catch (err) {
            error(context.awsRequestId, err);
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