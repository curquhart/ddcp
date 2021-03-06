import {Base, BaseResolver} from '../Base';
import {ParameterCountError} from '../errors/ParameterCountError';
import {ResolveResult} from '../../Resolver';
import {CfnParameter, Stack} from '@aws-cdk/core';
import {Uniquifier} from '../../Uniquifier';

type IParameters = Array<string>

export class SsmString extends Base<unknown, IParameters> {
    constructor(allResolvers: Record<string, Base<unknown, Array<unknown>>>, private readonly uniquifier: Uniquifier) {
        super(allResolvers);
    }

    get name(): string {
        return '!SsmString';
    }

    withScope(scope: Stack): BaseResolver<unknown, IParameters> {
        return {
            resolve: (parameters: IParameters): ResolveResult<unknown> => {
                return this.resolveWithScope(scope, parameters);
            }
        };
    }

    resolveWithScope(scope: Stack, parameters: IParameters): ResolveResult<unknown> {
        if (parameters.length !== 1) {
            throw new ParameterCountError(this.name, 'exactly 1');
        }

        const param = new CfnParameter(scope, this.uniquifier.next('SsmParam'), {
            type: 'AWS::SSM::Parameter::Value<String>',
            default: `${parameters[0]}`,
            noEcho: true,
        });

        return {
            value: param.valueAsString,
            performedWork: true
        };
    }

    resolve(): never {
        throw new Error('SsmString cannot resolve without scope.');
    }
}
