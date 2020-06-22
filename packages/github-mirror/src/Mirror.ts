import {isWebhookPayloadPullRequest, isWebhookPayloadPush} from 'github-webhook-validators';
import * as childProcess from 'child_process';
import {dirSync} from 'tmp';
import * as rimraf from 'rimraf';
import * as fs from 'fs';
import * as shellEscape from 'shell-escape';
import {Context} from 'aws-lambda';
import {Resolver} from '@ddcp/secretsmanager';
import {info} from '@ddcp/logger';

const GITHUB_PR_BRANCH_PREFIX = 'github_pr_';
const GITHUB_PR_BRANCH_REGEXP = new RegExp(`^refs/heads/${GITHUB_PR_BRANCH_PREFIX}.+/(\\d+)$`);

const execSync = (env: Record<string, string>, cwd: string, context: Context, ...cmd: Array<string>): void => {
    const escapedCommand = shellEscape(cmd);

    childProcess.execSync(escapedCommand, {
        cwd,
        stdio: 'inherit',
        timeout: Math.floor(context.getRemainingTimeInMillis() - 2000),
        env,
    });
};

const gitSync = (env: Record<string, string>, gitDir: string, context: Context, ...cmd: Array<string>): void => {
    return execSync(env, gitDir, context, ...['git', ...cmd]);
};

const mkTempDir = (): string => {
    const tempDir = dirSync({
        dir: '/tmp',
    });
    return tempDir.name;
};

interface MirrorParams {
    localBranchName: string;
    remoteBranchName: string;
    remoteRepositoryCloneUrl?: string;
    remoteCommitId?: string;
    exists: boolean;
    tmpDir: string;
}

// TODO: move github webhook stuff somewhere else, but there is no point until other providers are supported.
export class Mirror {
    async mirrorBranch(params: MirrorParams, context: Context): Promise<void> {
        const { remoteCommitId, remoteRepositoryCloneUrl, localBranchName, remoteBranchName, exists, tmpDir } = params;

        const env: Record<string, string> = {...process.env, TOKENS: ''};
        const resolver = new Resolver();
        await resolver.resolve(env);

        const codeCommitUrl = env.LOCAL_URI;
        const githubUrl = remoteRepositoryCloneUrl !== undefined ? remoteRepositoryCloneUrl : env.REMOTE_URI;
        const privateKey = env.PRIVATE_KEY;
        delete env.PRIVATE_KEY;

        if (codeCommitUrl === undefined) {
            throw new Error('Missing LOCAL_URI environment variable.');
        }

        if (githubUrl === undefined) {
            throw new Error('Missing REMOTE_URI environment variable.');
        }

        const gitDir = `${tmpDir}/git`;
        fs.mkdirSync(gitDir);

        if (privateKey !== undefined) {
            info(context.awsRequestId, 'Private key is provided, configuring environment...');

            // generated via ssh-keyscan -t rsa github.com
            fs.writeFileSync(`${tmpDir}/known_hosts`, 'github.com ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAq2A7hRGmdnm9tUDbO9IDSwBK6TbQa+PXYPCPy6rbTrTtw7PHkccKrpp0yVhp5HdEIcKr6pLlVDBfOLX9QUsyCOV0wzfjIJNlGEYsdlLJizHhbn2mUjvSAHQqZETYP81eFzLQNnPHt4EVVUh7VfDESU84KezmD5QlWpXLmvU31/yMf+Se8xhHTvKSCZIFImWwoG6mbUoWf9nzpIoaSjB+weqqUUmpaaasXVal72J+UX2B+2RPW3RcT0eOzQgqlJL3RKrTJvdsjE3JEAvGq3lGHSZXy28G3skua2SmVi/w4yCE6gbODqnTWlg7+wC604ydGXA8VJiS5ap43JXiUFFAaQ==');

            childProcess.execSync('ssh-agent -s', { encoding: 'utf-8' })
                .split(/[\r\n]+/)
                .forEach((line) => {
                    const parts = line.split('=');
                    if (parts.length === 2) {
                        const name = parts[0];
                        const [value] = parts[1].split(';');
                        env[name.trim()] = value.trim();
                    }
                });

            childProcess.execSync(`echo ${shellEscape([privateKey])} | ssh-add -`, {stdio: 'inherit', env});

            env.GIT_SSH_COMMAND = `ssh -o UserKnownHostsFile=${tmpDir}/known_hosts`;
        }

        info(context.awsRequestId, `Mirroring ${remoteBranchName} from ${githubUrl} to ${localBranchName} at ${codeCommitUrl}`);
        gitSync(env, gitDir, context, 'version');
        gitSync(env, gitDir, context, 'init');
        gitSync(env, gitDir, context, 'remote', 'add', 'aws', codeCommitUrl);

        gitSync(env, gitDir, context, 'config', `credential.${codeCommitUrl}.helper`, '!/var/task/bin/git-credentials-helper $@');
        gitSync(env, gitDir, context, 'config', `credential.${codeCommitUrl}.UseHttpPath`, 'true');

        if (exists) {
            gitSync(env, gitDir, context, 'remote', 'add', 'github', githubUrl);
            gitSync(env, gitDir, context, 'fetch', 'github', remoteBranchName);
            gitSync(env, gitDir, context, 'reset', '--hard', remoteCommitId !== undefined ? remoteCommitId : `github/${remoteBranchName}`);
            gitSync(env, gitDir, context, 'push', 'aws', `HEAD:${localBranchName}`, '--force');
        }
        else {
            gitSync(env, gitDir, context, 'push', 'aws', `:${localBranchName}`);
        }
    }

    async handle(event: unknown, context: Context): Promise<void> {
        if (isWebhookPayloadPush(event) && event.ref.indexOf('refs/heads/') === 0  && event.ref.match(GITHUB_PR_BRANCH_REGEXP) === null) {
            const tmpDir = mkTempDir();
            const branchName = event.ref.replace(/^refs\/heads\//, '');

            try {
                await this.mirrorBranch({
                    localBranchName: branchName,
                    remoteBranchName: branchName,
                    exists: !event.deleted,
                    tmpDir: tmpDir
                }, context);
            }
            finally {
                rimraf.sync(tmpDir);
            }
        }
        else if (isWebhookPayloadPullRequest(event) && ['opened', 'synchronize', 'closed', 'reopened'].indexOf(event.action) !== -1) {
            const localBranchName = `${GITHUB_PR_BRANCH_PREFIX}${event.pull_request.base.repo.full_name}/${event.number}`;
            const remoteRepositoryCloneUrl = event.pull_request.head.repo.clone_url;
            const remoteBranchName = event.pull_request.head.ref;
            const remoteCommitId = event.pull_request.head.sha;

            const tmpDir = mkTempDir();
            try {
                await this.mirrorBranch({
                    localBranchName,
                    remoteBranchName,
                    remoteRepositoryCloneUrl,
                    remoteCommitId,
                    exists: ['opened', 'synchronize', 'reopened'].indexOf(event.action) !== -1,
                    tmpDir: tmpDir
                }, context);
            }
            finally {
                rimraf.sync(tmpDir);
            }
        }
        else {
            info(context.awsRequestId, `Unrecognized event: ${JSON.stringify(event)}`);
        }
    }
}