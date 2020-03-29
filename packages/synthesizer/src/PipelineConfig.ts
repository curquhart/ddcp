import * as s3 from '@aws-cdk/aws-s3';
import {BaseResourceProps} from './resource/BaseResourceFactory';
import {ComputeType} from "@aws-cdk/aws-codebuild";

export enum SourceType {
    CODE_COMMIT = 'CodeCommit',
    GIT = 'Git'
}

export enum ActionType {
    CODE_BUILD = 'CodeBuild',
    S3_PUBLISH = 'S3Publish',
    COUNTER = 'Counter'
}

export interface Source {
    Name?: string;
    Type?: SourceType;
    RepositoryName?: string;
    BranchName?: string;
    BranchPattern?: string;
    Uri?: string;
    Trigger: 'GitHubWebHook';
    Auth?: {
        PrivateKey?: string;
    };
}

interface Action {
    Name: string;
    Order?: number;
    Type?: string;
    SourceName?: string;
    Inputs?: Array<string>;
}

type CodeBuildBuildSpec = Record<string, unknown> & {
    artifacts?: {
        'secondary-artifacts'?: Record<string, unknown>;
    };
    reports?: Record<string, unknown>;
    env?: {
        'secrets-manager'?: Record<string, string>;
    };
}

export interface CodeBuildAction extends Action {
    BuildSpec: {
        Inline?: CodeBuildBuildSpec;
    };
    InputArtifacts?: Array<string>;
    Type: ActionType.CODE_BUILD;
    EnableBadge?: boolean;
    BuildImage?: string;
    ComputeType?: ComputeType;
    PrivilegedMode?: boolean;
}

export interface S3PublishAction extends Action {
    Type: ActionType.S3_PUBLISH;
    AccessControl?: s3.BucketAccessControl;
    BucketName?: string;
    BucketArn?: string;
    ObjectKey: string;
    Extract?: boolean;
    CacheControl?: Array<string>;
}

export interface CounterAction extends Action {
    Type: ActionType.COUNTER;
    Counter: BaseResourceProps;
    Operation: 'IncrementAndGet';
    OutputArtifactName: string;
}

export const isCodeBuildAction = (action: Action): action is CodeBuildAction => {
    return action.Type === ActionType.CODE_BUILD;
};

export const isS3PublishAction = (action: Action): action is S3PublishAction => {
    return action.Type === ActionType.S3_PUBLISH;
};

export const isCounterAction = (action: Action): action is CounterAction => {
    return action.Type === ActionType.COUNTER;
};

interface Stage {
    Name?: string;
    Actions?: Array<Action>;
}

interface SlackNotificationSetting {
    emoji?: string;
}

interface SlackNotification {
    Channel?: string;
    UserName?: string;
    WebHookUrl?: string;
    Statuses?: {
        IN_PROGRESS?: SlackNotificationSetting;
        SUCCEEDED?: SlackNotificationSetting;
        FAILED?: SlackNotificationSetting;
        STOPPED?: SlackNotificationSetting;
    };
}

export interface Pipeline {
    Orchestrator?: string;
    Name?: string;
    Sources?: Array<Source>;
    Stages?: Array<Stage>;
    Notifications?: {
        Slack?: Array<SlackNotification>;
    };
    GitHub?: {
        Auth?: {
            APP_ID?: string;
            PRIVATE_KEY?: string;
        };
        Defaults?: {
            Owner?: string;
            Repo?: string;
        };
    };
}

export interface PipelineConfigs {
    Pipelines?: Array<Pipeline>;
    Resources?: Array<BaseResourceProps>;
}
