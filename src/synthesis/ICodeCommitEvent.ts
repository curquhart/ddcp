export interface ICodeCommitEvent {
    detail: {
        repositoryName: string;
        repositoryArn: string;
        oldCommitId?: string;
        commitId: string;
        pipelineName: string;
        pipelineArn: string;
        inputFile: string;
        eventBusName: string
    };
}
