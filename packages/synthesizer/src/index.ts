import {CodePipelineEvent, Context} from 'aws-lambda';
import {SynthesisHandler} from './SynthesisHandler';

export type ArtifactStore = Record<string, Buffer>;

export const handler = async (event: CodePipelineEvent, context: Context): Promise<void> => {
    return new SynthesisHandler().safeHandle(event, context);
};
