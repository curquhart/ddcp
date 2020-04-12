export interface ManagerResources {
    arn: string;
    sourceBranch: string;
    sourceType: 'CodeCommit';
    sourceRepoName: string;
    eventBusArn: string;
    assetBucketName: string;
    stackUuid: string;
    s3resolverArn: string;
}
