import {SNSEvent} from 'aws-lambda';
import {Octokit} from '@octokit/rest';
import {createAppAuth} from '@octokit/auth-app';
import {CodeBuildStatus, Payload} from '@ddcp/sns-models';
import {Resolver} from '@ddcp/secretsmanager';
import {throwError} from '@ddcp/errorhandling';

const resolver = new Resolver();

export class Handler {
    async handle(event: SNSEvent): Promise<void> {
        for (const record of event.Records) {
            const payload = JSON.parse(record.Sns.Message) as Payload;

            if (payload.githubSettings?.auth === undefined) {
                continue;
            }

            const branchName = payload.branchName ?? payload.buildEnvironment?.find((envVar) => envVar.name === 'SOURCE_BRANCH_NAME')?.value;
            const sha = payload.buildEnvironment?.find((envVar) => envVar.name === 'SOURCE_VERSION')?.value ?? null;

            const prefix = 'github_pr_';

            const match = branchName?.match(new RegExp(`${prefix}(?<owner>[^/]+)/(?<repo>[^/]+)/(?<prId>\\d+)$`)) ?? null;

            if (match === null || sha === null) {
                return;
            }

            const {owner, repo} = match.groups as {owner: string; repo: string};

            // Resolve from Secrets Manager
            const authSettings = await resolver.resolve(payload.githubSettings.auth);

            const octokit = new Octokit({
                authStrategy: createAppAuth,
                auth: {
                    id: authSettings.APP_ID ?? throwError(new Error('APP_ID is required.')),
                    privateKey: (authSettings.PRIVATE_KEY ?? throwError(new Error('PRIVATE_KEY is required.'))).replace(/\\n/g, '\n')
                }
            });

            const installation = await octokit.apps.getRepoInstallation({
                owner: owner,
                repo: repo
            });

            const {token} = await octokit.auth({
                type: 'installation',
                installationId: installation.data.id
            }) as { token: string };

            const installationAuthedOctokit = new Octokit({
                auth: token
            });

            let checkStatus: 'in_progress' | 'completed' | undefined = undefined;
            let conclusion: 'success' | 'failure' | 'cancelled' | undefined = undefined;

            switch (payload.buildStatus) {
                case CodeBuildStatus.InProgress:
                    checkStatus = 'in_progress';
                    break;
                case CodeBuildStatus.Failed:
                    conclusion = 'failure';
                    break;
                case CodeBuildStatus.Stopped:
                    conclusion = 'cancelled';
                    break;
                case CodeBuildStatus.Succeeded:
                    conclusion = 'success';
                    break;
                default:
                    throw new Error(`Unrecognized status: ${payload.buildStatus}`);
            }

            const codeBuildLink = `${prefix}codebuild/projects/${payload.projectName}/build/${payload.buildId.split('/').pop()}/log?region=${payload.region}`;

            await installationAuthedOctokit.checks.create({
                owner,
                repo,
                'head_sha': sha,
                'name': 'CodeBuild Status',
                'status': checkStatus,
                'conclusion': conclusion,
                'details_url': codeBuildLink,
            });
        }
    }
}