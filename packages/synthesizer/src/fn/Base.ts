import {UnresolvedDependencyError} from './errors/UnresolvedDependencyError';
import {ResolveResult, isResolved} from '../Resolver';

export abstract class Base<T, U extends Array<unknown>> {
    constructor(
        protected readonly allResolvers: Record<string, unknown>
    ) {
    }

    init(): this {
        this.allResolvers[this.name] = this;
        return this;
    }

    abstract readonly name: string;

    abstract resolve(parameters: U, fullValue: Record<string, unknown>): ResolveResult<T>

    checkResolved(value: unknown): void {
        if (!isResolved(this.allResolvers, value)) {
            throw new UnresolvedDependencyError(value);
        }
    }
}
