import * as AWSMock from 'aws-sdk-mock';
import * as AWS from 'aws-sdk';

import {Handler} from '../Handler';
import {GetItemInput} from 'aws-sdk/clients/dynamodb';

describe('Handler class', () => {
    it('sends appropriate query to dynamo', async () => {
        const handler = new Handler();

        AWSMock.setSDKInstance(AWS);
        AWSMock.mock('DynamoDB', 'updateItem', (params: GetItemInput, callback: Function) => {
            expect(params).toEqual({
                TableName: 'tbl',
                Key: {
                    'counterId': {
                        'S': 'counter',
                    }
                },
                UpdateExpression: 'ADD #count :one',
                ExpressionAttributeNames: {
                    '#count': 'count'
                },
                ExpressionAttributeValues: {
                    ':one': {
                        'N': '1'
                    }
                },
                ReturnValues: 'UPDATED_NEW',
            });
            callback(undefined, {
                Attributes: {
                    count: {
                        N: 2,
                    }
                }
            });
        });

        expect(await handler.incrementAndGet({
            Operation: 'incrementAndGet',
            TableName: 'tbl',
            CounterId: 'counter',
        })).toBe(2);
    });
});
