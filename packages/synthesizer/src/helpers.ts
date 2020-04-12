import {Bucket} from '@aws-cdk/aws-s3';
import {Code, Function, ILayerVersion, Runtime} from '@aws-cdk/aws-lambda';
import {Construct, Duration} from '@aws-cdk/core';
import {ManagerResources} from '@ddcp/models';
import {createHash} from 'crypto';
import {throwError} from '@ddcp/errorhandling';
import {LambdaModuleName} from '@ddcp/module-collection';
import {CustomResource, CustomResourceProvider} from '@aws-cdk/aws-cloudformation';

// eslint-disable-next-line @typescript-eslint/no-empty-function
export const EMPTY_VOID_FN = (): void => {};
const sourceBucketName = process.env.LAMBDA_DIST_BUCKET_NAME ?? throwError(new Error('LAMBDA_DIST_BUCKET_NAME is required.'));
const buildVersion = process.env.BUILD_VERSION ?? throwError(new Error('BUILD_VERSION is required.'));

export interface FunctionCache {
    lambdas: Record<string, Function>;
    crs: Record<string, CustomResource>;
}

export const initFunctionCache = (): FunctionCache => {
    return  {
        lambdas: {},
        crs: {},
    };
};

export interface GetFunctionProps {
    scope: Construct;
    functionCache: FunctionCache;
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
    if (props.functionCache.lambdas[funcId] !== undefined) {
        return props.functionCache.lambdas[funcId];
    }

    const assetBucket = Bucket.fromBucketName(props.scope, `${funcId}Bucket`, props.managerResources.assetBucketName);
    const s3resolver = Function.fromFunctionArn(props.scope, `${funcId}ImportResolver`, props.managerResources.s3resolverArn);

    if(props.functionCache.crs[props.moduleName] === undefined) {
        props.functionCache.crs[props.moduleName] = new CustomResource(props.scope, `${funcId}Cr`, {
            provider: CustomResourceProvider.fromLambda(s3resolver),
            properties: {
                SourceBucketName: sourceBucketName,
                SourceKey: `${buildVersion}/${props.moduleName.replace('/', '')}.zip`,
                DestBucketName: props.managerResources.assetBucketName,
                StackUuid: props.managerResources.stackUuid,
            },
        });
    }
    const assetKey = props.functionCache.crs[props.moduleName].getAtt('DestKey').toString();

    props.functionCache.lambdas[funcId] = new Function(props.scope, funcId, {
        code: Code.fromBucket(assetBucket, assetKey),
        runtime: Runtime.NODEJS_12_X,
        handler: 'dist/bundled.handler',
        environment: props.env,
        memorySize: props.memorySize,
        timeout: props.timeout ?? Duration.seconds(30),
        layers: props.layers,
    });

    return props.functionCache.lambdas[funcId];
};
