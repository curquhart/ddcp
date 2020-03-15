import {CodePipelineEvent, Context} from 'aws-lambda';
import {SynthesisHandler} from './SynthesisHandler';
import {CodeCommitEvent} from './CodeCommitEvent';
import {SelectorHandler} from './SelectorHandler';
import {Resolver} from './Resolver';
import {Join} from './fn/resolvers/Join';
import {Path} from './fn/resolvers/Path';
import {PathForAlias} from './fn/resolvers/PathForAlias';
import {Base} from './fn/Base';
import {Import} from './fn/resolvers/Import';
import {SsmString} from './fn/resolvers/SsmString';

const allResolvers: Record<string, Base<unknown, Array<unknown>>> = {};
new Join(allResolvers).init();
new Path(allResolvers).init();
new PathForAlias(allResolvers).init();
new Import(allResolvers).init();
new SsmString(allResolvers).init();

const resolver = new Resolver(allResolvers);

const isCodePipelineEvent = (event: unknown): event is CodePipelineEvent => {
    return typeof event === 'object' && event !== null && (event as Record<string, undefined>)['CodePipeline.job'] !== undefined;
};

export const handler = async (event: CodePipelineEvent | CodeCommitEvent, context: Context): Promise<void> => {
    if (isCodePipelineEvent(event)) {
        return new SynthesisHandler().safeHandle(event, context, resolver);
    }
    else {
        return new SelectorHandler().handle(event);
    }
};
