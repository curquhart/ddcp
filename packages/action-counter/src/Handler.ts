import {CodePipelineEvent, Context} from 'aws-lambda';
import {CodePipeline} from 'aws-sdk';
import {DynamoDB} from 'aws-sdk';
import {S3} from 'aws-sdk';
import * as AdmZip from 'adm-zip';
import {error} from '@ddcp/logger';

const getArtifactS3Client = (event: CodePipelineEvent): S3 => {
    const accessKeyId = event['CodePipeline.job'].data.artifactCredentials.accessKeyId;
    const secretAccessKey = event['CodePipeline.job'].data.artifactCredentials.secretAccessKey;
    const sessionToken = event['CodePipeline.job'].data.artifactCredentials.sessionToken;

    return new S3({
        accessKeyId,
        secretAccessKey,
        sessionToken
    });
};

interface UserParams {
    Operation: string;
    TableName: string;
    CounterId: string;
}

export class Handler {
    async incrementAndGet(userParameters: UserParams): Promise<number> {
        const dynamodb = new DynamoDB();

        const res = await dynamodb.updateItem({
            TableName: userParameters.TableName,
            Key: {
                'counterId': {
                    'S': userParameters.CounterId,
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
        }).promise();

        const count = Number(res.Attributes?.count.N);
        if (isNaN(count)) {
            throw new Error('Counter incrementAndGet failed.');
        }

        return count;
    }

    async safeHandle(event: CodePipelineEvent, context: Context): Promise<void> {
        const cp = new CodePipeline();

        try {
            const s3 = getArtifactS3Client(event);

            const userParamsStr = event['CodePipeline.job'].data.actionConfiguration.configuration.UserParameters;
            const userParams = JSON.parse(userParamsStr) as UserParams;
            if (userParams.Operation !== 'IncrementAndGet') {
                throw new Error('Only IncrementAndGet operation is supported.');
            }

            const outZip = new AdmZip();

            outZip.addFile('count', Buffer.from((await this.incrementAndGet(userParams)).toString()));

            await s3.putObject({
                Bucket: event['CodePipeline.job'].data.outputArtifacts[0].location.s3Location.bucketName,
                Key: event['CodePipeline.job'].data.outputArtifacts[0].location.s3Location.objectKey,
                Body: outZip.toBuffer()
            }).promise();

            await cp.putJobSuccessResult({jobId: event['CodePipeline.job'].id}).promise();
        } catch (err) {
            error(context.awsRequestId, err);
            await cp.putJobFailureResult({
                jobId: event['CodePipeline.job'].id, failureDetails: {
                    type: 'JobFailed',
                    message: `Failed to increment counter. Ref# ${context.awsRequestId}`
                }
            }).promise();
        }
    }
}