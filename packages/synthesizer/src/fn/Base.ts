import {UnresolvedDependencyError} from './errors/UnresolvedDependencyError';
import {ResolveResult, isResolved} from '../Resolver';
import {Stack} from '@aws-cdk/core';

export interface BaseResolver<T, U> {
    resolve(parameters: U, fullValue: Record<string, unknown>): ResolveResult<T>;
}

export abstract class Base<T, U extends Array<unknown>> implements BaseResolver<T, U> {
    constructor(
        protected readonly allResolvers: Record<string, unknown>
    ) {
    }

    init(): this {
        this.allResolvers[this.name] = this;
        return this;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    withScope(scope: Stack): BaseResolver<T, U> {
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
