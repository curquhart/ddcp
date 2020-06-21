import {CloudFormationCustomResourceEvent, Context} from 'aws-lambda';
import {S3} from 'aws-sdk';
import {send as sendResponse, SUCCESS, FAILED, ResponseStatus} from 'cfn-response';

export const handler = async (event: CloudFormationCustomResourceEvent, context: Context): Promise<void> => {
    let physicalResourceId = 'default';

    const sendResponsePromise = (
        responseStatus: ResponseStatus,
        responseData?: object,
        physicalResourceId?: string
    ): Promise<unknown> => {
        return new Promise((resolve) => {
            context.done = resolve;
            sendResponse(event, context, responseStatus, responseData, physicalResourceId);
        });
    };

    try {
        const sourceBucketName = event.ResourceProperties.SourceBucketName;
        const destBucketName = event.ResourceProperties.DestBucketName;
        const sourceKey = event.ResourceProperties.SourceKey;
        const stackUuid = event.ResourceProperties.StackUuid;
        const destKey = `${stackUuid}/${sourceBucketName}/${sourceKey}`;
        const s3 = new S3();

        if (event.RequestType === 'Update') {
            // do not change physical resource id unless success.
            const oldSourceKey = event.OldResourceProperties.SourceKey;
            physicalResourceId = `${stackUuid}/${sourceBucketName}/${oldSourceKey}`;
        }

        if (event.RequestType === 'Delete') {
            await s3.deleteObject({
                Bucket: destBucketName,
                Key: destKey,
            }).promise().catch((err) => {
                if (err.code !== 'AccessDenied' && err.code !== 'NotFound') {
                    throw err;
                }
            });
        }
        else {
            const readStream = s3.getObject({
                Bucket: sourceBucketName,
                Key: sourceKey,
                RequestPayer: 'requester',
            }).createReadStream();

            const errors: Array<Error> = [];
            readStream.on('error', (err) => {
                errors.push(err);
            });

            await s3.upload({
                Bucket: destBucketName,
                Key: destKey,
                Body: readStream,
            }).promise();

            if (errors.length > 0) {
                throw errors[0];
            }
        }

        // all done! (successful) - use new physical resource id.
        physicalResourceId = destKey;
        await sendResponsePromise(
            SUCCESS,
            {
                DestKey: destKey
            },
            physicalResourceId
        );
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);

        await sendResponsePromise(
            FAILED,
            {},
            physicalResourceId
        );
    }
};
