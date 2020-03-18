import {IRepository, Repository} from '@aws-cdk/aws-codecommit';
import {PolicyStatement, ServicePrincipal} from '@aws-cdk/aws-iam';
import {BuildSpec, Project, Source} from '@aws-cdk/aws-codebuild';
import {Pipeline} from '@aws-cdk/aws-codepipeline';
import {Aws, Construct, Duration, Stack} from '@aws-cdk/core';
import {
    isCodeBuildAction,
    isCounterAction,
    isS3PublishAction,
    PipelineConfigs
} from './PipelineConfig';
import {ManagerResources} from './SynthesisHandler';
import * as events from '@aws-cdk/aws-events';
import * as targets from '@aws-cdk/aws-events-targets';
import {throwError} from '@ddcp/errorhandling';
import {CfnTopic, Topic} from '@aws-cdk/aws-sns';
import {Resolver} from './Resolver';
import {Code, Function, Runtime} from '@aws-cdk/aws-lambda';
import {SnsEventSource} from '@aws-cdk/aws-lambda-event-sources';
import {createHash} from 'crypto';
import {Bucket} from '@aws-cdk/aws-s3';
import {BaseOrchestratorFactory} from './orchestrator/BaseOrchestratorFactory';
import {Uniquifier} from './Uniquifier';
import {Tokenizer} from '@ddcp/tokenizer';
import {tOrDefault} from '@ddcp/typehelpers';
import {BaseResourceFactory} from './resource/BaseResourceFactory';

export class SynthesisStack extends Stack {
    constructor(
        scope: Construct,
        id: string,
        props: {
            managerResources: ManagerResources;
            resolver: Resolver;
            unresolvedPipelineConfig: Record<string, unknown>;
            orchestratorFactories: Record<string, BaseOrchestratorFactory>;
            resourceFactories: Record<string, BaseResourceFactory>;
            uniquifier: Uniquifier;
            tokenizer: Tokenizer;
        }
    ) {
        super(scope, id);

        const pipelineConfig = props.resolver.resolve(this, props.unresolvedPipelineConfig) as PipelineConfigs;

        const codePipelineSynthPipeline = Pipeline.fromPipelineArn(this, 'SynthPipeline', props.managerResources.arn);
        const funcs: Record<string, Function> = {};

        // create resources
        for (const resource of tOrDefault(pipelineConfig.Resources, [])) {
            const factory = props.resourceFactories[resource.Type ?? throwError(new Error('Resource Type is required.'))] ?? throwError(new Error(`Unknown resource type: ${resource.Type}`));
            factory.new(resource).constructCdk(this);
        }

        for (const pipeline of tOrDefault(pipelineConfig.Pipelines, [])) {
            const repositories: Record<string, IRepository> = {};
            const branchNames: Record<string, string | null> = {};

            if (pipeline.Orchestrator === undefined) {
                pipeline.Orchestrator = 'CodePipeline';
            }

            if (props.orchestratorFactories[pipeline.Orchestrator] === undefined) {
                throw new Error(`Invalid orchestrator: ${pipeline.Orchestrator}`);
            }
            const orchestratedPipeline = props.orchestratorFactories[pipeline.Orchestrator].new({
                scope: this,
                managerPipeline: codePipelineSynthPipeline,
                managerResources: props.managerResources,
                pipeline,
                uniquifier: props.uniquifier
            });

            const slackSettings = pipeline.Notifications?.Slack !== undefined && pipeline.Notifications?.Slack.length > 0 ? pipeline.Notifications?.Slack : undefined;
            const githubSettings = pipeline.GitHub;
            const snsTopic = slackSettings !== undefined || githubSettings !== undefined ? new Topic(this, props.uniquifier.next('Sns')) : undefined;
            if (snsTopic !== undefined) {
                snsTopic.addToResourcePolicy(new PolicyStatement({
                    actions: ['sns:Publish'],
                    principals: [new ServicePrincipal('events')],
                    resources: [snsTopic.topicArn]
                }));
                const slackSnsTopicNode = snsTopic?.node.defaultChild as CfnTopic;
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
            }

            if (snsTopic !== undefined && slackSettings !== undefined) {
                const handler = this.getFunction(this, funcs, props.managerResources, 'sns-to-slack', {});
                this.applySecretsManagerPolicyToFunction(handler, props.tokenizer, slackSettings);
                handler.addEventSource(new SnsEventSource(snsTopic));
            }

            if (snsTopic !== undefined && githubSettings !== undefined) {
                const handler = this.getFunction(this, funcs, props.managerResources, 'sns-to-github', {});
                this.applySecretsManagerPolicyToFunction(handler, props.tokenizer, githubSettings);
                handler.addEventSource(new SnsEventSource(snsTopic));
            }

            const sourceStage = orchestratedPipeline.addStage('Sources');
            for (const source of tOrDefault(pipeline.Sources, [])) {
                if (source.Name === undefined) {
                    throw new Error('Name is required.');
                }
                if (source.RepositoryName === undefined) {
                    throw new Error('RepositoryName is required.');
                }
                repositories[ source.Name ] = Repository.fromRepositoryName(this, props.uniquifier.next(`Repo${source.RepositoryName}${source.BranchName}`), source.RepositoryName);
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

                        const codeBuildProject = new Project(this, props.uniquifier.next('Project'), {
                            projectName: `${pipeline.Name}${stage.Name}${action.Name}Project`,
                            buildSpec: BuildSpec.fromObject(buildSpec),
                            source: Source.codeCommit({
                                repository,
                                branchOrRef: branchName ?? undefined,
                            })
                        });

                        if (snsTopic !== undefined) {
                            codeBuildProject.onStateChange('OnStateChange', {
                                target: new targets.SnsTopic(snsTopic, {
                                    message: events.RuleTargetInput.fromObject({
                                        buildStatus: events.EventField.fromPath('$.detail.build-status'),
                                        projectName: events.EventField.fromPath('$.detail.project-name'),
                                        buildId: events.EventField.fromPath('$.detail.build-id'),
                                        region: events.EventField.fromPath('$.region'),
                                        repositoryName: repository.repositoryName,
                                        branchName: branchName ?? undefined,
                                        buildEnvironment: events.EventField.fromPath('$.detail.additional-information.environment.environment-variables'),
                                        slackSettings: slackSettings?.map((slackSetting) => {
                                            return {
                                                // TODO: return a token to resolve from secrets manager and set lambda permissions appropriately for such.
                                                uri: slackSetting.WebHookUrl,
                                                channel: slackSetting.Channel ?? throwError(new Error('Channel is required')),
                                                username: slackSetting.UserName ?? throwError(new Error('UserName is required')),
                                                statuses: slackSetting.Statuses
                                            };
                                        }),
                                        githubSettings : githubSettings?.Auth !== undefined ? {
                                            auth: githubSettings.Auth,
                                            defaults: {
                                                owner: githubSettings.Defaults?.Owner,
                                                repo: githubSettings.Defaults?.Repo,
                                            }
                                        } : undefined,
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
                    else if (isCounterAction(action)) {
                        const lambda = this.getFunction(this, funcs, props.managerResources, 'action-counter', {});

                        orchestratedStage.addCounterAction({
                            action,
                            lambda,
                            counter: props.resourceFactories.Counter.new(action.Counter),
                        });
                    }
                    else {
                        throw new Error(`Unknown action type: ${action.Type}`);
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
    ): Function {
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

    private applySecretsManagerPolicyToFunction(fn: Function, tokenizer: Tokenizer, fnData: unknown): void {
        const secretTokens = tokenizer.getAllTokens('secret', fnData);
        if (Object.keys(secretTokens).length > 0) {
            fn.addToRolePolicy(new PolicyStatement({
                actions: ['secretsmanager:GetSecretValue'],
                resources: Object.values(secretTokens).map((secretToken) => `arn:${Aws.PARTITION}:secretsmanager:${Aws.REGION}:${Aws.ACCOUNT_ID}:secret:${secretToken.value}-*`)
            }));
            fn.addEnvironment('TOKENS', JSON.stringify(Object.assign({}, ...Object.entries(secretTokens).map(([key, token]) => {
                return {
                    [key]: token.token
                };
            }))));
        }

    }
}
