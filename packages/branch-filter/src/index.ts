import {Handler} from './Handler';
import {CodeBuildCloudWatchEvent} from '@ddcp/models';

export type ArtifactStore = Record<string, Buffer>;

export const handler = async (event: CodeBuildCloudWatchEvent): Promise<void> => new Handler().handle(event);