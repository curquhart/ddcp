import {Context} from 'aws-lambda';
import {SelectorHandler} from './SelectorHandler';
import {CodeCommitEvent, CodePipelineEvent} from './Events';

export type ArtifactStore = Record<string, Buffer>;

export const handler = async (event: CodeCommitEvent | CodePipelineEvent, context: Context): Promise<void> => new SelectorHandler().handle(event, context);