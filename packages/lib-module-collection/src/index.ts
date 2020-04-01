export enum LambdaModuleName {
    Synthesizer = '@ddcp/synthesizer',
    Selector = '@ddcp/selector',
    SnsToGitHub = '@ddcp/sns-to-github',
    SnsToSlack = '@ddcp/sns-to-slack',
    CodePipelineBadge = '@ddcp/codepipeline-badge',
    ActionCounter = '@ddcp/action-counter',
    GitHubMirror = '@ddcp/github-mirror',
}

export enum ModuleName {
    Manager = '@ddcp/manager',
}

export type ModuleCollection = {
    [name in ModuleName]: string;
};

export type LambdaModuleCollection = {
    [name in LambdaModuleName]: string;
};

export const LambdaInputArtifacts: LambdaModuleCollection = {
    [LambdaModuleName.Selector]: 'node_modules/@ddcp/selector/dist/@ddcpselector.zip',
    [LambdaModuleName.Synthesizer]: 'node_modules/@ddcp/synthesizer/dist/@ddcpsynthesizer.zip',
    [LambdaModuleName.SnsToGitHub]: 'node_modules/@ddcp/sns-to-github/dist/@ddcpsns-to-github.zip',
    [LambdaModuleName.SnsToSlack]: 'node_modules/@ddcp/sns-to-slack/dist/@ddcpsns-to-slack.zip',
    [LambdaModuleName.CodePipelineBadge]: 'node_modules/@ddcp/codepipeline-badge/dist/@ddcpcodepipeline-badge.zip',
    [LambdaModuleName.ActionCounter]: 'node_modules/@ddcp/action-counter/dist/@ddcpaction-counter.zip',
    [LambdaModuleName.GitHubMirror]: 'node_modules/@ddcp/github-mirror/dist/@ddcpgithub-mirror.zip',
};

export const InputArtifacts: ModuleCollection = {
    [ModuleName.Manager]: 'node_modules/@ddcp/manager/dist/manager.yaml',
};

export const AllModules = Object.keys(InputArtifacts) as Array<ModuleName>;
export const AllLambdaModules = Object.keys(LambdaInputArtifacts) as Array<LambdaModuleName>;

export type LambdaOutputArtifacts = LambdaModuleCollection;
