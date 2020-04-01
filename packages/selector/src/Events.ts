interface BaseDetail {
    executionsTableName: string;
    repositoryName: string;
    repositoryArn: string;
    pipelineName: string;
    pipelineArn: string;
    inputFiles: string;
    eventBusName: string;
}

export interface BaseEvent {
    source: string;
    detail: BaseDetail;
}

export interface CodeCommitEvent extends BaseEvent {
    source: 'aws.codecommit';

    detail: BaseDetail & {
        oldCommitId?: string;
        commitId: string;
        referenceType: string;
        referenceName: string;
    };
}

export interface CodePipelineEvent extends BaseEvent {
    source: 'aws.codepipeline';

    detail: BaseDetail & {
        executionId: string;
    };
}
