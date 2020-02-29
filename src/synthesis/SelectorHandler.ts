import {CloudWatchEvents, CodeCommit, CodePipeline} from 'aws-sdk';
import {CodeCommitEvent} from './CodeCommitEvent';
import {tOrDefault} from './SynthesisStack';

export class SelectorHandler {
    async handle(event: CodeCommitEvent): Promise<void> {
        const cc = new CodeCommit();

        const inputFile = event.detail.inputFile;

        let isPipelineInputChange = false;
        let nextToken: string | undefined = undefined;
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
                    const beforePath = difference.beforeBlob !== undefined ? difference['beforeBlob']['path'] : null;
                    const afterPath = difference.afterBlob !== undefined ? difference['afterBlob']['path'] : null;

                    if (beforePath !== inputFile && afterPath !== inputFile) {
                        continue;
                    }

                    if (beforePath !== null && beforePath !== afterPath) {
                        console.warn(`WARN: ${inputFile} was renamed from ${beforePath} to ${afterPath}`);
                    }

                    if (afterPath === inputFile) {
                        isPipelineInputChange = true;
                    }
                }
            }

        } while (nextToken !== undefined && !isPipelineInputChange);

        if (isPipelineInputChange) {
            const cp = new CodePipeline();
            await cp.startPipelineExecution({
                name: event.detail.pipelineName,
                clientRequestToken: event.detail.commitId
            }).promise();
        }
        else {
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
                        state: 'SUCCEEDED'
                    })
                }],
            }).promise();

            for (const resItem of tOrDefault(res.Entries, [])) {
                if (resItem.ErrorCode !== undefined) {
                    console.error(`Failed to publish event: errno=${resItem.ErrorCode} err=${resItem.ErrorMessage}`);
                }
            }
        }
    }
}
