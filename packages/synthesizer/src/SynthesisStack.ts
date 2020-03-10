import {IRepository} from '@aws-cdk/aws-codecommit';
import {BuildSpec, Project, Source} from '@aws-cdk/aws-codebuild';
import {Pipeline} from '@aws-cdk/aws-codepipeline';
import {Construct, Stack} from '@aws-cdk/core';
import {isCodeBuildAction, isS3PublishAction, PipelineConfigs} from './PipelineConfig';
import {ManagerResources} from './SynthesisHandler';
import {throwError} from './helpers';
import {BaseOrchestratorFactory} from './orchestrator/BaseOrchestratorFactory';
import {Counter} from './Counter';

export const tOrDefault = <T>(input: T | undefined, defaultValue: T): T => {
    return input !== undefined ? input : defaultValue;
};

export class SynthesisStack extends Stack {
    constructor(
        scope: Construct,
        id: string,
        managerResources: ManagerResources,
        pipelineConfig: PipelineConfigs,
        orchestrators: Record<string, BaseOrchestratorFactory>,
        counter: Counter
    ) {
        super(scope, id);

        const managerPipeline = Pipeline.fromPipelineArn(this, 'SynthPipeline', managerResources.arn);

        for (const pipeline of tOrDefault(pipelineConfig.Pipelines, [])) {
            const repositories: Record<string, IRepository> = {};

            if (orchestrators[pipeline.Orchestrator] === undefined) {
                throw new Error(`Invalid orchestrator: ${pipeline.Orchestrator}`);
            }

            const orchestrator = orchestrators[pipeline.Orchestrator].new({
                scope: this,
                counter,
                managerPipeline,
                managerResources,
                pipeline,
            });
            orchestrator.addSources();

            for (const stage of tOrDefault(pipeline.Stages, [])) {
                if (stage.Name === undefined) {
                    throw new Error('Name is required.');
                }

                const codePipelineStage = orchestrator.addStage(stage.Name);

                for (const action of tOrDefault(stage.Actions, [])) {
                    if (action.Name === undefined) {
                        throw new Error('Name is required.');
                    }
                    if (isCodeBuildAction(action)) {
                        const buildSpec = action.BuildSpec !== undefined && action.BuildSpec.Inline !== undefined ?
                            action.BuildSpec.Inline :
                            throwError(new Error('BuildSpec.Inline is required.'));

                        const codePipelineProject = new Project(this, `${action.Name}Project${counter.next}`, {
                            projectName: `${pipeline.Name}-${stage.Name}-${action.Name}-Project`,
                            buildSpec: BuildSpec.fromObject(buildSpec),
                            source: action.SourceName !== undefined ? Source.codeCommit({
                                repository: repositories[ action.SourceName ]
                            }) : undefined
                        });

                        codePipelineStage.addCodeBuildAction({
                            action,
                            project: codePipelineProject,
                        });
                    }
                    else if (isS3PublishAction(action)) {
                        codePipelineStage.addS3PublishAction({
                            action,
                        });
                    }
                }
            }
        }
    }
}
