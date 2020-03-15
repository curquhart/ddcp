import {isWebhookPayloadPullRequest, isWebhookPayloadPush} from 'github-webhook-validators';
import * as childProcess from 'child_process';
import {dirSync} from 'tmp';
import * as rimraf from 'rimraf';
import * as shellEscape from 'shell-escape';
import {Context} from 'aws-lambda';

const GITHUB_PR_BRANCH_PREFIX = 'github_pr_';
const GITHUB_PR_BRANCH_REGEXP = new RegExp(`^refs/heads/${GITHUB_PR_BRANCH_PREFIX}(\\d+)$`);

const gitSync = (gitDir: string, context: Context, ...cmd: Array<string>): void => {
    const escapedCommand = shellEscape(['git', ...cmd]);

    childProcess.execSync(escapedCommand, {
        cwd: gitDir,
        stdio: 'inherit',
        timeout: Math.floor(context.getRemainingTimeInMillis() - 2000),
    });
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
    gitDir: string;
}

export class Mirror {
    async mirrorBranch(params: MirrorParams, context: Context): Promise<void> {
        const { remoteCommitId, remoteRepositoryCloneUrl, localBranchName, remoteBranchName, exists, gitDir } = params;

        const codeCommitUrl = 'https://git-codecommit.us-west-1.amazonaws.com/v1/repos/ddcp';
        const githubUrl = remoteRepositoryCloneUrl !== undefined ? remoteRepositoryCloneUrl : 'https://github.com/curquhart/ddcp.git';

        console.info(`Mirroring ${githubUrl}@${remoteBranchName} to ${codeCommitUrl}@${localBranchName}`);
        gitSync(gitDir, context, 'version');
        gitSync(gitDir, context, 'init');
        gitSync(gitDir, context, 'remote', 'add', 'aws', codeCommitUrl);

        gitSync(gitDir, context, 'config', `credential.${codeCommitUrl}.helper`, '!/var/task/bin/git-credentials-helper $@');
        gitSync(gitDir, context, 'config', `credential.${codeCommitUrl}.UseHttpPath`, 'true');

        if (exists) {
            gitSync(gitDir, context, 'remote', 'add', 'github', githubUrl);
            gitSync(gitDir, context, 'fetch', 'github', remoteBranchName);
            gitSync(gitDir, context, 'reset', '--hard', remoteCommitId !== undefined ? remoteCommitId : `github/${remoteBranchName}`);
            gitSync(gitDir, context, 'push', 'aws', `HEAD:${localBranchName}`, '--force');
        }
        else {
            gitSync(gitDir, context, 'push', 'aws', `:${localBranchName}`);
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
                    gitDir: tmpDir
                }, context);
            }
            finally {
                rimraf.sync(tmpDir);
            }
        }
        else if (isWebhookPayloadPullRequest(event) && ['opened', 'edited', 'closed', 'reopened'].indexOf(event.action) !== -1) {
            const localBranchName = `${GITHUB_PR_BRANCH_PREFIX}${event.number}`;
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
                    exists: ['opened', 'edited', 'reopened'].indexOf(event.action) !== -1,
                    gitDir: tmpDir
                }, context);
            }
            finally {
                rimraf.sync(tmpDir);
            }
        }
    }
}