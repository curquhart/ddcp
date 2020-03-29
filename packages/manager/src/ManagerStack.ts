import {Aws, CfnParameter, Construct, Duration, Fn, Stack, StackProps} from '@aws-cdk/core';
import {Repository} from '@aws-cdk/aws-codecommit';
import {DISABLE_METADATA_STACK_TRACE} from '@aws-cdk/cx-api';
import {Artifact, Pipeline} from '@aws-cdk/aws-codepipeline';
import {CfnFunction, Code, Function, Runtime} from '@aws-cdk/aws-lambda';
import {Bucket} from '@aws-cdk/aws-s3';
import {
    CloudFormationCreateReplaceChangeSetAction,
    CloudFormationExecuteChangeSetAction,
    CodeCommitSourceAction,
    CodeCommitTrigger,
    LambdaInvokeAction,
    ManualApprovalAction,
    S3DeployAction
} from '@aws-cdk/aws-codepipeline-actions';
import * as fs from 'fs';
import {CfnPolicy, PolicyStatement} from '@aws-cdk/aws-iam';
import * as targets from '@aws-cdk/aws-events-targets';
import * as events from '@aws-cdk/aws-events';
import {CustomResource, CustomResourceProvider} from '@aws-cdk/aws-cloudformation';
import {LambdaInputArtifacts, LambdaModuleName, LambdaOutputArtifacts} from '@ddcp/module-collection';

const MANAGER_BRANCH = 'master';


export class ManagerStack extends Stack {
    constructor(scope?: Construct, id?: string, props?: StackProps) {
        super(scope, id, props);

        this.node.setContext(DISABLE_METADATA_STACK_TRACE, true);

        const sourceBucketNameParameter = new CfnParameter(this, 'SourceS3BucketName');
        const localStorageBucketNameParameter = new CfnParameter(this, 'LocalStorageS3BucketName');
        const sourceBucketPrefixParameter = new CfnParameter(this, 'SourceS3Prefix');
        const repositoryNameParameter = new CfnParameter(this, 'RepositoryName');
        const synthPipelineNameParameter = new CfnParameter(this, 'SynthPipelineName');
        const stackNameParameter = new CfnParameter(this, 'StackName');

        const pipelineName = synthPipelineNameParameter.valueAsString;
        const pipelineArn = `arn:aws:codepipeline:${Aws.REGION}:${Aws.ACCOUNT_ID}:${pipelineName}`;
        const stackUuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));
        const stackName = stackNameParameter.valueAsString;
        const changeSetName = `${stackName}-${stackUuid}`;

        const inputRepo = Repository.fromRepositoryName(this, 'Repo', repositoryNameParameter.valueAsString);

        const localBucket = Bucket.fromBucketName(this, 'S3Bucket', localStorageBucketNameParameter.valueAsString);

        const pipeline = new Pipeline(this, 'Pipeline', { pipelineName, artifactBucket: localBucket });

        const sourceBucket = Bucket.fromBucketName(this,'SourceBucket', sourceBucketNameParameter.valueAsString);

        // TODO: use custom event bus once https://github.com/aws-cloudformation/aws-cloudformation-coverage-roadmap/issues/44 is completed.
        const eventBus = events.EventBus.fromEventBusArn(this, 'CustomEventBus', `arn:aws:events:${Aws.REGION}:${Aws.ACCOUNT_ID}:event-bus/default`);
        new events.CfnEventBusPolicy(this, 'EventBusPolicy', {
            action: 'events:PutEvents',
            principal: Aws.ACCOUNT_ID,
            statementId: `ddcp-events-${stackUuid}`,
            eventBusName: eventBus.eventBusName
        });

        const s3resolver = new Function(this, 'S3Resolver', {
            runtime: Runtime.NODEJS_12_X,
            code: Code.fromInline(fs.readFileSync(`${__dirname}/../node_modules/@ddcp/s3-resolver/dist/bundled.js`).toString()),
            handler: 'index.handler',
            initialPolicy: [
                new PolicyStatement({
                    resources: Object.values(LambdaInputArtifacts).map((assetPath) => sourceBucket.arnForObjects(`${sourceBucketPrefixParameter.valueAsString}${assetPath.split('/').pop()}`)),
                    actions: [
                        's3:GetObject'
                    ],
                }),
                new PolicyStatement({
                    resources: [
                        localBucket.arnForObjects(`${stackUuid}/*`),
                    ],
                    actions: [
                        's3:PutObject',
                        's3:DeleteObject'
                    ],
                })
            ]
        });
        const s3resolverNode = s3resolver.node.defaultChild as CfnFunction;
        s3resolverNode.node.addInfo('cfn_nag disabled.');
        s3resolverNode
            .addOverride('Metadata', {
                'cfn_nag': {
                    'rules_to_suppress': [
                        {
                            id: 'W58',
                            reason: 'AWSLambdaBasicExecutionRole is applied which provides CloudWatch write.',
                        },
                    ]
                }
            });

        const lambdaOutputs = {} as LambdaOutputArtifacts;

        // Copy all required lambdas into local storage. (this in the future will be requester pays which is why we
        // don't just reference the source bucket directly.)
        Object.entries(LambdaInputArtifacts).forEach(([moduleName, assetPath]) => {
            const resolverCr = new CustomResource(this, `DDCP${moduleName}`, {
                provider: CustomResourceProvider.fromLambda(s3resolver),
                properties: {
                    SourceBucketName: sourceBucketNameParameter.valueAsString,
                    SourceKey: `${sourceBucketPrefixParameter.valueAsString}${assetPath.split('/').pop()}`,
                    DestBucketName: localBucket.bucketName,
                    StackUuid: stackUuid,
                },
            });
            lambdaOutputs[moduleName as LambdaModuleName] = resolverCr.getAtt('DestKey').toString();
        });

        const handlerFunction = new Function(this, 'DDCpMainHandler', {
            code: Code.fromBucket(localBucket, lambdaOutputs[LambdaModuleName.Synthesizer]),
            handler: 'dist/bundled.handler',
            runtime: Runtime.NODEJS_12_X,
            timeout: Duration.minutes(5),
            memorySize: 512,
            initialPolicy: [
                // Might want to deploy a single version of this lambda. Its events are constructed to support that,
                // but if doing so, we will need to * the resources.
                new PolicyStatement({
                    actions: ['codecommit:GetDifferences'],
                    resources: [inputRepo.repositoryArn],
                }),
                new PolicyStatement({
                    actions: ['codepipeline:StartPipelineExecution'],
                    resources: [pipelineArn],
                }),
                new PolicyStatement({
                    actions: ['events:PutEvents'],
                    resources: [eventBus.eventBusArn],
                }),
            ],
            environment: {
                // Due to a 1000 byte limit in the lambda configuration, this must be in an env var (more storage)
                // If/when it gets much bigger, will need to minify it in some manner, probably by just providing
                // a prefix.
                ASSET_KEYS: JSON.stringify(lambdaOutputs)
            }
        });
        const handlerFunctionNode = handlerFunction.node.defaultChild as CfnFunction;
        handlerFunctionNode.node.addInfo('cfn_nag disabled.');
        handlerFunctionNode
            .addOverride('Metadata', {
                'cfn_nag': {
                    'rules_to_suppress': [
                        {
                            id: 'W58',
                            reason: 'AWSLambdaBasicExecutionRole is applied which provides CloudWatch write.',
                        },
                    ]
                }
            });

        const handlerDefaultPolicy = handlerFunction?.role?.node.findChild('DefaultPolicy').node.findChild('Resource') as CfnPolicy;
        handlerDefaultPolicy.node.addInfo('cfn_nag disabled.');
        handlerDefaultPolicy
            .addOverride('Metadata', {
                'cfn_nag': {
                    'rules_to_suppress': [
                        {
                            id: 'W12',
                            reason: 'CodePipeline PutJobSuccessResult and PutJobFailureResult both require *.',
                        },
                    ]
                }
            });

        inputRepo.onCommit('EventRule', {
            target: new targets.LambdaFunction(handlerFunction, {
                event: events.RuleTargetInput.fromObject({
                    detail: {
                        oldCommitId: events.EventField.fromPath('$.detail.oldCommitId'),
                        commitId: events.EventField.fromPath('$.detail.commitId'),
                        repositoryName: inputRepo.repositoryName,
                        repositoryArn: inputRepo.repositoryArn,
                        pipelineName,
                        pipelineArn,
                        eventBusName: eventBus.eventBusName,
                        inputFile: 'pipeline-config.yaml'
                    },
                })
            }),
            branches: [MANAGER_BRANCH],
        });

        const sourceArtifact = new Artifact();
        const synthesizedPipeline = new Artifact('synthesized');

        pipeline.addStage({
            stageName: 'Source',
            actions: [
                new CodeCommitSourceAction({
                    actionName: 'Source',
                    repository: inputRepo,
                    output: sourceArtifact,
                    trigger: CodeCommitTrigger.NONE
                })
            ]
        });

        const synthAction = new LambdaInvokeAction({
            lambda: handlerFunction,
            actionName: 'SynthesizePipeline',
            inputs: [
                sourceArtifact
            ],
            outputs: [
                synthesizedPipeline,
            ],
            userParameters: {
                scratchDir: '/tmp/',
                scratchDirCleanup: true,
                synthPipeline: {
                    arn: pipelineArn,
                    sourceType: 'CodeCommit',
                    sourceBranch: MANAGER_BRANCH,
                    sourceRepoName: inputRepo.repositoryName,
                    eventBusArn: eventBus.eventBusArn,
                    assetBucketName: localStorageBucketNameParameter.valueAsString,
                }
            },
            runOrder: 1
        });

        const changeSetAction = new CloudFormationCreateReplaceChangeSetAction({
            actionName: 'CreateChangeSet',
            changeSetName,
            templatePath: synthesizedPipeline.atPath('template.json'),
            adminPermissions: true,
            stackName,
            runOrder: 2
        });

        // Use one fairly mega stage so that the change set is not updated out of turn if a new change comes in.
        pipeline.addStage({
            stageName: 'UpdatePipeline',
            actions: [
                synthAction,
                changeSetAction,
                new S3DeployAction({
                    actionName: 'DeployArtifacts',
                    objectKey: 'assets',
                    input: synthesizedPipeline,
                    bucket: localBucket,
                    runOrder: changeSetAction.actionProperties.runOrder,
                }),
                new ManualApprovalAction({
                    actionName: 'Approval',
                    additionalInformation: 'Changes to pipeline infrastructure require approval before executing.',
                    runOrder: 3,
                }),
                new CloudFormationExecuteChangeSetAction({
                    stackName,
                    actionName: 'ExecuteChangeSet',
                    changeSetName,
                    runOrder: 4,
                }),
            ]
        });

        const synthDefaultPolicy = pipeline.node.findChild('UpdatePipeline').node.findChild('SynthesizePipeline').node.findChild('CodePipelineActionRole').node.findChild('DefaultPolicy').node.findChild('Resource') as CfnPolicy;
        synthDefaultPolicy.node.addInfo('cfn_nag disabled.');
        synthDefaultPolicy
            .addOverride('Metadata', {
                'cfn_nag': {
                    'rules_to_suppress': [
                        {
                            id: 'W12',
                            reason: 'Lambda invoke action requires ListFunctions.',
                        },
                    ]
                }
            });

        // TODO: re-write the policy CodeBuild creates with one much more restrictive.
        const changeSetDefaultPolicy = changeSetAction.deploymentRole.node.findChild('DefaultPolicy').node.findChild('Resource') as CfnPolicy;
        changeSetDefaultPolicy.node.addWarning('cfn_nag disabled.');
        changeSetDefaultPolicy
            .addOverride('Metadata', {
                'cfn_nag': {
                    'rules_to_suppress': [
                        {
                            id: 'F4',
                            reason: 'DDCP is still under initial development and the specific requirements are not decided yet.',
                        },
                        {
                            id: 'F39',
                            reason: 'DDCP is still under initial development and the specific requirements are not decided yet.',
                        },
                        {
                            id: 'W12',
                            reason: 'DDCP is still under initial development and the specific requirements are not decided yet.',
                        },
                    ]
                }
            });
    }
}
