export type ComputeType = 'BUILD_GENERAL1_SMALL' | 'BUILD_GENERAL1_MEDIUM' | 'BUILD_GENERAL1_LARGE' | 'BUILD_GENERAL1_2XLARGE';
export type BucketAccessControl = 'Private' | 'PublicRead' | 'PublicReadWrite' | 'AuthenticatedRead' | 'LogDeliveryWrite' | 'BucketOwnerRead' | 'BucketOwnerFullControl' | 'AwsExecRead';

export interface BaseResourceProps {
    Name: string;
    Type: string;
}

export interface CounterResourceProps extends BaseResourceProps {
    Type: 'Counter';
}

export interface S3BucketResourceProps extends BaseResourceProps {
    Type: 'S3Bucket';
    RequesterPays?: boolean;
}

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
    Trigger?: 'GitHubWebHook';
    Auth?: {
        PrivateKey?: string;
    };
}

interface Action {
    Name: string;
    Order?: number;
    SourceName?: string;
    Inputs?: Array<string>;
}

type CodeBuildBuildSpec = Record<string, unknown> & {
    artifacts?: {
        'secondary-artifacts'?: Record<string, unknown>;
    };
    reports?: Record<string, unknown>;
    env?: {
        'variables'?: Record<string, string>;
        'secrets-manager'?: Record<string, string>;
    };
}

export interface CodeBuildAction extends Action {
    Type: ActionType.CODE_BUILD;
    BuildSpec: {
        Inline?: CodeBuildBuildSpec;
    };
    InputArtifacts?: Array<string>;
    EnableBadge?: boolean;
    BuildImage?: string;
    ComputeType?: ComputeType;
    PrivilegedMode?: boolean;
}

export interface S3PublishAction extends Action {
    Type: ActionType.S3_PUBLISH;
    AccessControl?: BucketAccessControl;
    BucketName?: string;
    BucketArn?: string;
    ObjectKey?: string;
    Extract?: boolean;
    CacheControl?: Array<string>;
}

export interface CounterAction extends Action {
    Type: ActionType.COUNTER;
    Counter: BaseResourceProps;
    Operation: 'IncrementAndGet';
    OutputArtifactName: string;
}

export const isCodeBuildAction = (action: { Type: string }): action is CodeBuildAction => {
    return action.Type === ActionType.CODE_BUILD;
};

export const isS3PublishAction = (action: { Type: string }): action is S3PublishAction => {
    return action.Type === ActionType.S3_PUBLISH;
};

export const isCounterAction = (action: { Type: string }): action is CounterAction => {
    return action.Type === ActionType.COUNTER;
};

export type StageActionType = CodeBuildAction | S3PublishAction | CounterAction;

interface Stage {
    Name: string;
    Actions: Array<StageActionType>;
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
    Name: string;
    EnableBadge?: boolean;
    Sources: Array<Source>;
    Stages: Array<Stage>;
    Notifications?: {
        Slack?: Array<SlackNotification>;
    };
    GitHub?: {
        // string allows for a token.
        Auth?: {
            APP_ID?: string;
            PRIVATE_KEY?: string;
        } | string;
        Defaults?: {
            Owner?: string;
            Repo?: string;
        };
    };
}

export interface PipelineConfigs {
    Pipelines?: Array<Pipeline>;
    Resources?: Array<CounterResourceProps | S3BucketResourceProps>;
}
