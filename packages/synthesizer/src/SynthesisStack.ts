import {IRepository, Repository} from '@aws-cdk/aws-codecommit';
import {PolicyStatement, ServicePrincipal} from '@aws-cdk/aws-iam';
import {BuildSpec, Project, Source} from '@aws-cdk/aws-codebuild';
import {Artifact, Pipeline} from '@aws-cdk/aws-codepipeline';
import {Construct, Duration, Stack} from '@aws-cdk/core';
import {isCodeBuildAction, isS3PublishAction, PipelineConfigs} from './PipelineConfig';
import {ManagerResources} from './SynthesisHandler';
import * as events from '@aws-cdk/aws-events';
import * as targets from '@aws-cdk/aws-events-targets';
import {throwError} from './helpers';
import {CfnTopic, Topic} from '@aws-cdk/aws-sns';
import {Resolver} from './Resolver';
import {Code, Function, IFunction, Runtime} from '@aws-cdk/aws-lambda';
import {SnsEventSource} from '@aws-cdk/aws-lambda-event-sources';
import {createHash} from 'crypto';
import {Bucket} from '@aws-cdk/aws-s3';
import {BaseOrchestratorFactory} from './orchestrator/BaseOrchestratorFactory';
import {Uniquifier} from './Uniquifier';

export const tOrDefault = <T>(input: T | undefined, defaultValue: T): T => {
    return input !== undefined ? input : defaultValue;
};

export class SynthesisStack extends Stack {
    constructor(
        scope: Construct,
        id: string,
        managerResources: ManagerResources,
        resolver: Resolver,
        unresolvedPipelineConfig: Record<string, unknown>,
        orchestrators: Record<string, BaseOrchestratorFactory>,
        uniquifier: Uniquifier
    ) {
        super(scope, id);

        const pipelineConfig = resolver.resolve(this, unresolvedPipelineConfig) as PipelineConfigs;

        const codePipelineSynthPipeline = Pipeline.fromPipelineArn(this, 'SynthPipeline', managerResources.arn);
        const funcs: Record<string, Function> = {};

        for (const pipeline of tOrDefault(pipelineConfig.Pipelines, [])) {
            const artifacts: Record<string, Artifact> = {};
            const repositories: Record<string, IRepository> = {};
            const branchNames: Record<string, string | null> = {};

            if (pipeline.Orchestrator === undefined) {
                pipeline.Orchestrator = 'CodePipeline';
            }

            if (orchestrators[pipeline.Orchestrator] === undefined) {
                throw new Error(`Invalid orchestrator: ${pipeline.Orchestrator}`);
            }
            const orchestratedPipeline = orchestrators[pipeline.Orchestrator].new({
                scope: this,
                managerPipeline: codePipelineSynthPipeline,
                managerResources,
                pipeline,
                uniquifier
            });

            const slackSettings = pipeline.Notifications?.Slack !== undefined && pipeline.Notifications?.Slack.length > 0 ? pipeline.Notifications?.Slack : undefined;
            const slackSnsTopic = slackSettings !== undefined ? new Topic(this, uniquifier.next('SlackSns')) : undefined;
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

                const webhookLambda = this.getFunction(this, funcs, managerResources, 'sns-to-slack', {});
                webhookLambda.addEventSource(new SnsEventSource(slackSnsTopic));
            }

            const sourceStage = orchestratedPipeline.addStage('Sources');
            for (const source of tOrDefault(pipeline.Sources, [])) {
                if (source.Name === undefined) {
                    throw new Error('Name is required.');
                }
                if (source.RepositoryName === undefined) {
                    throw new Error('RepositoryName is required.');
                }
                artifacts[ source.Name ] = new Artifact(source.Name);
                repositories[ source.Name ] = Repository.fromRepositoryName(this, uniquifier.next(`Repo${source.RepositoryName}${source.BranchName}`), source.RepositoryName);
                branchNames[ source.Name ] = source.BranchName ?? null;

                sourceStage.addCodeCommitSourceAction(
                    source.Name,
                    source.RepositoryName,
                    {
                        BranchName: source.BranchName,
                        BranchPattern: source.BranchPattern,
                    },
                );
            }

            for (const stage of tOrDefault(pipeline.Stages, [])) {
                if (stage.Name === undefined) {
                    throw new Error('Name is required.');
                }

                const orchestratedStage = orchestratedPipeline.addStage(stage.Name);

                for (const action of tOrDefault(stage.Actions, [])) {
                    if (action.Name === undefined) {
                        throw new Error('Name is required.');
                    }
                    if (isCodeBuildAction(action)) {
                        const buildSpec = action.BuildSpec !== undefined && action.BuildSpec.Inline !== undefined ?
                            action.BuildSpec.Inline :
                            throwError(new Error('BuildSpec.Inline is required.'));

                        const sourceName = action.SourceName ?? throwError(new Error('SourceName cannot be null.'));
                        const repository = repositories[ sourceName ];
                        const branchName = branchNames[ sourceName ];
                        if (branchName === undefined) {
                            throw new Error('BranchName cannot be undefined.');
                        }

                        const codeBuildProject = new Project(this, uniquifier.next('Project'), {
                            projectName: `${pipeline.Name}${stage.Name}${action.Name}Project`,
                            buildSpec: BuildSpec.fromObject(buildSpec),
                            source: Source.codeCommit({
                                repository,
                                branchOrRef: branchName !== null ? branchName : undefined,
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
                                        branchName: branchName !== null ? branchName : undefined,
                                        buildEnvironment: events.EventField.fromPath('$.detail.additional-information.environment.environment-variables'),
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

                        orchestratedStage.addCodeBuildAction({
                            action,
                            project: codeBuildProject,
                        });
                    }
                    else if (isS3PublishAction(action)) {
                        orchestratedStage.addS3PublishAction({
                            action,
                        });
                    }
                }
            }
        }
    }

    private getFunction(
        scope: Stack,
        funcs: Record<string, Function>,
        managerResources: ManagerResources,
        moduleName: string,
        env: Record<string, string>
    ): IFunction {
        const funcId = `${moduleName}-${createHash('md5').update(JSON.stringify(env)).digest('hex')}`;
        if (funcs[funcId] !== undefined) {
            return funcs[funcId];
        }

        const assetBucket = Bucket.fromBucketName(scope, `${funcId}Bucket`, managerResources.assetBucketName);
        funcs[funcId] = new Function(scope, funcId, {
            code: Code.fromBucket(assetBucket, managerResources.assetKeys[moduleName] ?? throwError(new Error(`Invalid module: ${moduleName}`))),
            runtime: Runtime.NODEJS_12_X,
            handler: 'dist/bundled.handler',
            environment: env,
            timeout: Duration.seconds(30),
        });

        return funcs[funcId];
    }
}
