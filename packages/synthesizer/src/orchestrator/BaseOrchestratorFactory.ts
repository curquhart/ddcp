import {Construct} from '@aws-cdk/core';
import {CodeBuildAction, CounterAction, Pipeline, S3PublishAction} from '../PipelineConfig';
import {IPipeline} from '@aws-cdk/aws-codepipeline';
import {ManagerResources} from '../SynthesisHandler';
import {Project} from '@aws-cdk/aws-codebuild';
import {Uniquifier} from '../Uniquifier';
import {IFunction} from '@aws-cdk/aws-lambda';
import {BaseResource} from '../resource/BaseResourceFactory';

export interface CodeBuildActionProps {
    action: CodeBuildAction;
    project: Project;
}

export interface S3PublishActionProps {
    action: S3PublishAction;
}

export interface CounterActionProps {
    action: CounterAction;
    lambda: IFunction;
    counter: BaseResource;
}

export interface BranchOptions {
    BranchName?: string;
    BranchPattern?: string;
}

export interface Stage {
    addCodeCommitSourceAction(actionName: string, repositoryName: string, repositoryBranch: BranchOptions): void;
    addCodeBuildAction(props: CodeBuildActionProps): void;
    addS3PublishAction(props: S3PublishActionProps): void;
    addCounterAction(props: CounterActionProps): void;
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
    uniquifier: Uniquifier;
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
