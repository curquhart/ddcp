import {CodePipelineEvent, Context} from 'aws-lambda'
import {SynthesisHandler} from "./SynthesisHandler";
import {ICodeCommitEvent} from "./ICodeCommitEvent";
import {SelectorHandler} from "./SelectorHandler";

const isCodePipelineEvent = (event: any): event is CodePipelineEvent => {
    return typeof event === 'object' && event !== null && event["CodePipeline.job"] !== undefined;
}

export const handle = async (event: CodePipelineEvent | ICodeCommitEvent, context: Context) => {
    if (isCodePipelineEvent(event)) {
        return new SynthesisHandler().safeHandle(event, context)
    }
    else {
        return new SelectorHandler().handle(event,  context)
    }
}
