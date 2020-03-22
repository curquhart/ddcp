import {IRepository, Repository} from '@aws-cdk/aws-codecommit';
import {PolicyStatement, ServicePrincipal} from '@aws-cdk/aws-iam';
import {BuildSpec, LinuxBuildImage, Project, Source} from '@aws-cdk/aws-codebuild';
import {Pipeline} from '@aws-cdk/aws-codepipeline';
import {Aws, Construct, Duration, Stack} from '@aws-cdk/core';
import {
    isCodeBuildAction,
    isCounterAction,
    isS3PublishAction,
    PipelineConfigs, SourceType
} from './PipelineConfig';
import {ManagerResources} from './SynthesisHandler';
import * as events from '@aws-cdk/aws-events';
import * as targets from '@aws-cdk/aws-events-targets';
import {throwError} from '@ddcp/errorhandling';
import {CfnTopic, Topic} from '@aws-cdk/aws-sns';
import {Resolver} from './Resolver';
import {Code, Function, ILayerVersion, LayerVersion, Runtime} from '@aws-cdk/aws-lambda';
import {SnsEventSource} from '@aws-cdk/aws-lambda-event-sources';
import {createHash} from 'crypto';
import {Bucket} from '@aws-cdk/aws-s3';
import {BaseOrchestratorFactory} from './orchestrator/BaseOrchestratorFactory';
import {Uniquifier} from './Uniquifier';
import {Tokenizer} from '@ddcp/tokenizer';
import {tOrDefault} from '@ddcp/typehelpers';
import {BaseResourceFactory} from './resource/BaseResourceFactory';
import {GitSourceSync} from './builders/GitSourceSync';

const SECRETS_MANAGER_ARN_REGEXP = /^(arn:[^:]+:secretsmanager:[^:]+:[^:]+:secret:[^:-]+).*$/;

interface SynthesisStackProps {
    managerResources: ManagerResources;
    resolver: Resolver;
    unresolvedPipelineConfig: Record<string, unknown>;
    orchestratorFactories: Record<string, BaseOrchestratorFactory>;
    resourceFactories: Record<string, BaseResourceFactory>;
    uniquifier: Uniquifier;
    tokenizer: Tokenizer;
    artifactStore: Record<string, Buffer>;
    gitSourceBuilder: GitSourceSync;
}

export class SynthesisStack extends Stack {
    constructor(scope: Construct, id: string, private readonly props: SynthesisStackProps) {
        super(scope, id);
    }

    async init(): Promise<void> {
        const props = this.props;
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
                const handler = this.getFunction({
                    scope: this,
                    funcs,
                    managerResources: props.managerResources,
                    moduleName: 'sns-to-slack'
                });
                this.applySecretsManagerPolicyToFunction(handler, props.tokenizer, slackSettings);
                handler.addEventSource(new SnsEventSource(snsTopic));
            }

            if (snsTopic !== undefined && githubSettings !== undefined) {
                const handler = this.getFunction({
                    scope: this,
                    funcs,
                    managerResources: props.managerResources,
                    moduleName: 'sns-to-github'
                });
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

                if (source.Type === SourceType.GIT) {
                    const mirrorFn = this.getFunction({
                        scope: this,
                        funcs,
                        managerResources: props.managerResources,
                        moduleName: 'github-mirror',
                        memorySize: 512,
                        timeout: Duration.seconds(60),
                        layers: [
                            // https://github.com/lambci/git-lambda-layer
                            LayerVersion.fromLayerVersionArn(this, 'GitLayer', `arn:aws:lambda:${Aws.REGION}:553035198032:layer:git-lambda2:4`)
                        ]
                    });
                    const fnData = props.gitSourceBuilder.setupSync(
                        this,
                        mirrorFn,
                        source,
                        repositories[ source.Name ],
                        props.uniquifier
                    );
                    this.applySecretsManagerPolicyToFunction(mirrorFn, props.tokenizer, fnData);
                }

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

                        const codeBuildProject = new Project(this, props.uniquifier.next(`${pipeline.Name}${stage.Name}${action.Name}Project`), {
                            projectName: `${pipeline.Name}${stage.Name}${action.Name}Project`,
                            buildSpec: BuildSpec.fromObject(buildSpec),
                            source: Source.codeCommit({
                                repository,
                                branchOrRef: branchName ?? undefined,
                            }),
                            // TODO: make this configurable.
                            environment: {
                                buildImage: LinuxBuildImage.STANDARD_3_0,
                            },
                        });

                        // TODO: it's late, simplify this... a lot.
                        if (buildSpec.env !== undefined && buildSpec.env['secrets-manager'] !== undefined) {
                            const requiredSecrets = Object.values(buildSpec.env['secrets-manager']).map((value) => {
                                // codebuild has a weird format - arnOrName:KEY:EXTRACT:STAGE:VERSION. Everything after KEY is optional.
                                const match = value.match(SECRETS_MANAGER_ARN_REGEXP);

                                let secretName = '';

                                if (match !== null) {
                                    secretName = match[1];
                                }
                                else {
                                    [secretName] = value.split(':');
                                }

                                const parts = value.substr(secretName.length + 1).split(':');

                                parts.shift(); // key
                                parts.shift(); // stage
                                const secretVersion = parts.pop() ?? '*';

                                return `${secretName}-${secretVersion}`;
                            }).filter((value) => value !== '');

                            if (requiredSecrets.length > 0) {
                                const secretsManagerPolicy = this.getSecretsManagerPolicy(requiredSecrets);
                                codeBuildProject.addToRolePolicy(secretsManagerPolicy);
                            }
                        }
                        const allS3Keys: Array<string> = [];
                        await props.tokenizer.resolveAllTokens('s3', buildSpec, (value) => {
                            if (allS3Keys.indexOf(value) === -1) {
                                allS3Keys.push(value);
                            }
                            return value;
                        });

                        if (allS3Keys.length > 0) {
                            codeBuildProject.addToRolePolicy(new PolicyStatement({
                                actions: ['s3:GetObject'],
                                resources: allS3Keys.map((key) => `arn:aws:s3:::${key}`),
                            }));
                        }

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
                        const lambda = this.getFunction({
                            scope: this,
                            funcs,
                            managerResources: props.managerResources,
                            moduleName: 'action-counter'
                        });

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

    private getFunction(props: {
        scope: Stack;
        funcs: Record<string, Function>;
        managerResources: ManagerResources;
        moduleName: string;
        env?: Record<string, string>;
        memorySize?: number;
        timeout?: Duration;
        layers?: Array<ILayerVersion>;
    }): Function {
        const funcId = `${props.moduleName}-${createHash('md5')
            .update(`${props.memorySize}`)
            .update(JSON.stringify(props.env || {}))
            .digest('hex')}`;
        if (props.funcs[funcId] !== undefined) {
            return props.funcs[funcId];
        }

        const assetBucket = Bucket.fromBucketName(props.scope, `${funcId}Bucket`, props.managerResources.assetBucketName);
        props.funcs[funcId] = new Function(props.scope, funcId, {
            code: Code.fromBucket(assetBucket, props.managerResources.assetKeys[props.moduleName] ?? throwError(new Error(`Invalid module: ${props.moduleName}`))),
            runtime: Runtime.NODEJS_12_X,
            handler: 'dist/bundled.handler',
            environment: props.env,
            memorySize: props.memorySize,
            timeout: props.timeout ?? Duration.seconds(30),
            layers: props.layers,
        });

        return props.funcs[funcId];
    }

    private applySecretsManagerPolicyToFunction(fn: Function, tokenizer: Tokenizer, fnData: unknown): void {
        const secretTokens = tokenizer.getAllTokens('secret', fnData);
        if (Object.keys(secretTokens).length > 0) {
            fn.addToRolePolicy(this.getSecretsManagerPolicy(Object.values(secretTokens).map((token) => token.value)));
            fn.addEnvironment('TOKENS', JSON.stringify(Object.assign({}, ...Object.entries(secretTokens).map(([key, token]) => {
                return {
                    [key]: token.token
                };
            }))));
        }
    }

    private getSecretsManagerPolicy(secretNamesAndArns: Array<string>): PolicyStatement {
        return new PolicyStatement({
            actions: ['secretsmanager:GetSecretValue'],
            resources: secretNamesAndArns.map((secretNameOrArn) => {
                const match = secretNameOrArn.match(SECRETS_MANAGER_ARN_REGEXP);
                let secretName = '';
                let secretVersion = '';

                if (match !== null) {
                    secretName = match[1];
                }
                else {
                    [secretName] = secretNameOrArn.split('-');
                }

                secretVersion = secretNameOrArn.substr(secretName.length + 1) || '*';

                if (SECRETS_MANAGER_ARN_REGEXP.test(secretNameOrArn)) {
                    return `${secretName}-${secretVersion}`;
                }
                else {
                    return `arn:${Aws.PARTITION}:secretsmanager:${Aws.REGION}:${Aws.ACCOUNT_ID}:secret:${secretName}-${secretVersion}`;
                }
            })
        });
    }
}
