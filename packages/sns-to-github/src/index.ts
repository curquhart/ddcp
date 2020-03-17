import {SNSEvent} from 'aws-lambda';
import {Handler} from './Handler';

export const handler = (event: SNSEvent): Promise<void> => new Handler().handle(event);
