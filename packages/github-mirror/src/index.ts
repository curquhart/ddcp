import {Mirror} from './Mirror';
import {Context} from 'aws-lambda';

export const handler = (event: unknown, context: Context): Promise<void> => new Mirror().handle(event, context);
