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
import {BaseOrchestratorFactory} from './orchestrator/BaseOrchestratorFactory';
import {CodePipelineOrchestratorFactory} from './orchestrator/CodePipelineOrchestratorFactory';
import {CloudWatchOrchestratorFactory} from './orchestrator/CloudWatchOrchestratorFactory';
import {Uniquifier} from './Uniquifier';

const uniquifier = new Uniquifier();
const allResolvers: Record<string, Base<unknown, Array<unknown>>> = {};
new Join(allResolvers).init();
new Path(allResolvers).init();
new PathForAlias(allResolvers).init();
new Import(allResolvers).init();
new SsmString(allResolvers, uniquifier).init();

const resolver = new Resolver(allResolvers);

const allOrchestrators: Record<string, BaseOrchestratorFactory> = {};
new CodePipelineOrchestratorFactory(allOrchestrators).init();
new CloudWatchOrchestratorFactory(allOrchestrators).init();

const isCodePipelineEvent = (event: unknown): event is CodePipelineEvent => {
    return typeof event === 'object' && event !== null && (event as Record<string, undefined>)['CodePipeline.job'] !== undefined;
};

export const handler = async (event: CodePipelineEvent | CodeCommitEvent, context: Context): Promise<void> => {
    if (isCodePipelineEvent(event)) {
        return new SynthesisHandler().safeHandle(event, context, resolver, allOrchestrators, uniquifier);
    }
    else {
        return new SelectorHandler().handle(event);
    }
};
