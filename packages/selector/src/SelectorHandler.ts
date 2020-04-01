import {CloudWatchEvents, CodeCommit, CodePipeline, DynamoDB} from 'aws-sdk';
import {tOrDefault} from '@ddcp/typehelpers';
import {error, info, warn} from '@ddcp/logger';
import {Context} from 'aws-lambda';
import {throwError} from '@ddcp/errorhandling';
import {BaseEvent, CodeCommitEvent, CodePipelineEvent} from './Events';
import {SynthesizedEvent, SynthesizedEventDetail} from '@ddcp/models';

const isCodePipelineEvent = (event: BaseEvent): event is CodePipelineEvent => {
    return event.source === 'aws.codepipeline';
};

export class SelectorHandler {
    async handle(event: CodeCommitEvent | CodePipelineEvent, context: Context): Promise<void> {
        if (isCodePipelineEvent(event)) {
            await this.handleCodePipeline(event, context);
        }
        else {
            await this.handleCodeCommit(event, context);
        }
    }

    async handleCodePipeline(event: CodePipelineEvent, context: Context): Promise<void> {
        const executionId = event.detail.executionId;

        const dynamodb = new DynamoDB();
        const item = await dynamodb.getItem({
            TableName: event.detail.executionsTableName,
            Key: {
                executionId: {
                    S: executionId,
                },
            }
        }).promise();

        const cw = new CloudWatchEvents();

        info(context.awsRequestId, 'Emitting CodePipeline Pipeline Finished event.');

        await cw.putEvents({
            Entries: [{
                EventBusName: event.detail.eventBusName,
                Resources: [
                    event.detail.pipelineArn,
                    event.detail.repositoryArn,
                ],
                DetailType: 'CodePipeline Pipeline Finished',
                Source: 'synth.codepipeline',
                Detail: JSON.stringify({
                    pipeline: event.detail.pipelineName,
                    commitId: item.Item?.commitId.S,
                    referenceType: item.Item?.referenceType.S,
                    referenceName: item.Item?.referenceName.S,
                    state: 'SUCCEEDED',
                    filesChanged: item.Item?.filesChanged.SS,
                } as SynthesizedEventDetail)
            } as SynthesizedEvent],
        }).promise();
    }

    async handleCodeCommit(event: CodeCommitEvent, context: Context): Promise<void> {
        const cc = new CodeCommit();

        const inputFiles = event.detail.inputFiles;

        let isSynthPipelineInputChange = false;
        let nextToken: string | undefined = undefined;
        const filesChanged: Array<string> = [];
        do {
            const diff: CodeCommit.GetDifferencesOutput = await cc.getDifferences({
                repositoryName: event.detail.repositoryName,
                beforeCommitSpecifier: event.detail.oldCommitId,
                afterCommitSpecifier: event.detail.commitId,
                NextToken: nextToken
            }).promise();

            nextToken = diff.NextToken;
            if (diff.differences !== undefined) {
                for (const difference of diff.differences) {
                    const beforePath = difference.beforeBlob?.path ?? '';
                    const afterPath = difference.afterBlob?.path ?? '';

                    if (beforePath !== '' && filesChanged.indexOf(beforePath) === -1) {
                        filesChanged.push(beforePath);
                    }
                    if (afterPath !== '' && filesChanged.indexOf(afterPath) === -1) {
                        filesChanged.push(afterPath);
                    }

                    if ((beforePath === '' || inputFiles.indexOf(beforePath) === -1) && (afterPath === '' || inputFiles.indexOf(afterPath) === -1)) {
                        continue;
                    }

                    if (beforePath !== '' && beforePath !== afterPath) {
                        warn(context.awsRequestId, `${beforePath} was renamed to ${afterPath}`);
                    }

                    isSynthPipelineInputChange = true;
                }
            }

        } while (nextToken !== undefined);

        if (isSynthPipelineInputChange) {
            const cp = new CodePipeline();
            const dynamodb = new DynamoDB();
            const executionId = (await cp.startPipelineExecution({
                name: event.detail.pipelineName,
                clientRequestToken: event.detail.commitId
            }).promise()).pipelineExecutionId ?? throwError(new Error('Did not receive execution Id.'));
            await dynamodb.putItem({
                TableName: event.detail.executionsTableName,
                Item: {
                    executionId: {
                        S: executionId,
                    },
                    filesChanged: {
                        SS: filesChanged,
                    },
                    commitId: {
                        S: event.detail.commitId,
                    },
                    referenceType: {
                        S: event.detail.referenceType,
                    },
                    referenceName: {
                        S: event.detail.referenceName,
                    },
                    expiryTimestamp: {
                        N: `${Math.round(new Date().getTime() / 1000) + 86400}`,
                    }
                }
            }).promise();
        }
        else {
            info(context.awsRequestId, 'Emitting CodePipeline Pipeline Skipped event.');
            const cw = new CloudWatchEvents();

            const res = await cw.putEvents({
                Entries: [{
                    EventBusName: event.detail.eventBusName,
                    Resources: [
                        event.detail.pipelineArn,
                        event.detail.repositoryArn,
                    ],
                    DetailType: 'CodePipeline Pipeline Skipped',
                    Source: 'synth.codepipeline',
                    Detail: JSON.stringify({
                        pipeline: event.detail.pipelineName,
                        commitId: event.detail.commitId,
                        referenceType: event.detail.referenceType,
                        referenceName: event.detail.referenceName,
                        state: 'SUCCEEDED',
                        filesChanged,
                    } as SynthesizedEventDetail)
                } as SynthesizedEvent],
            }).promise();

            for (const resItem of tOrDefault(res.Entries, [])) {
                if (resItem.ErrorCode !== undefined) {
                    error(context.awsRequestId, `Failed to publish event: errno=${resItem.ErrorCode} err=${resItem.ErrorMessage}`);
                }
            }
        }
    }
}
