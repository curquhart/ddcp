import {
    BaseOrchestratorFactory, BranchOptions,
    CodeBuildActionProps, CounterActionProps,
    Orchestrator,
    OrchestratorProps, S3PublishActionProps,
    Stage
} from './BaseOrchestratorFactory';
import {Pipeline as CodePipeline, IStage as CodePipelineStage, IPipeline, Artifact} from '@aws-cdk/aws-codepipeline';
import {Aws} from '@aws-cdk/core';
import {Uniquifier} from '../Uniquifier';
import {Repository} from '@aws-cdk/aws-codecommit';
import {
    CacheControl,
    CodeBuildAction,
    CodeCommitSourceAction,
    CodeCommitTrigger, LambdaInvokeAction,
    S3DeployAction
} from '@aws-cdk/aws-codepipeline-actions';
import * as targets from '@aws-cdk/aws-events-targets';
import {tOrDefault} from '@ddcp/typehelpers';
import {ManagerResources} from '../SynthesisHandler';
import {Artifacts} from '@aws-cdk/aws-codebuild';
import {throwError} from '@ddcp/errorhandling';
import {PolicyDocument, PolicyStatement, Role} from '@aws-cdk/aws-iam';
import * as s3 from '@aws-cdk/aws-s3';

export const NAME = 'CodePipeline';

interface CodePipelineOrchestratorStageProps {
    readonly pipeline: CodePipelineOrchestrator;
    readonly uniquifier: Uniquifier;
    readonly artifacts: Record<string, Artifact>;
    readonly managerPipeline: IPipeline;
    readonly managerResources: ManagerResources;
    readonly stageName: string;
}

class CodePipelineOrchestratorStage implements Stage {
    private stage: CodePipelineStage;

    constructor(
        private readonly props: CodePipelineOrchestratorStageProps
    ) {
        this.stage = props.pipeline.codePipeline.addStage({
            stageName: props.stageName
        });
    }

    addCodeCommitSourceAction(actionName: string, repositoryName: string, repositoryBranch: BranchOptions): void {
        const isSameSourceAsSynth = repositoryName === this.props.managerResources.sourceRepoName && this.props.managerResources.sourceType === 'CodeCommit';

        this.props.artifacts[actionName] = new Artifact(actionName);
        this.stage.addAction(new CodeCommitSourceAction({
            actionName: actionName,
            repository: Repository.fromRepositoryName(this.props.pipeline.props.scope, this.props.uniquifier.next('Repo'), repositoryName),
            branch: repositoryBranch.BranchName,
            output: this.props.artifacts[ actionName ],
            trigger: isSameSourceAsSynth ? CodeCommitTrigger.NONE : CodeCommitTrigger.EVENTS
        }));

        if (isSameSourceAsSynth) {
            this.props.managerPipeline.onStateChange('SynthSuccess', {
                target: new targets.CodePipeline(this.props.pipeline.codePipeline),
                eventPattern: {
                    detailType: [
                        'CodePipeline Pipeline Execution State Change',
                        'CodePipeline Pipeline Skipped'
                    ],
                    source: ['aws.codepipeline', 'synth.codepipeline'],
                    region: [Aws.REGION],
                    detail: {
                        pipeline: [this.props.managerPipeline.pipelineName],
                        state: ['SUCCEEDED']
                    }
                }
            });
        }
    }

    addCodeBuildAction(props: CodeBuildActionProps): void {
        const cbInputs: Array<Artifact> = [];
        const cbOutputs: Array<Artifact> = [];
        if (props.action.InputArtifacts !== undefined) {
            for (const artifactName of props.action.InputArtifacts) {
                if (this.props.artifacts[artifactName] === undefined) {
                    this.props.artifacts[artifactName] = new Artifact(artifactName);
                }

                cbInputs.push(this.props.artifacts[artifactName]);
            }
        }
        if (props.action.BuildSpec?.Inline?.artifacts !== undefined && props.action.BuildSpec.Inline.artifacts['secondary-artifacts'] !== undefined) {
            for (const artifactName of Object.keys(props.action.BuildSpec.Inline.artifacts['secondary-artifacts'])) {
                this.props.artifacts[artifactName] = new Artifact(artifactName);
                props.project.addSecondaryArtifact(Artifacts.s3({
                    bucket: this.props.pipeline.codePipeline.artifactBucket,
                    path: `cb/${artifactName}`,
                    identifier: artifactName,
                    name: artifactName,
                }));
                cbOutputs.push(this.props.artifacts[artifactName]);
            }
        }
        const cbAction = new CodeBuildAction({
            actionName: props.action.Name,
            input: this.props.artifacts[props.action.SourceName ?? throwError(new Error('SourceName is required.'))],
            extraInputs: cbInputs,
            project: props.project,
            runOrder: props.action.Order,
            outputs: cbOutputs,
        });

        this.stage.addAction(cbAction);
    }

    addS3PublishAction(props: S3PublishActionProps): void {
        const bucket = props.action.BucketArn !== undefined ?
            s3.Bucket.fromBucketArn(this.props.pipeline.props.scope, this.props.uniquifier.next('Bucket'), props.action.BucketArn) :
            props.action.BucketName !== undefined ?
                s3.Bucket.fromBucketName(this.props.pipeline.props.scope, this.props.uniquifier.next('Bucket'), props.action.BucketName) :
                throwError(new Error('BucketArn or BucketName is required.'));

        this.stage.addAction(new S3DeployAction({
            actionName: props.action.Name,
            input: props.action.SourceName !== undefined && this.props.artifacts[props.action.SourceName] !== undefined ?
                this.props.artifacts[props.action.SourceName] :
                throwError(new Error('SourceName is required and must be a valid artifact name.')),
            bucket,
            objectKey: props.action.ObjectKey,
            extract: props.action.Extract,
            accessControl: props.action.AccessControl,
            runOrder: props.action.Order,
            cacheControl: props.action.CacheControl !== undefined ?
                props.action.CacheControl.map((entry) => CacheControl.fromString(entry)) :
                undefined,
            role: new Role(this.props.pipeline.props.scope, this.props.uniquifier.next('Role'), {
                assumedBy: this.props.pipeline.codePipeline.role,
                inlinePolicies: {
                    'Default': new PolicyDocument({
                        statements: [
                            new PolicyStatement({
                                actions: [
                                    's3:PutObject',
                                    ...(props.action.AccessControl !== undefined ? ['s3:PutObjectAcl'] : [])
                                ],
                                resources: [ bucket.arnForObjects('*') ],
                            })
                        ],
                    }),
                },
            })
        }));
    }

    addCounterAction(props: CounterActionProps): void {
        const artifactName = props.action.OutputArtifactName;
        if (this.props.artifacts[artifactName] === undefined) {
            this.props.artifacts[artifactName] = new Artifact(artifactName);
        }

        props.lambda.addToRolePolicy(props.counter.getOutput('ReadPolicy') as PolicyStatement);
        props.lambda.addToRolePolicy(props.counter.getOutput('WritePolicy') as PolicyStatement);

        this.stage.addAction(new LambdaInvokeAction({
            actionName: props.action.Name,
            lambda: props.lambda,
            userParameters: {
                Operation: props.action.Operation,
                TableName: props.counter.getOutput('TableName'),
                CounterId: props.counter.getOutput('CounterId'),
            },
            outputs: [
                this.props.artifacts[artifactName]
            ],
        }));
    }
}

class CodePipelineOrchestrator implements Orchestrator {
    codePipeline: CodePipeline;
    artifacts: Record<string, Artifact> = {};

    constructor(
        readonly props: OrchestratorProps,
    ) {
        this.codePipeline = new CodePipeline(props.scope, props.uniquifier.next('CodePipeline'), {
            pipelineName: props.pipeline.Name
        });
    }

    addSources(): void {
        const sourceStage = this.addStage('Source');
        for (const source of tOrDefault(this.props.pipeline.Sources, [])) {
            if (source.Name === undefined) {
                throw new Error('Name is required.');
            }
            if (source.RepositoryName === undefined) {
                throw new Error('RepositoryName is required.');
            }
            this.artifacts[ source.Name ] = new Artifact(source.Name);

            sourceStage.addCodeCommitSourceAction(source.Name, source.RepositoryName, {
                BranchName: source.BranchName ?? throwError(new Error('BranchName is required.'))
            });
        }
    }

    addStage(stageName: string): Stage {
        return new CodePipelineOrchestratorStage({
            pipeline: this,
            uniquifier: this.props.uniquifier,
            artifacts: this.artifacts,
            managerPipeline: this.props.managerPipeline,
            managerResources: this.props.managerResources,
            stageName,
        });
    }
}

export class CodePipelineOrchestratorFactory extends BaseOrchestratorFactory {
    constructor(orchestrators: Record<string, BaseOrchestratorFactory>) {
        super(orchestrators);
    }

    get name(): string {
        return NAME;
    }

    new(props: OrchestratorProps): Orchestrator {
        return new CodePipelineOrchestrator(props);
    }
}
