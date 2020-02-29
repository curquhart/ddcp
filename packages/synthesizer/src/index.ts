import {CodePipelineEvent, Context} from 'aws-lambda';
import {SynthesisHandler} from './SynthesisHandler';
import {CodeCommitEvent} from './CodeCommitEvent';
import {SelectorHandler} from './SelectorHandler';

const isCodePipelineEvent = (event: unknown): event is CodePipelineEvent => {
    return typeof event === 'object' && event !== null && (event as Record<string, undefined>)['CodePipeline.job'] !== undefined;
};

export const handle = async (event: CodePipelineEvent | CodeCommitEvent, context: Context): Promise<void> => {
    if (isCodePipelineEvent(event)) {
        return new SynthesisHandler().safeHandle(event, context);
    }
    else {
        return new SelectorHandler().handle(event);
    }
};
