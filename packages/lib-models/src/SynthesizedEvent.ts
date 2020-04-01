type DetailType = 'CodePipeline Pipeline Finished' | 'CodePipeline Pipeline Skipped';
type SourceType = 'synth.codepipeline';
type StateType = 'SUCCEEDED';

export interface SynthesizedEventDetail {
    pipeline: string;
    commitId?: string;
    referenceType?: string;
    referenceName?: string;
    state: StateType;
    filesChanged?: Array<string>;
}

export interface SynthesizedEvent {
    Resources: Array<string>;
    DetailType: DetailType;
    Source: SourceType;
    Detail: string;
}

export interface SynthesizedEventRule {
    detailType?: Array<DetailType>;
    source?: [SourceType];
    region?: Array<string>;
    detail?: {
        pipeline?: Array<string>;
        state?: [StateType];
    };
}
