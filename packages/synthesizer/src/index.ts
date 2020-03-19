import {CodePipelineEvent, Context} from 'aws-lambda';
import {SynthesisHandler} from './SynthesisHandler';
import {CodeCommitEvent} from './CodeCommitEvent';
import {SelectorHandler} from './SelectorHandler';
import {Resolver} from './Resolver';
import {Join} from './fn/resolvers/Join';
import {Path} from './fn/resolvers/Path';
import {PathForAlias} from './fn/resolvers/PathForAlias';
import {Base as BaseFn} from './fn/Base';
import {BaseResourceFactory} from './resource/BaseResourceFactory';
import {Import} from './fn/resolvers/Import';
import {SsmString} from './fn/resolvers/SsmString';
import {BaseOrchestratorFactory} from './orchestrator/BaseOrchestratorFactory';
import {CodePipelineOrchestratorFactory} from './orchestrator/CodePipelineOrchestratorFactory';
import {CloudWatchOrchestratorFactory} from './orchestrator/CloudWatchOrchestratorFactory';
import {Uniquifier} from './Uniquifier';
import {Secret} from './fn/resolvers/Secret';
import {Tokenizer} from '@ddcp/tokenizer';
import {CounterResourceFactory} from './resource/CounterResourceFactory';

const isCodePipelineEvent = (event: unknown): event is CodePipelineEvent => {
    return typeof event === 'object' && event !== null && (event as Record<string, undefined>)['CodePipeline.job'] !== undefined;
};

export const handler = async (event: CodePipelineEvent | CodeCommitEvent, context: Context): Promise<void> => {
    if (isCodePipelineEvent(event)) {
        const uniquifier = new Uniquifier();
        const tokenizer = new Tokenizer();

        const resolvers: Record<string, BaseFn<unknown, Array<unknown>>> = {};
        const resourceFactories: Record<string, BaseResourceFactory> = {};
        const orchestratorFactories: Record<string, BaseOrchestratorFactory> = {};

        new Join(resolvers).init();
        new Path(resolvers, resourceFactories).init();
        new PathForAlias(resolvers).init();
        new Import(resolvers).init();
        new SsmString(resolvers, uniquifier).init();
        new Secret(resolvers, tokenizer).init();

        const resolver = new Resolver(resolvers);

        new CodePipelineOrchestratorFactory(orchestratorFactories).init();
        new CloudWatchOrchestratorFactory(orchestratorFactories).init();

        new CounterResourceFactory(resourceFactories, tokenizer, uniquifier).init();

        return new SynthesisHandler().safeHandle({
            event,
            context,
            resolver,
            orchestratorFactories,
            resourceFactories,
            uniquifier,
            tokenizer
        });
    }
    else {
        return new SelectorHandler().handle(event);
    }
};
