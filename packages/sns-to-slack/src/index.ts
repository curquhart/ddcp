import * as https from 'https';
import {SNSEvent} from 'aws-lambda';
import {Payload} from '@ddcp/sns-models';
import {Resolver} from '@ddcp/secretsmanager';
import {toWords} from '@ddcp/stringutils';

// Derived from https://www.scrivito.com/posting-form-content-to-a-slack-channel-via-an-aws-lambda-function-e73e3fb7a95c76f3

// "contactRequest" Lambda (node.js based):

const EMOJIS = {
    IN_PROGRESS: ':cold_sweat:',
    SUCCEEDED: ':white_check_mark:',
    FAILED: ':small_red_triangle:',
    STOPPED: ':red_circle:',
};

const resolver = new Resolver();

export const handler = async (event: SNSEvent): Promise<void> => {
    for (const record of event.Records) {
        const payload = JSON.parse(record.Sns.Message) as Payload;

        if (payload.slackSettings === undefined) {
            continue;
        }

        // Resolve from Secrets Manager
        payload.slackSettings = await resolver.resolve(payload.slackSettings);

        for (const slackSettings of payload.slackSettings) {
            const match = slackSettings.uri.match(/^https:\/\/([^/]+)(\/.*)?$/);
            if (match === null || match === undefined) {
                throw new Error('Invalid uri.');
            }

            const options: https.RequestOptions = {
                hostname: match[1],
                path: match[2],
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            };

            const branchName = payload.branchName ?? payload.buildEnvironment?.find((envVar) => envVar.name === 'SOURCE_BRANCH_NAME')?.value;

            const prefix = `https://${payload.region}.console.aws.amazon.com/codesuite/`;
            const codeCommitLink = `${prefix}codecommit/repositories/${payload.repositoryName}/browse/refs/heads/${branchName}?region=${payload.region}`;
            const codeBuildLink = `${prefix}codebuild/projects/${payload.projectName}/build/${payload.buildId.split('/').pop()}/log?region=${payload.region}`;

            const normalizedStatus = toWords(payload.buildStatus);

            let emoji = EMOJIS[payload.buildStatus];
            if (
                slackSettings.statuses !== undefined &&
                slackSettings.statuses[payload.buildStatus] !== undefined &&
                slackSettings.statuses[payload.buildStatus].emoji !== undefined
            ) {
                emoji = slackSettings.statuses[payload.buildStatus]?.emoji as string;
            }

            const slackPayload = `payload=${encodeURIComponent(JSON.stringify({
                text: `${emoji} Build <${codeBuildLink}|${normalizedStatus}> <${codeCommitLink}|${payload.repositoryName}>`,
                'icon_emoji': ':gear:',
                channel: slackSettings.channel,
                username: slackSettings.username,
            }))}`;

            await new Promise((resolve, reject) => {
                const req = https.request(options, (res) => {
                    res.resume();
                    res.on('data', (chunk) => {
                        if (res.statusCode !== 200) {
                            reject(new Error(chunk.toString()));
                        }
                        else {
                            resolve();
                        }
                    });
                }).on('error', reject);
                req.write(slackPayload);
                req.end();
            });
        }
    }
};
