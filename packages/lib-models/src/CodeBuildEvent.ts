export enum CodeBuildStatus {
    InProgress = 'IN_PROGRESS',
    Succeeded = 'SUCCEEDED',
    Failed = 'FAILED',
    Stopped = 'STOPPED',
}

export interface CodeBuildStatusSetting {
    emoji?: string;
}

export interface CodeBuildEnvVar {
    name?: string;
    value?: string;
}

export interface CodeBuildPayload {
    buildStatus: CodeBuildStatus;
    projectName: string;
    repositoryName: string;
    branchName?: string;
    buildId: string;
    region: string;
    buildEnvironment?: Array<CodeBuildEnvVar>;
    slackSettings: Array<{
        uri: string;
        channel: string;
        username: string;
        statuses?: Record<string, CodeBuildStatusSetting>;
    }>;
    githubSettings: {
        auth: {
            APP_ID: string;
            PRIVATE_KEY: string;
        };
        defaults: {
            owner: string;
            repo: string;
        };
    };
}
