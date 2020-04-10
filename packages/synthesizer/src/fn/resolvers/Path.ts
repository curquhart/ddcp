import {Base, BaseResolver} from '../Base';
import {ParameterCountError} from '../errors/ParameterCountError';
import {StringParameterTypeError} from '../errors/StringParameterTypeError';
import {ResolveResult} from '../../Resolver';
import {BaseResourceFactory} from '../../resource/BaseResourceFactory';
import {BaseResourceProps} from '@ddcp/models';
import {throwError} from '@ddcp/errorhandling';
import {Construct} from '@aws-cdk/core';

type IParameters = Array<string | number>

export class Path extends Base<unknown, IParameters> {
    constructor(
        protected allResolvers: Record<string, Base<unknown, Array<unknown>>>,
        private readonly allResourceFactories: Record<string, BaseResourceFactory>
    ) {
        super(allResolvers);
    }

    get name(): string {
        return '!Path';
    }

    withScope(scope: Construct): BaseResolver<unknown, IParameters> {
        return {
            resolve: (parameters: IParameters, fullValue: Record<string, unknown>): ResolveResult<unknown> => {
                return this.resolveWithScope(parameters, fullValue, scope);
            }
        };
    }

    resolve(): never {
        throw new Error('Scope is required.');
    }

    private resolveWithScope(parameters: IParameters, fullValue: Record<string, unknown>, scope: Construct): ResolveResult<unknown> {
        if (parameters.length === 0) {
            return {
                value: fullValue,
                performedWork: true
            };
        }

        let resolved: unknown = undefined;
        for (let index = 0; index < parameters.length; index++) {
            const value: unknown = parameters[index];
            this.checkResolved(value);

            if (typeof value !== 'string' && typeof value !== 'number') {
                // todo make error consistent
                throw new StringParameterTypeError(index);
            }

            if (parameters.length >= 4 && index === 2 && parameters[0] === 'Resources' && !isNaN(Number(parameters[1])) && parameters[2] === 'Outputs') {
                const typedResolved = resolved as BaseResourceProps;
                const resourceType = typedResolved.Type ?? throwError(new Error('Type is required in Resources.'));
                const resourceFactory = this.allResourceFactories[ resourceType ] ?? throwError(new Error(`Invalid resource type: ${resourceType}`));

                resolved = resourceFactory.new(typedResolved).getOutput(parameters[3], scope);
                index++;
            }
            else {
                resolved = Path.resolvePath(value, resolved === undefined ? fullValue : resolved);
            }

            if (resolved === undefined) {
                throw new Error(`Could not resolve path from ${JSON.stringify(parameters)}`);
            }
        }

        return {
            value: resolved,
            performedWork: true
        };
    }

    private static resolvePath(name: string | number, input: unknown): unknown {
        if (typeof input === 'object' && input !== null) {
            if (Array.isArray(input) && typeof name === 'number') {
                return input[name];
            }
            else if (!Array.isArray(input) && typeof name === 'string') {
                return (input as Record<string, unknown>)[name];
            }
        }

        throw new TypeError();
    }
}
