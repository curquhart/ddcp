import {IRepository, Repository} from '@aws-cdk/aws-codecommit';
import {Role, PolicyDocument, PolicyStatement} from '@aws-cdk/aws-iam';
import {Artifacts, BuildSpec, Project, Source} from '@aws-cdk/aws-codebuild';
import {Artifact, Pipeline} from '@aws-cdk/aws-codepipeline';
import {
    CacheControl,
    CodeBuildAction,
    CodeCommitSourceAction,
    CodeCommitTrigger,
    S3DeployAction
} from '@aws-cdk/aws-codepipeline-actions';
import {Aws, Construct, Stack} from '@aws-cdk/core';
import {isCodeBuildAction, isS3PublishAction, PipelineConfigs} from './PipelineConfig';
import {ManagerResources} from './SynthesisHandler';
import * as targets from '@aws-cdk/aws-events-targets';
import * as s3 from '@aws-cdk/aws-s3';
import {throwError} from './helpers';

export const tOrDefault = <T>(input: T | undefined, defaultValue: T): T => {
    return input !== undefined ? input : defaultValue;
};

export class SynthesisStack extends Stack {
    constructor(scope: Construct, id: string, managerResources: ManagerResources, pipelineConfig: PipelineConfigs) {
        super(scope, id);

        const codePipelineSynthPipeline = Pipeline.fromPipelineArn(this, 'SynthPipeline', managerResources.arn);

        let counter = 0;

        for (const pipeline of tOrDefault(pipelineConfig.Pipelines, [])) {
            const artifacts: Record<string, Artifact> = {};
            const repositories: Record<string, IRepository> = {};
            const codePipeline = new Pipeline(this, `Pipeline${counter++}`, {
                pipelineName: pipeline.Name
            });

            const sourceStage = codePipeline.addStage({
                stageName: 'Sources'
            });
            for (const source of tOrDefault(pipeline.Sources, [])) {
                if (source.Name === undefined) {
                    throw new Error('Name is required.');
                }
                if (source.RepositoryName === undefined) {
                    throw new Error('RepositoryName is required.');
                }
                artifacts[ source.Name ] = new Artifact(source.Name);
                repositories[ source.Name ] = Repository.fromRepositoryName(codePipeline, `Repo${source.RepositoryName}${source.BranchName}`, source.RepositoryName);

                const isSameSourceAsSynth = source.RepositoryName === managerResources.sourceRepoName && source.Type === managerResources.sourceType;
                sourceStage.addAction(new CodeCommitSourceAction({
                    actionName: source.Name,
                    repository: repositories[ source.Name ],
                    branch: source.BranchName,
                    output: artifacts[ source.Name ],
                    trigger: isSameSourceAsSynth ? CodeCommitTrigger.NONE : CodeCommitTrigger.EVENTS
                }));
                if (isSameSourceAsSynth) {
                    codePipelineSynthPipeline.onStateChange('SynthSuccess', {
                        target: new targets.CodePipeline(codePipeline),
                        eventPattern: {
                            detailType: [
                                'CodePipeline Pipeline Execution State Change',
                                'CodePipeline Pipeline Skipped'
                            ],
                            source: ['aws.codepipeline', 'synth.codepipeline'],
                            region: [Aws.REGION],
                            detail: {
                                pipeline: [codePipelineSynthPipeline.pipelineName],
                                state: ['SUCCEEDED']
                            }
                        }
                    });
                }
            }

            for (const stage of tOrDefault(pipeline.Stages, [])) {
                if (stage.Name === undefined) {
                    throw new Error('Name is required.');
                }

                const codePipelineStage = codePipeline.addStage({
                    stageName: stage.Name
                });

                for (const action of tOrDefault(stage.Actions, [])) {
                    if (action.Name === undefined) {
                        throw new Error('Name is required.');
                    }
                    if (isCodeBuildAction(action)) {
                        const buildSpec = action.BuildSpec !== undefined && action.BuildSpec.Inline !== undefined ?
                            action.BuildSpec.Inline :
                            throwError(new Error('BuildSpec.Inline is required.'));

                        const codePipelineProject = new Project(codePipeline, `${action.Name}Project`, {
                            projectName: `${action.Name}Project`,
                            buildSpec: BuildSpec.fromObject(buildSpec),
                            source: action.SourceName !== undefined ? Source.codeCommit({
                                repository: repositories[ action.SourceName ]
                            }) : undefined
                        });

                        const cbOutputs: Array<Artifact> = [];
                        if (buildSpec.artifacts && buildSpec.artifacts['secondary-artifacts'] !== undefined) {
                            for (const artifactName of Object.keys(buildSpec.artifacts['secondary-artifacts'])) {
                                artifacts[artifactName] = new Artifact(artifactName);
                                codePipelineProject.addSecondaryArtifact(Artifacts.s3({
                                    bucket: codePipeline.artifactBucket,
                                    path: `cb/${artifactName}`,
                                    identifier: artifactName,
                                    name: artifactName,
                                }));
                                cbOutputs.push(artifacts[artifactName]);
                            }
                        }
                        const cbAction = new CodeBuildAction({
                            actionName: action.Name,
                            input: artifacts[action.SourceName !== undefined ? action.SourceName : throwError(new Error('SourceName is required.'))],
                            project: codePipelineProject,
                            runOrder: action.Order,
                            outputs: cbOutputs,
                        });
                        codePipelineStage.addAction(cbAction);
                    }
                    else if (isS3PublishAction(action)) {
                        const bucket = action.BucketArn !== undefined ?
                            s3.Bucket.fromBucketArn(this, `Bucket${counter++}`, action.BucketArn) :
                            action.BucketName !== undefined ?
                                s3.Bucket.fromBucketName(this, `Bucket${counter++}`, action.BucketName) :
                                throwError(new Error('BucketArn or BucketName is required.'));

                        codePipelineStage.addAction(new S3DeployAction({
                            actionName: action.Name,
                            input: action.SourceName !== undefined && artifacts[action.SourceName] !== undefined ?
                                artifacts[action.SourceName] :
                                throwError(new Error('SourceName is required and must be a valid artifact name.')),
                            bucket,
                            objectKey: action.ObjectKey,
                            extract: action.Extract,
                            accessControl: action.AccessControl,
                            runOrder: action.Order,
                            cacheControl: action.CacheControl !== undefined ?
                                action.CacheControl.map((entry) => CacheControl.fromString(entry)) :
                                undefined,
                            role: new Role(this, `Role${counter++}`, {
                                assumedBy: codePipeline.role,
                                inlinePolicies: {
                                    'Default': new PolicyDocument({
                                        statements: [
                                            new PolicyStatement({
                                                actions: [
                                                    's3:PutObject',
                                                    's3:PutObjectAcl'
                                                ],
                                                resources: [ bucket.arnForObjects('*') ],
                                            })
                                        ],
                                    }),
                                },
                            })
                        }));
                    }
                }
            }
        }
    }
}
