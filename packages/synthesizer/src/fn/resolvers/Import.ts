import {Base} from '../Base';
import {ParameterCountError} from '../errors/ParameterCountError';
import {ResolveResult} from '../../Resolver';
import {Fn} from '@aws-cdk/core';

type IParameters = Array<string>

export class Import extends Base<unknown, IParameters> {
    get name(): string {
        return '!Import';
    }

    resolve(parameters: IParameters): ResolveResult<unknown> {
        if (parameters.length !== 1) {
            throw new ParameterCountError(this.name, 'exactly 1');
        }

        return {
            value: Fn.importValue(parameters[ 0 ]),
            performedWork: true
        };
    }
}
