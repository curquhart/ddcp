enum SourceType {
    CODE_COMMIT = 'CodeCommit'
}

enum ActionType {
    CODE_BUILD = 'CodeBuild'
}

interface ISource {
    Name?: string
    Type?: SourceType
    RepositoryName?: string
    BranchName?: string
}

interface IAction {
    Name: string
    Order?: number
    Type?: string
    SourceName?: string
}

interface ICodeBuildInlineBuildSpec {
    Inline?: any
}
interface ICodeBuildAction extends IAction {
    BuildSpec: ICodeBuildInlineBuildSpec
    Type: 'CodeBuild'
}

export const isCodeBuildAction = (action: IAction): action is ICodeBuildAction => {
    return action.Type === 'CodeBuild'
}

interface IStage {
    Name?: string
    Actions?: Array<IAction>
}

interface IPipeline {
    Name?: string
    Sources?: Array<ISource>
    Stages?: Array<IStage>
}

export interface IPipelineConfigs {
    Pipelines?: Array<IPipeline>
}
