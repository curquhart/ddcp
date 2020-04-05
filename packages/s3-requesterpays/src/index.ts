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
        const bucketName = event.ResourceProperties.BucketName;
        const s3 = new S3();

        if (event.RequestType === 'Update' || event.RequestType === 'Create') {
            physicalResourceId = bucketName;
            await s3.putBucketRequestPayment({
                Bucket: bucketName,
                RequestPaymentConfiguration: {
                    Payer: 'Requester'
                }
            }).promise();
        }

        await sendResponsePromise(
            SUCCESS,
            {},
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
