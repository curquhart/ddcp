import {BaseOrchestratorFactory, Orchestrator} from './BaseOrchestratorFactory';

export const NAME = 'CloudWatch';

export class CloudWatchOrchestratorFactory extends BaseOrchestratorFactory {
    constructor(orchestrators: Record<string, BaseOrchestratorFactory>) {
        super(orchestrators);
    }

    get name(): string {
        return NAME;
    }

    new(): Orchestrator {
        throw new Error('NotImplemented');
    }
}
