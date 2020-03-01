import {IRepository, Repository} from '@aws-cdk/aws-codecommit';
import {BuildSpec, Project, Source} from '@aws-cdk/aws-codebuild';
import {Artifact, Pipeline} from '@aws-cdk/aws-codepipeline';
import {CodeBuildAction, CodeCommitSourceAction, CodeCommitTrigger} from '@aws-cdk/aws-codepipeline-actions';
import {Construct, Stack, Aws} from '@aws-cdk/core';
import {PipelineConfigs, isCodeBuildAction} from './PipelineConfig';
import {ManagerResources} from './SynthesisHandler';
import * as targets from '@aws-cdk/aws-events-targets';

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
                        const codePipelineProject = new Project(codePipeline, `${action.Name}Project`, {
                            projectName: `${action.Name}Project`,
                            buildSpec: action.BuildSpec.Inline !== undefined ? BuildSpec.fromObject(action.BuildSpec.Inline) : undefined,
                            source: action.SourceName !== undefined ? Source.codeCommit({
                                repository: repositories[ action.SourceName ]
                            }) : undefined
                        });

                        codePipelineStage.addAction(new CodeBuildAction({
                            actionName: action.Name,
                            input: artifacts.source,
                            project: codePipelineProject,
                            runOrder: action.Order
                        }));
                    }
                }
            }
        }
    }
}
