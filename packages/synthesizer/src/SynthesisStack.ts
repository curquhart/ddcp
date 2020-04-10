import {IRepository, Repository} from '@aws-cdk/aws-codecommit';
import {Effect, PolicyStatement, ServicePrincipal} from '@aws-cdk/aws-iam';
import {
    BuildEnvironmentVariableType,
    BuildSpec,
    CfnProject,
    ComputeType,
    LinuxBuildImage,
    Project,
    Source
} from '@aws-cdk/aws-codebuild';
import {Pipeline} from '@aws-cdk/aws-codepipeline';
import {Aws, Construct, Duration, Fn, Stack} from '@aws-cdk/core';
import {
    CodeBuildEnvVar,
    CodeBuildPayload,
    isCodeBuildAction,
    isCounterAction,
    isS3PublishAction,
    isLambdaInvokeAction,
    PipelineConfigs,
    SourceType
} from '@ddcp/models';
import {ManagerResources} from './SynthesisHandler';
import * as events from '@aws-cdk/aws-events';
import * as kms from '@aws-cdk/aws-kms';
import * as targets from '@aws-cdk/aws-events-targets';
import {throwError} from '@ddcp/errorhandling';
import {Topic} from '@aws-cdk/aws-sns';
import {Resolver} from './Resolver';
import {Function, LayerVersion} from '@aws-cdk/aws-lambda';
import {SnsEventSource} from '@aws-cdk/aws-lambda-event-sources';
import {BaseOrchestratorFactory} from './orchestrator/BaseOrchestratorFactory';
import {Uniquifier} from './Uniquifier';
import {Tokenizer} from '@ddcp/tokenizer';
import {tOrDefault} from '@ddcp/typehelpers';
import {BaseResourceFactory} from './resource/BaseResourceFactory';
import {GitSourceSync} from './builders/GitSourceSync';
import {getFunction} from './helpers';
import {LambdaModuleName} from '@ddcp/module-collection';
import * as Ajv from 'ajv';
const SECRETS_MANAGER_ARN_REGEXP = /^(arn:[^:]+:secretsmanager:[^:]+:[^:]+:secret:[^:-]+).*$/;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pipelinesSchema = require('@ddcp/models/dist/PipelineConfigs.schema.json');

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

        // validate schema.
        const ajv = new Ajv();
        if (!ajv.validate(pipelinesSchema, pipelineConfig)) {
            throw new Error(`Validation error(s): ${ajv.errorsText()}. Resolved configuration: ${JSON.stringify(pipelineConfig)}`);
        }

        const codePipelineSynthPipeline = Pipeline.fromPipelineArn(this, 'SynthPipeline', props.managerResources.arn);
        const functionCache: Record<string, Function> = {};

        // create resources
        for (const resource of tOrDefault(pipelineConfig.Resources, [])) {
            const factory = props.resourceFactories[resource.Type ?? throwError(new Error('Resource Type is required.'))] ?? throwError(new Error(`Unknown resource type: ${resource.Type}`));
            factory.new(resource).constructCdk(this, props.managerResources);
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
                uniquifier: props.uniquifier,
                functionCache,
            });

            const slackSettings = pipeline.Notifications?.Slack !== undefined && pipeline.Notifications?.Slack.length > 0 ? pipeline.Notifications?.Slack : undefined;
            const githubSettings = pipeline.GitHub;

            const needsSnsTopic = slackSettings !== undefined || githubSettings !== undefined;
            const topicName = props.uniquifier.next(`ddcp-events-${pipeline.Name}-${Fn.select(2, Fn.split('/', Aws.STACK_ID))}`);
            const snsKey = needsSnsTopic ? new kms.Key(this, props.uniquifier.next(`${pipeline.Name}SnsKey`), {
                alias: `alias/${topicName}-key`
            }): undefined;
            const snsTopic = needsSnsTopic ? new Topic(this, props.uniquifier.next('Sns'), {
                masterKey: snsKey,
                topicName: topicName
            }) : undefined;
            if (snsTopic !== undefined) {
                snsTopic.addToResourcePolicy(new PolicyStatement({
                    actions: ['sns:Publish'],
                    principals: [new ServicePrincipal('events')],
                    resources: [snsTopic.topicArn]
                }));
                snsKey?.grant(new ServicePrincipal('events'), 'kms:GenerateDataKey', 'kms:Decrypt');
            }

            if (snsTopic !== undefined && slackSettings !== undefined) {
                const handler = getFunction({
                    scope: this,
                    functionCache,
                    managerResources: props.managerResources,
                    moduleName: LambdaModuleName.SnsToSlack,
                });
                this.applySecretsManagerPolicyToFunction(handler, props.tokenizer, slackSettings);
                handler.addEventSource(new SnsEventSource(snsTopic));
            }

            if (snsTopic !== undefined && githubSettings !== undefined) {
                const handler = getFunction({
                    scope: this,
                    functionCache,
                    managerResources: props.managerResources,
                    moduleName: LambdaModuleName.SnsToGitHub,
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
                    const mirrorFn = getFunction({
                        scope: this,
                        functionCache,
                        managerResources: props.managerResources,
                        moduleName: LambdaModuleName.GitHubMirror,
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

            for (const stage of pipeline.Stages) {
                if (stage.Name === undefined) {
                    throw new Error('Name is required.');
                }

                const orchestratedStage = orchestratedPipeline.addStage(stage.Name);

                for (const action of stage.Actions as Array<{Type: string}>) {
                    if (isCodeBuildAction(action)) {
                        const buildSpec = action.BuildSpec.Inline ?? throwError(new Error('BuildSpec.Inline is required.'));

                        const sourceName = action.SourceName ?? throwError(new Error('SourceName cannot be null.'));
                        const repository = repositories[ sourceName ];
                        const branchName = branchNames[ sourceName ];
                        if (branchName === undefined) {
                            throw new Error('BranchName cannot be undefined.');
                        }

                        const codeBuildProjectName = `${pipeline.Name}${stage.Name}${action.Name}Project`;
                        const codeBuildProject = new Project(this, props.uniquifier.next(`${pipeline.Name}${stage.Name}${action.Name}Project`), {
                            projectName: codeBuildProjectName,
                            buildSpec: BuildSpec.fromObject(buildSpec),
                            source: Source.codeCommit({
                                repository,
                                branchOrRef: branchName ?? undefined,
                            }),
                            badge: action.EnableBadge,
                            environment: {
                                buildImage: action.BuildImage !== undefined ? LinuxBuildImage.fromDockerRegistry(action.BuildImage) : LinuxBuildImage.STANDARD_3_0,
                                computeType: action.ComputeType as ComputeType | undefined,
                                privileged: action.PrivilegedMode,
                                environmentVariables: {
                                    DDCP_PIPELINE_NAME: {
                                        type: BuildEnvironmentVariableType.PLAINTEXT,
                                        value: pipeline.Name,
                                    },
                                    DDCP_STAGE_NAME: {
                                        type: BuildEnvironmentVariableType.PLAINTEXT,
                                        value: stage.Name,
                                    },
                                    DDCP_ACTION_NAME: {
                                        type: BuildEnvironmentVariableType.PLAINTEXT,
                                        value: action.Name,
                                    },
                                }
                            },
                        });
                        if (action.BuildImage?.startsWith('aws/') === true) {
                            const cfnProject = codeBuildProject.node.defaultChild as CfnProject;
                            // Default to CODEBUILD
                            cfnProject.addOverride('Properties.Environment.ImagePullCredentialsType', undefined);
                        }

                        for (const reportName of Object.keys(tOrDefault(buildSpec.reports, {}))) {
                            codeBuildProject.addToRolePolicy(new PolicyStatement({
                                actions: [
                                    'codebuild:CreateReportGroup',
                                    'codebuild:CreateReport',
                                    'codebuild:BatchPutTestCases',
                                    'codebuild:UpdateReport',
                                ],
                                resources: [
                                    `arn:aws:codebuild:${Aws.REGION}:${Aws.ACCOUNT_ID}:report-group/${codeBuildProjectName}-${reportName}`
                                ]
                            }));
                        }

                        for (const policy of action.Policies ?? []) {
                            codeBuildProject.addToRolePolicy(new PolicyStatement({
                                effect: policy.Effect as Effect | undefined,
                                principals: policy.ServicePrincipals?.map((principal) => new ServicePrincipal(principal)),
                                actions: policy.Actions,
                                resources: policy.Resources,
                            }));
                        }

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
                                        buildEnvironment: events.EventField.fromPath('$.detail.additional-information.environment.environment-variables') as unknown as Array<CodeBuildEnvVar>,
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
                                    } as CodeBuildPayload)
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
                        const lambda = getFunction({
                            scope: this,
                            functionCache,
                            managerResources: props.managerResources,
                            moduleName: LambdaModuleName.ActionCounter,
                        });

                        orchestratedStage.addCounterAction({
                            action,
                            lambda,
                            counter: props.resourceFactories.Counter.new(action.Counter),
                        });
                    }
                    else if (isLambdaInvokeAction(action)) {
                        const lambda = Function.fromFunctionArn(this, props.uniquifier.next('LambdaVirtual'), action.FunctionArn);

                        orchestratedStage.addLambdaInvokeAction({
                            action,
                            lambda,
                        });
                    }
                    else {
                        throw new Error(`Unknown action type: ${action.Type}`);
                    }
                }
            }
        }
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
