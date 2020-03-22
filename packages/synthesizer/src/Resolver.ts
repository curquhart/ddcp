import {Base} from './fn/Base';
import {EMPTY_VOID_FN} from './helpers';
import {Stack} from '@aws-cdk/core';

/**
 * Recursively checks if the provided value has been resolved.
 * @param allResolvers All available resolvers.
 * @param value The value to resolve.
 */
export const isResolved = (allResolvers: Record<string, unknown>, value: unknown): boolean => {
    const checkResolved = [value];

    while (checkResolved.length > 0) {
        const nextValue = checkResolved.shift();

        if (Array.isArray(nextValue)) {
            for (const entry of nextValue) {
                checkResolved.push(entry);
            }
        }
        else if (typeof nextValue === 'object' && nextValue !== null) {
            for (const [ key, entry ] of Object.entries(nextValue)) {
                if (allResolvers[key] !== undefined) {
                    return false;
                }
                checkResolved.push(entry);
            }
        }
    }

    return true;
};

export interface ResolveResult<T> {
    value: T;
    performedWork: boolean;
}

export interface ResolveJob {
    readonly value: unknown;
    readonly onPerformedWork: (newValue: unknown) => void;
}

export class Resolver {
    constructor(private readonly allResolvers: Record<string, Base<unknown, Array<unknown>>>
    ) {
    }

    /**
     * Resolve value and anything within value.
     * @param scope
     * @param value
     */
    resolve(scope: Stack, value: Record<string, unknown>): Record<string, unknown> {
        const toResolve: Array<ResolveJob> = [{value, onPerformedWork: EMPTY_VOID_FN}];

        let counter = 0;
        while (toResolve.length > 0) {
            if (counter++ > 10000) {
                // TODO: proper cyclic dependency detection.
                throw new Error('Probably a cyclic dependency...');
            }
            const nextValue: ResolveJob = toResolve[0];
            toResolve.shift();

            if (Array.isArray(nextValue.value)) {
                for (let index = 0; index < nextValue.value.length; index++) {
                    toResolve.push({
                        value: nextValue.value[index],
                        onPerformedWork: (newValue): void => {
                            (nextValue.value as Array<unknown>)[index] = newValue;
                        }
                    });
                }
            } else if (typeof nextValue.value === 'object' && nextValue.value !== null) {
                const entries = Object.entries(nextValue.value);
                for (const [key, entry] of entries) {
                    if (this.allResolvers[key] === undefined || entries.length !== 1) {
                        toResolve.push({
                            value: entry,
                            onPerformedWork: (newValue): void => {
                                (nextValue.value as Record<string, unknown>)[key] = newValue;
                            }
                        });
                    }
                    else {
                        let resolved: ResolveResult<unknown> = {
                            value: undefined,
                            performedWork: false
                        };

                        if (isResolved(this.allResolvers, entry)) {
                            resolved = this.allResolvers[key].withScope(scope).resolve(!Array.isArray(entry) ? [entry] : entry, value);
                        }
                        else {
                            toResolve.push({
                                value: entry,
                                onPerformedWork: (newValue) => {
                                    (nextValue.value as Record<string, unknown>)[key] = newValue;
                                }
                            });
                            toResolve.push(nextValue);
                        }

                        if (resolved.performedWork) {
                            nextValue.onPerformedWork(resolved.value);
                            console.info(`Resolved to ${JSON.stringify(resolved.value)}`);
                        }
                    }
                }
            }
        }

        return value;
    }
}