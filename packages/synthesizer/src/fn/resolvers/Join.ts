import {Base} from '../Base';
import {ParameterCountError} from '../errors/ParameterCountError';
import {ParameterTypeError} from '../errors/ParameterTypeError';
import {ResolveResult} from '../../Resolver';

type IParameters = Array<string | number | Array<string | number>>

export class Join extends Base<unknown, IParameters> {
    get name(): string {
        return '!Join';
    }

    resolve(parameters: IParameters): ResolveResult<unknown> {
        if (parameters.length === 0) {
            throw new ParameterCountError(this.name, 'at least 1');
        }

        let joined: unknown = undefined;
        for (let index = 0; index < parameters.length; index++) {
            const value = parameters[index];
            this.checkResolved(value);

            // initialize joined
            if (joined === undefined) {
                if (typeof value === 'string') {
                    joined = '';
                }
                else if (Array.isArray(value)) {
                    joined = [];
                }
                else if (typeof value === 'object') {
                    joined = {};
                }
            }

            if (typeof joined !== typeof value || Array.isArray(joined) !== Array.isArray(value)) {
                throw new ParameterTypeError(index, 'types must match.');
            }

            // do concat
            if (typeof joined === 'string') {
                joined += value;
            }
            else if (Array.isArray(joined)) {
                joined = joined.concat(value);
            }
            else {
                Object.assign(joined, value);
            }
        }

        return {
            value: joined,
            performedWork: true
        };
    }
}
