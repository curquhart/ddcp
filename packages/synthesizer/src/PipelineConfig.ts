import * as s3 from '@aws-cdk/aws-s3';

enum SourceType {
    CODE_COMMIT = 'CodeCommit'
}

export enum ActionType {
    CODE_BUILD = 'CodeBuild',
    S3_PUBLISH = 'S3Publish'
}

interface Source {
    Name?: string;
    Type?: SourceType;
    RepositoryName?: string;
    BranchName?: string;
}

export interface Action {
    Name: string;
    Order?: number;
    Type?: string;
    SourceName?: string;
    Inputs?: Array<string>;
}

export type CodeBuildBuildSpec = Record<string, unknown> & {
    artifacts?: {
        'secondary-artifacts'?: Record<string, unknown>;
    };
}

export interface CodeBuildAction extends Action {
    BuildSpec: {
        Inline?: CodeBuildBuildSpec;
    };
    Type: ActionType.CODE_BUILD;
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

export const isCodeBuildAction = (action: Action): action is CodeBuildAction => {
    return action.Type === ActionType.CODE_BUILD;
};

export const isS3PublishAction = (action: Action): action is S3PublishAction => {
    return action.Type === ActionType.S3_PUBLISH;
};

export interface Stage {
    Name?: string;
    Actions?: Array<Action>;
}

export interface Pipeline {
    Orchestrator: string;
    Name?: string;
    Sources?: Array<Source>;
    Stages?: Array<Stage>;
}

export interface PipelineConfigs {
    Pipelines?: Array<Pipeline>;
}
