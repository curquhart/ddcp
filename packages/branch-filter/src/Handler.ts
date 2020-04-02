import {CodeBuildCloudWatchEvent} from '@ddcp/models';
import {CodeBuild} from 'aws-sdk';

export class Handler {
    async handle(event: CodeBuildCloudWatchEvent): Promise<void> {
        if (event.branchPattern === undefined || new RegExp(event.branchPattern).test(event.branchName)) {
            const cbClient = new CodeBuild();
            await cbClient.startBuild({
                projectName: event.projectName,
                environmentVariablesOverride: event.environmentVariablesOverride,
                sourceVersion: event.sourceVersion,
            }).promise();
        }
    }
}
