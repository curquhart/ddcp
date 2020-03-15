import {IRepository, Repository} from '@aws-cdk/aws-codecommit';
import {PolicyDocument, PolicyStatement, Role, ServicePrincipal} from '@aws-cdk/aws-iam';
import {Artifacts, BuildSpec, Project, Source} from '@aws-cdk/aws-codebuild';
import {Artifact, Pipeline} from '@aws-cdk/aws-codepipeline';
import {
    CacheControl,
    CodeBuildAction,
    CodeCommitSourceAction,
    CodeCommitTrigger,
    S3DeployAction
} from '@aws-cdk/aws-codepipeline-actions';
import {Aws, Construct, Duration, Stack} from '@aws-cdk/core';
import {isCodeBuildAction, isS3PublishAction, PipelineConfigs} from './PipelineConfig';
import {ManagerResources} from './SynthesisHandler';
import * as events from '@aws-cdk/aws-events';
import * as targets from '@aws-cdk/aws-events-targets';
import * as s3 from '@aws-cdk/aws-s3';
import {throwError} from './helpers';
import {CfnTopic, Topic} from '@aws-cdk/aws-sns';
import {Resolver} from './Resolver';
import {Code, Function, IFunction, Runtime} from '@aws-cdk/aws-lambda';
import {SnsEventSource} from '@aws-cdk/aws-lambda-event-sources';
import {createHash} from 'crypto';
import * as fs from 'fs';

const MODULES: Record<string, string> = {
    'sns-to-slack': fs.readFileSync('node_modules/@ddcp/sns-to-slack/dist/index.min.js').toString()
};

export const tOrDefault = <T>(input: T | undefined, defaultValue: T): T => {
    return input !== undefined ? input : defaultValue;
};

export class SynthesisStack extends Stack {
    constructor(
        scope: Construct,
        id: string,
        managerResources: ManagerResources,
        resolver: Resolver,
        unresolvedPipelineConfig: Record<string, unknown>
    ) {
        super(scope, id);

        const pipelineConfig = resolver.resolve(this, unresolvedPipelineConfig) as PipelineConfigs;

        const codePipelineSynthPipeline = Pipeline.fromPipelineArn(this, 'SynthPipeline', managerResources.arn);
        const funcs: Record<string, Function> = {};

        let counter = 0;

        for (const pipeline of tOrDefault(pipelineConfig.Pipelines, [])) {
            const artifacts: Record<string, Artifact> = {};
            const repositories: Record<string, IRepository> = {};
            const codePipeline = new Pipeline(this, `Pipeline${counter++}`, {
                pipelineName: pipeline.Name
            });

            const slackSettings = pipeline.Notifications?.Slack !== undefined && pipeline.Notifications?.Slack.length > 0 ? pipeline.Notifications?.Slack : undefined;
            const slackSnsTopic = slackSettings !== undefined ? new Topic(this, `SlackSns${counter++}`) : undefined;
            if (slackSnsTopic !== undefined) {
                slackSnsTopic.addToResourcePolicy(new PolicyStatement({
                    actions: ['sns:Publish'],
                    principals: [new ServicePrincipal('events')],
                    resources: [slackSnsTopic.topicArn]
                }));
                const slackSnsTopicNode = slackSnsTopic?.node.defaultChild as CfnTopic;
                slackSnsTopicNode.node.addInfo('cfn_nag disabled.');
                slackSnsTopicNode
                    .addOverride('Metadata', {
                        'cfn_nag': {
                            'rules_to_suppress': [
                                {
                                    id: 'W47',
                                    reason: 'CodeBuild events do not contain any sensitive information and does not need encryption.',
                                },
                            ]
                        }
                    });

                const webhookLambda = this.getFunction(this, funcs, 'sns-to-slack', {});
                webhookLambda.addEventSource(new SnsEventSource(slackSnsTopic));
            }

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

                        const repository = repositories[ action.SourceName ?? throwError(new Error('SourceName cannot be null.')) ];
                        const branchName = 'master';

                        const codeBuildProject = new Project(codePipeline, `${action.Name}Project`, {
                            projectName: `${action.Name}Project`,
                            buildSpec: BuildSpec.fromObject(buildSpec),
                            source: Source.codeCommit({
                                repository,
                                branchOrRef: branchName
                            })
                        });

                        if (slackSettings !== undefined && slackSnsTopic !== undefined) {
                            codeBuildProject.onStateChange('OnStateChange', {
                                target: new targets.SnsTopic(slackSnsTopic, {
                                    message: events.RuleTargetInput.fromObject({
                                        buildStatus: events.EventField.fromPath('$.detail.build-status'),
                                        projectName: events.EventField.fromPath('$.detail.project-name'),
                                        buildId: events.EventField.fromPath('$.detail.build-id'),
                                        region: events.EventField.fromPath('$.region'),
                                        repositoryName: repository.repositoryName,
                                        branchName,
                                        slackSettings: slackSettings.map((slackSetting) => {
                                            return {
                                                // TODO: return a token to resolve from secrets manager and set lambda permissions appropriately for such.
                                                uri: slackSetting.WebHookUrl,
                                                channel: slackSetting.Channel ?? throwError(new Error('Channel is required')),
                                                username: slackSetting.UserName ?? throwError(new Error('UserName is required')),
                                                statuses: slackSetting.Statuses
                                            };
                                        })
                                    })
                                }),
                            });
                        }

                        const cbOutputs: Array<Artifact> = [];
                        if (buildSpec.artifacts && buildSpec.artifacts['secondary-artifacts'] !== undefined) {
                            for (const artifactName of Object.keys(buildSpec.artifacts['secondary-artifacts'])) {
                                artifacts[artifactName] = new Artifact(artifactName);
                                codeBuildProject.addSecondaryArtifact(Artifacts.s3({
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
                            project: codeBuildProject,
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

    private getFunction(
        scope: Stack,
        funcs: Record<string, Function>,
        moduleName: string,
        env: Record<string, string>
    ): IFunction {
        const funcId = `${moduleName}-${createHash('md5').update(JSON.stringify(env)).digest('hex')}`;
        if (funcs[funcId] !== undefined) {
            return funcs[funcId];
        }

        funcs[funcId] = new Function(scope, funcId, {
            code: Code.fromInline(MODULES[moduleName] ?? throwError(new Error(`Invalid module: ${moduleName}`))),
            runtime: Runtime.NODEJS_12_X,
            handler: 'index.handler',
            environment: env,
            timeout: Duration.seconds(30),
        });

        return funcs[funcId];
    }
}
