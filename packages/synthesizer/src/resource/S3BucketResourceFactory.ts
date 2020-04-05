import {
    BaseResource,
    BaseResourceFactory,
} from './BaseResourceFactory';
import {Construct} from '@aws-cdk/core';
import {Uniquifier} from '../Uniquifier';
import {PolicyStatement} from '@aws-cdk/aws-iam';
import {throwError} from '@ddcp/errorhandling';
import {S3BucketResourceProps} from '@ddcp/models';
import {Bucket} from '@aws-cdk/aws-s3';
import {Function} from '@aws-cdk/aws-lambda';

interface S3BucketResourceSharedData {
    requesterPaysLambda?: Function;
}

class S3BucketResource implements BaseResource {
    private readPolicy?: PolicyStatement;
    private writePolicy?: PolicyStatement;
    private s3Bucket?: Bucket;

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

    constructCdk(scope: Construct): void {
        if (this.s3Bucket === undefined) {
            this.s3Bucket = new Bucket(scope, this.uniquifier.next('Bucket'));

            if (this.props.RequesterPays === true) {
                // TODO: requestor pays CR
            }
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
    private sharedData: S3BucketResourceSharedData = {};
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