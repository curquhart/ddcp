import {Bucket} from '@aws-cdk/aws-s3';
import {Code, Function, ILayerVersion, Runtime} from '@aws-cdk/aws-lambda';
import {Construct, Duration} from '@aws-cdk/core';
import {ManagerResources} from './SynthesisHandler';
import {createHash} from 'crypto';
import {throwError} from '@ddcp/errorhandling';
import {LambdaModuleName} from '@ddcp/module-collection';

// eslint-disable-next-line @typescript-eslint/no-empty-function
export const EMPTY_VOID_FN = (): void => {};

export interface GetFunctionProps {
    scope: Construct;
    functionCache: Record<string, Function>;
    managerResources: ManagerResources;
    moduleName: LambdaModuleName;
    env?: Record<string, string>;
    memorySize?: number;
    timeout?: Duration;
    layers?: Array<ILayerVersion>;
}

export const getFunction = (props: GetFunctionProps): Function => {
    const funcId = `${props.moduleName}-${createHash('md5')
        .update(`${props.memorySize}`)
        .update(JSON.stringify(props.env || {}))
        .digest('hex')}`;
    if (props.functionCache[funcId] !== undefined) {
        return props.functionCache[funcId];
    }

    const assetBucket = Bucket.fromBucketName(props.scope, `${funcId}Bucket`, props.managerResources.assetBucketName);
    props.functionCache[funcId] = new Function(props.scope, funcId, {
        code: Code.fromBucket(assetBucket, props.managerResources.assetKeys[props.moduleName] ?? throwError(new Error(`Invalid module: ${props.moduleName}`))),
        runtime: Runtime.NODEJS_12_X,
        handler: 'dist/bundled.handler',
        environment: props.env,
        memorySize: props.memorySize,
        timeout: props.timeout ?? Duration.seconds(30),
        layers: props.layers,
    });

    return props.functionCache[funcId];
};
