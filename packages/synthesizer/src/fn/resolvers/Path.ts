import {Base} from '../Base';
import {ParameterCountError} from '../errors/ParameterCountError';
import {StringParameterTypeError} from '../errors/StringParameterTypeError';
import {ResolveResult} from '../../Resolver';

type IParameters = Array<string | number>

export class Path extends Base<unknown, IParameters> {
    get name(): string {
        return '!Path';
    }

    resolve(parameters: IParameters, fullValue: Record<string, unknown>): ResolveResult<unknown> {
        if (parameters.length === 0) {
            throw new ParameterCountError(this.name, 'at least 1');
        }

        let resolved: unknown = undefined;
        for (let index = 0; index < parameters.length; index++) {
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
