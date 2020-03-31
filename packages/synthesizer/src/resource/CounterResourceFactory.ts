import {
    BaseResource,
    BaseResourceFactory,
} from './BaseResourceFactory';
import {Tokenizer} from '@ddcp/tokenizer';
import {Construct, RemovalPolicy} from '@aws-cdk/core';
import {AttributeType, BillingMode, Table} from '@aws-cdk/aws-dynamodb';
import {Uniquifier} from '../Uniquifier';
import {PolicyStatement} from '@aws-cdk/aws-iam';
import {throwError} from '@ddcp/errorhandling';
import {BaseResourceProps} from '@ddcp/models';

type CounterResourceProps = BaseResourceProps;

interface CounterResourceSharedData {
    table?: Table;
}

class CounterResource implements BaseResource {
    private readPolicy?: PolicyStatement;
    private writePolicy?: PolicyStatement;

    constructor(
        private readonly tokenizer: Tokenizer,
        private readonly uniquifier: Uniquifier,
        private readonly sharedData: CounterResourceSharedData,
        private readonly props: CounterResourceProps
    ) {
    }

    getOutput(name: string | number): PolicyStatement | string {
        if (this.sharedData.table === undefined) {
            throw new Error('outputs requested before resource construction!');
        }

        if (name === 'ReadPolicy') {
            return this.readPolicy ?? throwError(new Error('Internal error: readPolicy is undefined.'));
        }
        if (name === 'WritePolicy') {
            return this.writePolicy ?? throwError(new Error('Internal error: writePolicy is undefined.'));
        }
        if (name === 'TableName') {
            return this.sharedData.table.tableName;
        }
        if (name === 'CounterId') {
            return this.props.Name;
        }

        throw new Error(`Unknown output: ${name}.`);
    }

    constructCdk(scope: Construct): void {
        // Use a single table for all counters.
        if (this.sharedData.table === undefined) {
            this.sharedData.table = new Table(scope, this.uniquifier.next('CounterTable'), {
                partitionKey: {
                    name: 'counterId',
                    type: AttributeType.STRING,
                },
                removalPolicy: RemovalPolicy.DESTROY,
                billingMode: BillingMode.PAY_PER_REQUEST,
            });
        }

        const resources = [
            this.sharedData.table.tableArn
        ];

        const conditions = {
            'ForAllValues:StringEquals': {
                'dynamodb:LeadingKeys': [
                    this.props.Name,
                ],
            },
        };

        this.readPolicy = new PolicyStatement({
            actions: [
                'dynamodb:GetItem',
            ],
            resources,
            conditions,
        });

        this.writePolicy = new PolicyStatement({
            actions: [
                'dynamodb:UpdateItem',
            ],
            resources,
            conditions,
        });
    }
}

export class CounterResourceFactory extends BaseResourceFactory {
    constructor(
        resources: Record<string, BaseResourceFactory>,
        private readonly tokenizer: Tokenizer,
        private readonly uniquifier: Uniquifier
    ) {
        super(resources);
    }

    readonly name = 'Counter';
    private sharedData: CounterResourceSharedData = {};
    private counters: Record<string, CounterResource> = {};

    new(props: BaseResourceProps): CounterResource {
        this.checkProps(props);

        if (this.counters[props.Name] !== undefined) {
            return this.counters[props.Name];
        }

        this.counters[props.Name] = new CounterResource(this.tokenizer, this.uniquifier, this.sharedData, props);

        return this.counters[props.Name];
    }
}