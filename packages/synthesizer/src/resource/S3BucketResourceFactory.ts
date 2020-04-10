import {BaseResource, BaseResourceFactory,} from './BaseResourceFactory';
import {Construct, RemovalPolicy} from '@aws-cdk/core';
import {Uniquifier} from '../Uniquifier';
import {Effect, PolicyStatement, ServicePrincipal} from '@aws-cdk/aws-iam';
import {throwError} from '@ddcp/errorhandling';
import {S3BucketResourceProps} from '@ddcp/models';
import {Bucket} from '@aws-cdk/aws-s3';
import {Function} from '@aws-cdk/aws-lambda';
import {getFunction} from '../helpers';
import {ManagerResources} from '../SynthesisHandler';
import {LambdaModuleName} from '@ddcp/module-collection';
import {CustomResource, CustomResourceProvider} from '@aws-cdk/aws-cloudformation';

interface S3BucketResourceSharedData {
    requesterPaysLambda?: Function;
    functionCache: Record<string, Function>;
}

class S3BucketResource implements BaseResource {
    private readPolicy?: PolicyStatement;
    private writePolicy?: PolicyStatement;
    private s3Bucket?: Bucket;
    private s3BucketConfigured = false;

    constructor(
        private readonly uniquifier: Uniquifier,
        private readonly sharedData: S3BucketResourceSharedData,
        private readonly props: S3BucketResourceProps
    ) {
    }

    getOutput(name: string | number, scope: Construct): PolicyStatement | string {
        this.constructCdk(scope);

        if (name === 'ReadPolicy') {
            return this.readPolicy ?? throwError(new Error('Internal error: readPolicy is undefined.'));
        }
        if (name === 'WritePolicy') {
            return this.writePolicy ?? throwError(new Error('Internal error: writePolicy is undefined.'));
        }
        if (name === 'BucketArn') {
            return this.s3Bucket?.bucketArn ?? throwError(new Error('Internal error: bucketArn is undefined.'));
        }
        if (name === 'BucketName') {
            return this.s3Bucket?.bucketName ?? throwError(new Error('Internal error: bucketName is undefined.'));
        }

        throw new Error(`Unknown output: ${name}.`);
    }

    constructCdk(scope: Construct, managerResources?: ManagerResources): void {
        if (this.s3Bucket === undefined) {
            this.s3Bucket = new Bucket(scope, this.uniquifier.next(`Bucket${this.props.Name}`));

            if (this.props.BucketPolicy !== undefined) {
                for (const policy of this.props.BucketPolicy) {
                    this.s3Bucket.addToResourcePolicy(new PolicyStatement({
                        effect: policy.Effect as Effect | undefined,
                        principals: policy.ServicePrincipals?.map((principal) => new ServicePrincipal(principal)),
                        actions: policy.Actions,
                        resources: policy.Resources ?? [
                            this.s3Bucket.arnForObjects('*'),
                            this.s3Bucket.bucketArn,
                        ]
                    }));
                }
            }
        }

        if (this.props.RequesterPays === true && !this.s3BucketConfigured && managerResources !== undefined) {
            this.s3BucketConfigured = true;

            const fn = getFunction({
                scope,
                functionCache: this.sharedData.functionCache,
                managerResources,
                moduleName: LambdaModuleName.S3RequesterPays,
            });
            fn.addToRolePolicy(new PolicyStatement({
                resources: [
                    this.s3Bucket.bucketArn,
                ],
                actions: [
                    's3:PutBucketRequestPayment',
                ],
            }));
            new CustomResource(scope, this.uniquifier.next('BucketCr'), {
                provider: CustomResourceProvider.fromLambda(fn),
                properties: {
                    BucketName: this.s3Bucket.bucketName,
                },
                removalPolicy: RemovalPolicy.RETAIN,
            });
        }

        const resources = [
            this.s3Bucket.arnForObjects('*'),
        ];

        if (this.readPolicy === undefined) {
            this.readPolicy = new PolicyStatement({
                actions: [
                    's3:GetObject',
                ],
                resources,
            });
        }

        if (this.writePolicy === undefined) {
            this.writePolicy = new PolicyStatement({
                actions: [
                    's3:PutObject',
                    's3:PutObjectAcl',
                ],
                resources,
            });
        }
    }
}

export class S3BucketResourceFactory extends BaseResourceFactory {
    constructor(
        resources: Record<string, BaseResourceFactory>,
        private readonly uniquifier: Uniquifier
    ) {
        super(resources);
    }

    readonly name = 'S3Bucket';
    private sharedData: S3BucketResourceSharedData = {
        functionCache: {},
    };
    private buckets: Record<string, S3BucketResource> = {};

    new(props: S3BucketResourceProps): S3BucketResource {
        this.checkProps(props);

        if (this.buckets[props.Name] !== undefined) {
            return this.buckets[props.Name];
        }

        this.buckets[props.Name] = new S3BucketResource(this.uniquifier, this.sharedData, props);

        return this.buckets[props.Name];
    }
}