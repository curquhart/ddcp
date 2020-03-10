import {Construct} from '@aws-cdk/core';
import {CodeBuildAction, Pipeline, S3PublishAction} from '../PipelineConfig';
import {IPipeline} from '@aws-cdk/aws-codepipeline';
import {ManagerResources} from '../SynthesisHandler';
import {Project} from '@aws-cdk/aws-codebuild';
import {Counter} from '../Counter';

export interface CodeBuildActionProps {
    action: CodeBuildAction;
    project: Project;
}

export interface S3PublishProps {
    action: S3PublishAction;
}

export interface Stage {
    addCodeCommitSourceAction(actionName: string, repositoryName: string, repositoryBranch?: string): void;
    addCodeBuildAction(props: CodeBuildActionProps): void;
    addS3PublishAction(props: S3PublishProps): void;
}

export interface Orchestrator {
    addStage(stageName: string): Stage;
    addSources(): void;
}

export interface OrchestratorProps {
    scope: Construct;
    managerPipeline: IPipeline;
    managerResources: ManagerResources;
    pipeline: Pipeline;
    counter: Counter;
}

export abstract class BaseOrchestratorFactory {
    protected constructor(private readonly orchestrators: Record<string, BaseOrchestratorFactory>) {
    }

    init(): this {
        this.orchestrators[this.name] = this;
        return this;
    }

    abstract readonly name: string;

    abstract new(props: OrchestratorProps): Orchestrator;
}
