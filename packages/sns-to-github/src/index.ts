import {Context, SNSEvent} from 'aws-lambda';
import {Handler} from './Handler';

export const handler = (event: SNSEvent, context: Context): Promise<void> => new Handler().handle(event, context);
