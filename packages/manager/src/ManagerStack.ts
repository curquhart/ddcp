import {Aws, CfnParameter, Construct, Duration, Fn, RemovalPolicy, Stack, StackProps} from '@aws-cdk/core';
import {Repository} from '@aws-cdk/aws-codecommit';
import {DISABLE_METADATA_STACK_TRACE} from '@aws-cdk/cx-api';
import * as codepipeline from '@aws-cdk/aws-codepipeline';
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
import {CfnPolicy, PolicyStatement} from '@aws-cdk/aws-iam';
import * as targets from '@aws-cdk/aws-events-targets';
import * as events from '@aws-cdk/aws-events';
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import {throwError} from '@ddcp/errorhandling';
import {LambdaInputArtifacts} from '@ddcp/module-collection';
import {ManagerResources} from '@ddcp/models';

export class ManagerStack extends Stack {
    constructor(scope?: Construct, id?: string, props?: StackProps) {
        super(scope, id, props);

        this.node.setContext(DISABLE_METADATA_STACK_TRACE, true);

        const managerLambdaBucketName = process.env.MANAGER_LAMBDA_DIST_BUCKET_NAME ?? throwError(new Error('MANAGER_LAMBDA_DIST_BUCKET_NAME is required.'));
        const lambdaBucketName = process.env.LAMBDA_DIST_BUCKET_NAME ?? throwError(new Error('LAMBDA_DIST_BUCKET_NAME is required.'));
        const buildVersion = process.env.BUILD_VERSION ?? throwError(new Error('BUILD_VERSION is required.'));

        this.addTransform('AWS::Serverless-2016-10-31');
        this.templateOptions.metadata = {
            'AWS::ServerlessRepo::Application': {
                Name: 'ddcp',
                Description: 'Data driven CodePipeline synthesizer.',
                Author: 'Chelsea Urquhart',
                SpdxLicenseId: 'MIT',
                LicenseUrl: 'LICENSE',
                ReadmeUrl: 'README.md',
                HomePageUrl: 'https://github.com/curquhart/ddcp',
                SemanticVersion: buildVersion,
                SourceCodeUrl: 'https://github.com/curquhart/ddcp',
            }
        };

        const localStorageBucketNameParameter = new CfnParameter(this, 'LocalStorageS3BucketName');
        const repositoryNameParameter = new CfnParameter(this, 'RepositoryName');
        const synthPipelineNameParameter = new CfnParameter(this, 'SynthPipelineName');
        const stackNameParameter = new CfnParameter(this, 'StackName');
        const managerBranchNameParameter = new CfnParameter(this, 'ManagerBranchName', {
            default: 'main'
        });

        const pipelineName = synthPipelineNameParameter.valueAsString;
        const pipelineArn = `arn:aws:codepipeline:${Aws.REGION}:${Aws.ACCOUNT_ID}:${pipelineName}`;
        const stackUuid = Fn.select(2, Fn.split('/', Aws.STACK_ID));
        const stackName = stackNameParameter.valueAsString;
        const changeSetName = `${stackName}-${stackUuid}`;

        const inputRepo = Repository.fromRepositoryName(this, 'Repo', repositoryNameParameter.valueAsString);

        const localBucket = Bucket.fromBucketName(this, 'S3Bucket', localStorageBucketNameParameter.valueAsString);

        const pipeline = new codepipeline.Pipeline(this, 'Pipeline', { pipelineName, artifactBucket: localBucket });

        const sourceBucket = Bucket.fromBucketName(this,'SourceBucket', managerLambdaBucketName);

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
            code: Code.fromBucket(sourceBucket, `${buildVersion}/@ddcps3-resolver.zip`),
            handler: 'dist/bundled.handler',
            initialPolicy: [
                new PolicyStatement({
                    resources: Object.values(LambdaInputArtifacts).map((assetPath) => sourceBucket.arnForObjects(`${buildVersion}/${assetPath.split('/').pop()}`)),
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

        const executionsTable = new dynamodb.Table(this, 'ExecutionsTable', {
            partitionKey: {
                name: 'executionId',
                type: dynamodb.AttributeType.STRING
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: RemovalPolicy.DESTROY,
            timeToLiveAttribute: 'expiryTimestamp',
        });

        const selectorHandlerFunction = new Function(this, 'DDCpSelectorHandler', {
            code: Code.fromBucket(sourceBucket, `${buildVersion}/@ddcpselector.zip`),
            handler: 'dist/bundled.handler',
            runtime: Runtime.NODEJS_12_X,
            timeout: Duration.seconds(5),
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
                new PolicyStatement({
                    actions: [
                        'dynamodb:PutItem',
                        'dynamodb:GetItem',
                    ],
                    resources: [executionsTable.tableArn],
                }),
            ],
        });
        const selectorHandlerFunctionNode = selectorHandlerFunction.node.defaultChild as CfnFunction;
        selectorHandlerFunctionNode.node.addInfo('cfn_nag disabled.');
        selectorHandlerFunctionNode
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

        pipeline.onStateChange('PipelineStateChange', {
            target: new targets.LambdaFunction(selectorHandlerFunction, {
                event: events.RuleTargetInput.fromObject({
                    source: events.EventField.fromPath('$.source'),
                    detail: {
                        executionId: events.EventField.fromPath('$.detail.execution-id'),
                        repositoryName: inputRepo.repositoryName,
                        repositoryArn: inputRepo.repositoryArn,
                        pipelineName,
                        pipelineArn,
                        eventBusName: eventBus.eventBusName,
                        executionsTableName: executionsTable.tableName,
                        inputFiles: ['pipeline-config.yaml']
                    },
                })
            }),
            eventPattern: {
                detail: {
                    state: ['SUCCEEDED']
                }
            }
        });
        inputRepo.onCommit('EventRule', {
            target: new targets.LambdaFunction(selectorHandlerFunction, {
                event: events.RuleTargetInput.fromObject({
                    source: events.EventField.fromPath('$.source'),
                    detail: {
                        oldCommitId: events.EventField.fromPath('$.detail.oldCommitId'),
                        commitId: events.EventField.fromPath('$.detail.commitId'),
                        referenceType: events.EventField.fromPath('$.detail.referenceType'),
                        referenceName: events.EventField.fromPath('$.detail.referenceName'),
                        repositoryName: inputRepo.repositoryName,
                        repositoryArn: inputRepo.repositoryArn,
                        pipelineName,
                        pipelineArn,
                        eventBusName: eventBus.eventBusName,
                        executionsTableName: executionsTable.tableName,
                        inputFiles: ['pipeline-config.yaml']
                    },
                })
            }),
            branches: [managerBranchNameParameter.valueAsString],
        });

        const sourceArtifact = new codepipeline.Artifact();
        const synthesizedPipeline = new codepipeline.Artifact('synthesized');

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

        const synthHandlerFunction = new Function(this, 'DDCpSynthHandler', {
            code: Code.fromBucket(sourceBucket, `${buildVersion}/@ddcpsynthesizer.zip`),
            handler: 'dist/bundled.handler',
            runtime: Runtime.NODEJS_12_X,
            timeout: Duration.minutes(5),
            memorySize: 512,
            environment: {
                LAMBDA_DIST_BUCKET_NAME: lambdaBucketName,
                BUILD_VERSION: buildVersion,
            }
        });
        const synthHandlerFunctionNode = synthHandlerFunction.node.defaultChild as CfnFunction;
        synthHandlerFunctionNode.node.addInfo('cfn_nag disabled.');
        synthHandlerFunctionNode
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

        const managerResources: ManagerResources = {
            arn: pipelineArn,
            sourceType: 'CodeCommit',
            sourceBranch: managerBranchNameParameter.valueAsString,
            sourceRepoName: inputRepo.repositoryName,
            eventBusArn: eventBus.eventBusArn,
            assetBucketName: localStorageBucketNameParameter.valueAsString,
            s3resolverArn: s3resolver.functionArn,
            stackUuid,
        };

        const synthAction = new LambdaInvokeAction({
            lambda: synthHandlerFunction,
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
                synthPipeline: managerResources,
            },
            runOrder: 1
        });
        const originalBind = synthAction.bind.bind(synthAction);
        synthAction.bind = (scope: Construct, stage: codepipeline.IStage, options: codepipeline.ActionBindOptions): codepipeline.ActionConfig => {
            const res = originalBind(scope, stage, options);

            // policy is not created until synthesis, so we have to delay adding our lint exclusion.
            const synthHandlerDefaultPolicy = synthHandlerFunction.role?.node.findChild('DefaultPolicy').node.findChild('Resource') as CfnPolicy;
            synthHandlerDefaultPolicy.node.addInfo('cfn_nag disabled.');
            synthHandlerDefaultPolicy
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

            return res;
        };

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
