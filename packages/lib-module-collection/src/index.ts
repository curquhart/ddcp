export enum ManagerLambdaModuleName {
    S3Resolver = '@ddcp/s3-resolver',
    Synthesizer = '@ddcp/synthesizer',
    Selector = '@ddcp/selector',
}

export enum LambdaModuleName {
    SnsToGitHub = '@ddcp/sns-to-github',
    SnsToSlack = '@ddcp/sns-to-slack',
    CodePipelineBadge = '@ddcp/codepipeline-badge',
    ActionCounter = '@ddcp/action-counter',
    GitHubMirror = '@ddcp/github-mirror',
    BranchFilter = '@ddcp/branch-filter',
    S3RequesterPays = '@ddcp/s3-requesterpays',
}

export enum ModuleName {
    Manager = '@ddcp/manager',
}

export type ModuleCollection = {
    [name in ModuleName]: string;
};

export type ManagerLambdaModuleCollection = {
    [name in ManagerLambdaModuleName]: string;
};

export type LambdaModuleCollection = {
    [name in LambdaModuleName]: string;
};

export const ManagerLambdaInputArtifacts: ManagerLambdaModuleCollection = {
    [ManagerLambdaModuleName.S3Resolver]: 'node_modules/@ddcp/s3-requesterpays/dist/@ddcps3-resolver.zip',
    [ManagerLambdaModuleName.Selector]: 'node_modules/@ddcp/selector/dist/@ddcpselector.zip',
    [ManagerLambdaModuleName.Synthesizer]: 'node_modules/@ddcp/synthesizer/dist/@ddcpsynthesizer.zip',
};

export const LambdaInputArtifacts: LambdaModuleCollection = {
    [LambdaModuleName.SnsToGitHub]: 'node_modules/@ddcp/sns-to-github/dist/@ddcpsns-to-github.zip',
    [LambdaModuleName.SnsToSlack]: 'node_modules/@ddcp/sns-to-slack/dist/@ddcpsns-to-slack.zip',
    [LambdaModuleName.CodePipelineBadge]: 'node_modules/@ddcp/codepipeline-badge/dist/@ddcpcodepipeline-badge.zip',
    [LambdaModuleName.ActionCounter]: 'node_modules/@ddcp/action-counter/dist/@ddcpaction-counter.zip',
    [LambdaModuleName.GitHubMirror]: 'node_modules/@ddcp/github-mirror/dist/@ddcpgithub-mirror.zip',
    [LambdaModuleName.BranchFilter]: 'node_modules/@ddcp/branch-filter/dist/@ddcpbranch-filter.zip',
    [LambdaModuleName.S3RequesterPays]: 'node_modules/@ddcp/s3-requesterpays/dist/@ddcps3-requesterpays.zip',
};

export const InputArtifacts: ModuleCollection = {
    [ModuleName.Manager]: 'node_modules/@ddcp/manager/dist/manager.yaml',
};

export const AllModules = Object.keys(InputArtifacts) as Array<ModuleName>;
export const AllLambdaModules = Object.keys(LambdaInputArtifacts) as Array<LambdaModuleName>;
