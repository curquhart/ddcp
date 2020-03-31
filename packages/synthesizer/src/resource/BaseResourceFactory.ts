import {Construct} from '@aws-cdk/core';
import {BaseResourceProps} from '@ddcp/models';

export interface BaseResource {
    getOutput(name: string | number): unknown;
    constructCdk(scope: Construct): void;
}

export abstract class BaseResourceFactory {
    constructor(
        protected readonly allResources: Record<string, BaseResourceFactory>
    ) {
    }

    init(): this {
        this.allResources[this.name] = this;
        return this;
    }

    /**
     * Creates a new managed object. It is expected that each call for a given Name returns the same object.
     * @param props The resource properties.
     */
    abstract new(props: BaseResourceProps): BaseResource;

    abstract readonly name: string;

    checkProps(props: Record<string, unknown> | BaseResourceProps): void {
        if (typeof props !== 'object'
            || props === null
            || typeof props.Name !== 'string'
            || typeof props.Type !== 'string'
        ) {
            throw new Error('Props do not conform to BaseResourceProps interface.');
        }
    }
}
