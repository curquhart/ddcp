process.env.BUILD_VERSION ='0.0.0-test';
process.env.LAMBDA_DIST_BUCKET_NAME ='lambda-dist';

import {initFunctionCache} from '../helpers';
import {SynthesisStack} from '../SynthesisStack';
import {App} from '@aws-cdk/core';
import {Resolver} from '../Resolver';
import {Uniquifier} from '../Uniquifier';
import {GitSourceSync} from '../builders/GitSourceSync';
import {Tokenizer} from '@ddcp/tokenizer';
import * as tmp from 'tmp';
import * as fs from 'fs';
import {ManagerResources} from '@ddcp/models';
import {CounterResourceFactory} from '../resource/CounterResourceFactory';
import {CodePipelineOrchestratorFactory} from '../orchestrator/CodePipelineOrchestratorFactory';
import {Path} from '../fn/resolvers/Path';
import {PathForAlias} from '../fn/resolvers/PathForAlias';

const MANAGER_RESOURCES: ManagerResources = {
    arn: 'arn:aws:codepipeline:us-east-1:111111111111:synthesizer',
    sourceBranch: 'master',
    sourceType: 'CodeCommit',
    sourceRepoName: 'foo',
    eventBusArn: 'arn:aws:events:us-east-1:111111111111:event-bus/default',
    assetBucketName: 'bar',
    stackUuid: '1111',
    s3resolverArn: 'arn:xxxx',
};

describe('SynthesisStack test', () => {
    let tmpDir: tmp.DirResult;

    beforeEach(() => {
        tmpDir = tmp.dirSync({
            unsafeCleanup: true
        });
    });

    afterEach(() => {
        tmpDir.removeCallback();
    });

    it('empty JSON object input results in an empty JSON output', async () => {
        const app = new App({
            outdir: tmpDir.name,
        });

        const resolvers = {};
        const resolver = new Resolver(resolvers, 'NA');
        const uniquifier = new Uniquifier();
        const tokenizer = new Tokenizer();
        const gitSourceBuilder = new GitSourceSync();

        const stackId = 'stack';
        const stack = new SynthesisStack(app, stackId, {
            managerResources: MANAGER_RESOURCES,
            resolver: resolver,
            unresolvedPipelineConfig: {},
            orchestratorFactories: {},
            resourceFactories: {},
            uniquifier,
            tokenizer,
            artifactStore: {},
            gitSourceBuilder,
            functionCache: initFunctionCache(),
        });

        await stack.init();

        const synth = app.synth();
        expect(synth.getStackArtifact(stackId).template).toEqual({});
    });

    it('builds pipeline with counter increment appropriately', async () => {
        const app = new App({
            outdir: tmpDir.name,
        });

        const resolvers = {};
        const resourceFactories = {};

        new Path(resolvers, resourceFactories).init();
        new PathForAlias(resolvers).init();

        const resolver = new Resolver(resolvers, 'NA');
        const uniquifier = new Uniquifier();
        const tokenizer = new Tokenizer();
        const gitSourceBuilder = new GitSourceSync();
        new CounterResourceFactory(resourceFactories, uniquifier).init();
        const orchestrators = {};
        new CodePipelineOrchestratorFactory(orchestrators).init();

        const stackId = 'stack';
        const stack = new SynthesisStack(app, stackId, {
            managerResources: MANAGER_RESOURCES,
            resolver: resolver,
            unresolvedPipelineConfig: {
                Resources: [
                    {
                        Type: 'Counter',
                        Name: 'TestCounter',
                    }
                ],
                Pipelines: [
                    {
                        Name: 'foo',
                        Sources: [
                            {
                                Name: 'Source',
                                Type: 'Git',
                                Uri: 'git@github.com:foo/bar.git',
                                Trigger: 'GitHubWebHook',
                                RepositoryName: 'baz',
                                BranchName: 'foobar',
                            }
                        ],
                        Stages: [
                            {
                                Name: 'CounterIncrementStage',
                                Actions: [
                                    {
                                        Name: 'CounterIncrementAction',
                                        Type: 'Counter',
                                        Counter: {
                                            '!Path': [
                                                'Resources',
                                                0
                                            ]
                                        },
                                        Operation: 'IncrementAndGet',
                                        Order: 1,
                                        OutputArtifactName: 'Number'
                                    }
                                ]
                            }
                        ]
                    }
                ]
            },
            orchestratorFactories: orchestrators,
            resourceFactories: resourceFactories,
            uniquifier,
            tokenizer,
            artifactStore: {},
            gitSourceBuilder,
            functionCache: initFunctionCache(),
        });

        await stack.init();

        const synth = app.synth();
        expect(synth.getStackArtifact(stackId).template).toEqual(
            JSON.parse(fs.readFileSync(`${__dirname}/../__fixtures__/SynthesisStackTest/PipelineWithCounter.json`).toString())
        );
    });

    it('synthesizes with CodeBuild defaults', async () => {
        const app = new App({
            outdir: tmpDir.name,
        });

        const resolvers = {};
        const resourceFactories = {};

        new Path(resolvers, resourceFactories).init();
        new PathForAlias(resolvers).init();

        const resolver = new Resolver(resolvers, 'NA');
        const uniquifier = new Uniquifier();
        const tokenizer = new Tokenizer();
        const gitSourceBuilder = new GitSourceSync();
        new CounterResourceFactory(resourceFactories, uniquifier).init();
        const orchestrators = {};
        new CodePipelineOrchestratorFactory(orchestrators).init();

        const stackId = 'stack';
        const stack = new SynthesisStack(app, stackId, {
            managerResources: MANAGER_RESOURCES,
            resolver: resolver,
            unresolvedPipelineConfig: {
                Pipelines: [
                    {
                        Name: 'foo',
                        Sources: [
                            {
                                Name: 'Source',
                                Type: 'Git',
                                Uri: 'git@github.com:foo/bar.git',
                                Trigger: 'GitHubWebHook',
                                RepositoryName: 'baz',
                                BranchName: 'foobar',
                            }
                        ],
                        Stages: [
                            {
                                Name: 'BuildStage',
                                Actions: [
                                    {
                                        Name: 'BuildAction',
                                        Type: 'CodeBuild',
                                        SourceName: 'Source',
                                        BuildSpec: {
                                            Inline: {},
                                        },
                                    }
                                ]
                            }
                        ]
                    }
                ]
            },
            orchestratorFactories: orchestrators,
            resourceFactories: resourceFactories,
            uniquifier,
            tokenizer,
            artifactStore: {},
            gitSourceBuilder,
            functionCache: initFunctionCache(),
        });

        await stack.init();

        const synth = app.synth();
        expect(synth.getStackArtifact(stackId).template).toEqual(
            JSON.parse(fs.readFileSync(`${__dirname}/../__fixtures__/SynthesisStackTest/PipelineWithCodeBuildDefaults.json`).toString())
        );
    });

    it('synthesizes with CodeBuild overrides', async () => {
        const app = new App({
            outdir: tmpDir.name,
        });

        const resolvers = {};
        const resourceFactories = {};

        new Path(resolvers, resourceFactories).init();
        new PathForAlias(resolvers).init();

        const resolver = new Resolver(resolvers, 'NA');
        const uniquifier = new Uniquifier();
        const tokenizer = new Tokenizer();
        const gitSourceBuilder = new GitSourceSync();
        new CounterResourceFactory(resourceFactories, uniquifier).init();
        const orchestrators = {};
        new CodePipelineOrchestratorFactory(orchestrators).init();

        const stackId = 'stack';
        const stack = new SynthesisStack(app, stackId, {
            managerResources: MANAGER_RESOURCES,
            resolver: resolver,
            unresolvedPipelineConfig: {
                Pipelines: [
                    {
                        Name: 'foo',
                        Sources: [
                            {
                                Name: 'Source',
                                Type: 'Git',
                                Uri: 'git@github.com:foo/bar.git',
                                Trigger: 'GitHubWebHook',
                                RepositoryName: 'baz',
                                BranchName: 'foobar',
                            }
                        ],
                        Stages: [
                            {
                                Name: 'BuildStage',
                                Actions: [
                                    {
                                        Name: 'BuildAction',
                                        Type: 'CodeBuild',
                                        SourceName: 'Source',
                                        ComputeType: 'BUILD_GENERAL1_LARGE',
                                        EnableBadge: true,
                                        BuildImage: 'aws/codebuild/standard:2.0',
                                        PrivilegedMode: true,
                                        BuildSpec: {
                                            Inline: {},
                                        },
                                    }
                                ]
                            }
                        ]
                    }
                ]
            },
            orchestratorFactories: orchestrators,
            resourceFactories: resourceFactories,
            uniquifier,
            tokenizer,
            artifactStore: {},
            gitSourceBuilder,
            functionCache: initFunctionCache(),
        });

        await stack.init();

        const synth = app.synth();
        expect(synth.getStackArtifact(stackId).template).toEqual(
            JSON.parse(fs.readFileSync(`${__dirname}/../__fixtures__/SynthesisStackTest/PipelineWithCodeBuildOverrides.json`).toString())
        );
    });

    it('synthesizes with Lambda invoke action', async () => {
        const app = new App({
            outdir: tmpDir.name,
        });

        const resolvers = {};
        const resourceFactories = {};

        new Path(resolvers, resourceFactories).init();
        new PathForAlias(resolvers).init();

        const resolver = new Resolver(resolvers, 'NA');
        const uniquifier = new Uniquifier();
        const tokenizer = new Tokenizer();
        const gitSourceBuilder = new GitSourceSync();
        new CounterResourceFactory(resourceFactories, uniquifier).init();
        const orchestrators = {};
        new CodePipelineOrchestratorFactory(orchestrators).init();

        const stackId = 'stack';
        const stack = new SynthesisStack(app, stackId, {
            managerResources: MANAGER_RESOURCES,
            resolver: resolver,
            unresolvedPipelineConfig: {
                Pipelines: [
                    {
                        Name: 'foo',
                        Sources: [
                            {
                                Name: 'Source',
                                Type: 'Git',
                                Uri: 'git@github.com:foo/bar.git',
                                Trigger: 'GitHubWebHook',
                                RepositoryName: 'baz',
                                BranchName: 'foobar',
                            }
                        ],
                        Stages: [
                            {
                                Name: 'BuildStage',
                                Actions: [
                                    {
                                        Name: 'BuildAction',
                                        Type: 'LambdaInvoke',
                                        SourceName: 'Source',
                                        FunctionArn: 'arn:xxxxx',
                                        Parameters: {
                                            foo: 'bar'
                                        },
                                    }
                                ]
                            }
                        ]
                    }
                ]
            },
            orchestratorFactories: orchestrators,
            resourceFactories: resourceFactories,
            uniquifier,
            tokenizer,
            artifactStore: {},
            gitSourceBuilder,
            functionCache: initFunctionCache(),
        });

        await stack.init();

        const synth = app.synth();
        expect(synth.getStackArtifact(stackId).template).toEqual(
            JSON.parse(fs.readFileSync(`${__dirname}/../__fixtures__/SynthesisStackTest/PipelineWithLambdaInvoke.json`).toString())
        );
    });
});
