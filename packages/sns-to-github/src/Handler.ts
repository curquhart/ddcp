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

            if (sha === null) {
                console.info('Source version missing so ignoring...');
                return;
            }

            console.info(`Got source version: ${sha}`);

            const prefix = 'github_pr_';

            const match = branchName?.match(new RegExp(`${prefix}(?<owner>[^/]+)/(?<repo>[^/]+)/(?<prId>\\d+)$`)) ?? {
                groups: {
                    owner: payload.githubSettings.defaults?.owner,
                    repo: payload.githubSettings.defaults?.repo,
                }
            };

            if (match === null) {
                return;
            }

            const {owner, repo} = match.groups as {owner: string; repo: string};

            if (owner === undefined || repo === undefined) {
                console.info(`Unknown owner/repo. Defaults: ${payload.githubSettings.defaults}`);
                return;
            }
            console.info(`Owner = ${owner} Repo = ${repo} Sha = ${sha}`);

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

            const codeBuildLink = `https://${payload.region}.console.aws.amazon.com/codesuite/codebuild/projects/${payload.projectName}/build/${payload.buildId.split('/').pop()}/log?region=${payload.region}`;

            console.info(`Creating check on ${owner}/${repo} for ${sha}: status = ${checkStatus} conclusion = ${conclusion} cblink = ${codeBuildLink}`);
            await installationAuthedOctokit.checks.create({
                owner,
                repo,
                'head_sha': sha,
                'name': 'CodeBuild',
                'status': checkStatus,
                'conclusion': conclusion,
                'details_url': codeBuildLink,
            });
        }
    }
}
