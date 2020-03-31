import {Base} from '../Base';
import {ParameterCountError} from '../errors/ParameterCountError';
import {StringParameterTypeError} from '../errors/StringParameterTypeError';
import {ResolveResult} from '../../Resolver';
import {BaseResourceFactory} from '../../resource/BaseResourceFactory';
import {BaseResourceProps} from '@ddcp/models';
import {throwError} from '@ddcp/errorhandling';

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

    resolve(parameters: IParameters, fullValue: Record<string, unknown>): ResolveResult<unknown> {
        if (parameters.length === 0) {
            throw new ParameterCountError(this.name, 'at least 1');
        }

        let resolved: unknown = undefined;
        for (let index = 0; index < parameters.length; index++) {
            // I am undecided whether I want this to be a thing or not..
            if (index === 2 && parameters[0] === 'Resources' && !isNaN(Number(parameters[1])) && parameters[2] === 'Outputs') {
                if (parameters.length !== 3) {
                    throw new Error('Lookups within Resource Outputs can only be one level deep.');
                }
                const typedResolved = resolved as BaseResourceProps;
                const resourceType = typedResolved.Type ?? throwError(new Error('Type is required in Resources.'));
                const resourceFactory = this.allResourceFactories[ resourceType ] ?? throwError(new Error(`Invalid resource type: ${resourceType}`));

                return {
                    value: resourceFactory.new(typedResolved).getOutput(parameters[3]),
                    performedWork: true
                };
            }

            const value: unknown = parameters[index];
            this.checkResolved(value);

            if (typeof value !== 'string' && typeof value !== 'number') {
                // todo make error consistent
                throw new StringParameterTypeError(index);
            }

            resolved = Path.resolvePath(value, resolved === undefined ? fullValue : resolved);

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
