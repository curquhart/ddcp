export interface CodeBuildCloudWatchEvent {
    projectName: string;
    sourceVersion: string;
    branchPattern?: string;
    branchName: string;
    environmentVariablesOverride: [
        {
            // For whatever raisin, this does not seem to be available in codebuild events, so put
            // it in an environment var to allow us to extract it.
            name: 'SOURCE_VERSION';
            value: string;
            type: 'PLAINTEXT';
        },
        {
            name: 'SOURCE_BRANCH_NAME';
            value: string;
            type: 'PLAINTEXT';
        },
    ];
}
