enum SourceType {
    CODE_COMMIT = 'CodeCommit'
}

export enum ActionType {
    CODE_BUILD = 'CodeBuild'
}

interface Source {
    Name?: string;
    Type?: SourceType;
    RepositoryName?: string;
    BranchName?: string;
}

interface Action {
    Name: string;
    Order?: number;
    Type?: string;
    SourceName?: string;
}

type CodeBuildBuildSpec = Record<string, unknown>

interface CodeBuildInlineBuildSpec {
    Inline?: CodeBuildBuildSpec;
}
interface CodeBuildAction extends Action {
    BuildSpec: CodeBuildInlineBuildSpec;
    Type: 'CodeBuild';
}

export const isCodeBuildAction = (action: Action): action is CodeBuildAction => {
    return action.Type === 'CodeBuild';
};

interface Stage {
    Name?: string;
    Actions?: Array<Action>;
}

interface Pipeline {
    Name?: string;
    Sources?: Array<Source>;
    Stages?: Array<Stage>;
}

export interface PipelineConfigs {
    Pipelines?: Array<Pipeline>;
}
