import {Aws, CfnOutput, CfnParameter, Construct, Duration, Fn, Stack, StackProps} from '@aws-cdk/core';
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
    ManualApprovalAction
} from '@aws-cdk/aws-codepipeline-actions';
import * as fs from 'fs';
import {CfnPolicy, PolicyStatement} from '@aws-cdk/aws-iam';
import * as targets from '@aws-cdk/aws-events-targets';
import * as events from '@aws-cdk/aws-events';
import {CustomResource, CustomResourceProvider} from '@aws-cdk/aws-cloudformation';
import {Topic} from '@aws-cdk/aws-sns';

export class ManagerStack extends Stack {
    constructor(scope?: Construct, id?: string, props?: StackProps) {
        super(scope, id, props);

        this.node.setContext(DISABLE_METADATA_STACK_TRACE, true);

        const sourceBucketNameParameter = new CfnParameter(this, 'SourceS3BucketName');
        const localStorageBucketNameParameter = new CfnParameter(this, 'LocalStorageS3BucketName');
        const sourceBucketKeyParameter = new CfnParameter(this, 'SourceS3Key');
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

        const buildStateSnsTopic = new Topic(this, 'CodeBuildEventsSnsTopic');

        new CfnOutput(this, 'CodeBuildEventsSnsTopicArn', {
            value: buildStateSnsTopic.topicArn,
        });

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
            code: Code.fromInline(fs.readFileSync(`${__dirname}/../node_modules/@ddcp/s3-resolver/dist/index.min.js`).toString()),
            handler: 'index.handler',
            initialPolicy: [
                new PolicyStatement({
                    resources: [ sourceBucket.arnForObjects(sourceBucketKeyParameter.valueAsString) ],
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

        const resolverCr = new CustomResource(this, 'ResolveSynthesizer', {
            provider: CustomResourceProvider.fromLambda(s3resolver),
            properties: {
                SourceBucketName: sourceBucketNameParameter.valueAsString,
                SourceKey: sourceBucketKeyParameter.valueAsString,
                DestBucketName: localBucket.bucketName,
                StackUuid: stackUuid,
            },
        });

        const handlerFunction = new Function(this, 'DDCpMainHandler', {
            code: Code.fromBucket(localBucket, resolverCr.getAtt('DestKey').toString()),
            handler: 'dist/index.handle',
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
            ]
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
            branches: ['master'],
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
                    buildStateSnsTopicArn: buildStateSnsTopic.topicArn,
                    sourceType: 'CodeCommit',
                    sourceRepoName: inputRepo.repositoryName,
                    eventBusArn: eventBus.eventBusArn,
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


        pipeline.addStage({
            stageName: 'PreparePipeline',
            actions: [
                synthAction,
                changeSetAction
            ]
        });

        const synthDefaultPolicy = pipeline.node.findChild('PreparePipeline').node.findChild('SynthesizePipeline').node.findChild('CodePipelineActionRole').node.findChild('DefaultPolicy').node.findChild('Resource') as CfnPolicy;
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

        pipeline.addStage({
            stageName: 'ApprovePipeline',
            actions: [
                new ManualApprovalAction({
                    actionName: 'Approval'
                }),
            ]
        });

        pipeline.addStage({
            stageName: 'UpdatePipeline',
            actions: [
                new CloudFormationExecuteChangeSetAction({
                    stackName,
                    actionName: 'ExecuteChangeSet',
                    changeSetName
                })
            ]
        });
    }
}
