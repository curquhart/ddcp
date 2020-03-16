import * as https from 'https';
import {SNSEvent} from 'aws-lambda';
import {Tokenizer} from '@ddcp/tokenizer';
import {SecretsManager} from 'aws-sdk';

// Derived from https://www.scrivito.com/posting-form-content-to-a-slack-channel-via-an-aws-lambda-function-e73e3fb7a95c76f3

// "contactRequest" Lambda (node.js based):

// jsmin corrupts template literals sometimes so we have to just append strings like animals (specifically at L65 at the time of writing). TODO: use better minifier.

type Status = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'STOPPED';

interface StatusSetting {
    emoji?: string;
}

interface EnvVar {
    name?: string;
    value?: string;
}

interface Payload {
    buildStatus: Status;
    projectName: string;
    repositoryName: string;
    branchName?: string;
    buildId: string;
    region: string;
    icon: string;
    buildEnvironment?: Array<EnvVar>;
    slackSettings: Array<{
        uri: string;
        channel: string;
        username: string;
        statuses?: Record<string, StatusSetting>;
    }>;
}

const EMOJIS = {
    IN_PROGRESS: ':cold_sweat:',
    SUCCEEDED: ':white_check_mark:',
    FAILED: ':small_red_triangle:',
    STOPPED: ':red_circle:',
};

const toWords = (value: string): string => {
    return value.replace(/[a-zA-Z0-9]+/g, (match) => {
        return match[0].toUpperCase() + match.substr(1).toLowerCase();
    }).replace(/[^a-zA-Z0-9]+/, ' ');
};

const tokenizer = new Tokenizer(JSON.parse(process.env.TOKENS !== undefined ? process.env.TOKENS : '{}') ?? {});

export const handler = async (event: SNSEvent): Promise<void> => {
    for (const record of event.Records) {
        const payload = JSON.parse(record.Sns.Message) as Payload;

        // Resolve from Secrets Manager
        payload.slackSettings = await tokenizer.resolveAllTokens('secret', payload.slackSettings, async (token: string, value: string) => {
            const secretsManager = new SecretsManager();
            const secretValue = await secretsManager.getSecretValue({
                SecretId: value
            }).promise();

            return secretValue.SecretString ?? Buffer.from(secretValue.SecretBinary?.toString() ?? '', 'base64').toString();
        });

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

            const prefix = 'https://' + payload.region + '.console.aws.amazon.com/codesuite/';
            const codeCommitLink = prefix + 'codecommit/repositories/' + payload.repositoryName + '/browse/refs/heads/' + branchName + '?region=' + payload.region;
            const codeBuildLink = prefix + 'codebuild/projects/' + payload.projectName + '/build/' + payload.buildId.split('/').pop() + '/log?region=' + payload.region;

            const normalizedStatus = toWords(payload.buildStatus);

            let emoji = EMOJIS[payload.buildStatus];
            if (
                slackSettings.statuses !== undefined &&
                slackSettings.statuses[payload.buildStatus] !== undefined &&
                slackSettings.statuses[payload.buildStatus].emoji !== undefined
            ) {
                emoji = slackSettings.statuses[payload.buildStatus]?.emoji as string;
            }

            const slackPayload = 'payload=' + encodeURIComponent(JSON.stringify({
                text: emoji + ' Build <' + codeBuildLink + '|' + ' ' + normalizedStatus + '> <' + codeCommitLink + '|' + payload.repositoryName + '>',
                'icon_emoji': ':gear:',
                channel: slackSettings.channel,
                username: slackSettings.username,
            }));

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
