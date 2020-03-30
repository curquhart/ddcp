import {Handler} from './Handler';
import {CodePipelineEvent} from './CodePipelineEvent';
import {Context} from 'aws-lambda';

export const handler = (event: CodePipelineEvent, context: Context): Promise<void> => new Handler().handle(event, context);
