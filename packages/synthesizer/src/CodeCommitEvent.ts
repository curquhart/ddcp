export interface CodeCommitEvent {
    detail: {
        repositoryName: string;
        repositoryArn: string;
        oldCommitId?: string;
        commitId: string;
        referenceType: string;
        referenceName: string;
        pipelineName: string;
        pipelineArn: string;
        inputFile: string;
        eventBusName: string;
    };
}
