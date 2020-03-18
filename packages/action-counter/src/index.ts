import {CodePipelineEvent, Context} from 'aws-lambda';
import {Handler} from './Handler';

export const handler = (event: CodePipelineEvent, context: Context): Promise<void> => new Handler().safeHandle(event, context);