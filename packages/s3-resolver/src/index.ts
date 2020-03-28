import {CloudFormationCustomResourceEvent, Context} from 'aws-lambda';
import {S3} from 'aws-sdk';
import {send as sendResponse, SUCCESS, FAILED, ResponseStatus} from 'cfn-response';

// separate from the main handler as this will be inlined and responsible for authorized cross-account fetching.

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
            await s3.copyObject({
                Bucket: destBucketName,
                Key: destKey,
                CopySource: `${sourceBucketName}/${sourceKey}`,
                RequestPayer: 'requester',
                MetadataDirective: 'REPLACE',
                TaggingDirective: 'REPLACE',
            }).promise();
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
