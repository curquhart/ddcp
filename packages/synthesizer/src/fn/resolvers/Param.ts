import {Base} from '../Base';
import {ResolveResult} from '../../Resolver';
import {ParameterCountError} from '../errors/ParameterCountError';
import {ManagerResources} from '@ddcp/models';
import {Aws} from '@aws-cdk/core';

type IParameters = ['AssetBucketName' | 'Region' | 'AccountNumber']

export class Param extends Base<unknown, IParameters> {
    constructor(allResolvers: Record<string, Base<unknown, Array<unknown>>>, private readonly synthPipeline: ManagerResources) {
        super(allResolvers);
    }

    get name(): string {
        return '!Param';
    }

    resolve(parameters: IParameters): ResolveResult<unknown> {
        if (parameters.length !== 1) {
            throw new ParameterCountError(this.name, 'exactly 1');
        }

        if (parameters[0] === 'AssetBucketName') {
            return {
                value: this.synthPipeline.assetBucketName,
                performedWork: true
            };
        }
        // TODO: find a more sensible home for aws env.
        else if (parameters[0] === 'Region') {
            return {
                value: Aws.REGION,
                performedWork: true
            };
        }
        else if (parameters[0] === 'AccountNumber') {
            return {
                value: Aws.ACCOUNT_ID,
                performedWork: true
            };
        }

        throw new Error(`Unrecognized option: ${parameters[0]}`);
    }
}
