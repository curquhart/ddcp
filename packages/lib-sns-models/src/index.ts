export enum CodeBuildStatus {
    InProgress = 'IN_PROGRESS',
    Succeeded = 'SUCCEEDED',
    Failed = 'FAILED',
    Stopped = 'STOPPED',
}

export interface StatusSetting {
    emoji?: string;
}

export interface EnvVar {
    name?: string;
    value?: string;
}

export interface Payload {
    buildStatus: CodeBuildStatus;
    projectName: string;
    repositoryName: string;
    branchName?: string;
    buildId: string;
    region: string;
    icon: string;
    buildEnvironment?: Array<EnvVar>;
    slackSettings: Array<{
        uri: string;
        channel: string;
        username: string;
        statuses?: Record<string, StatusSetting>;
    }>;
    githubSettings: {
       auth: {
           APP_ID: string;
           PRIVATE_KEY: string;
       };
    };
}
