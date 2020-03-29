export interface CodePipelineEvent {
    pipelineName: string;
    region: string;
    synthesisPipelineName: string;
    eventPipelineName: string;
    assetsBucket: string;
    assetsKey: string;
}