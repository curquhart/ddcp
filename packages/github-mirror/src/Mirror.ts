import {isWebhookPayloadPush} from 'github-webhook-validators';
import * as childProcess from 'child_process';
import {dirSync} from 'tmp';
import * as rimraf from 'rimraf';
import * as shellEscape from 'shell-escape';

const gitSync = (gitDir: string, ...cmd: Array<string>): void => {
    const escapedCommand = shellEscape(['git', ...cmd]);

    childProcess.execSync(escapedCommand, {
        cwd: gitDir,
        stdio: 'inherit',
    });
};

const mkTempDir = (): string => {
    const tempDir = dirSync({
        dir: '/tmp',
    });
    return tempDir.name;
};

export class Mirror {
    async mirrorBranch(branchName: string, exists: boolean, gitDir: string): Promise<void> {
        console.info(`Mirroring ${branchName}`);
        gitSync(gitDir, 'version');
        gitSync(gitDir, 'init');
        const codeCommitUrl = 'https://git-codecommit.us-west-1.amazonaws.com/v1/repos/ddcp';
        gitSync(gitDir, 'remote', 'add', 'aws', codeCommitUrl);

        gitSync(gitDir, 'config', `credential.${codeCommitUrl}.helper`, '!/var/task/bin/git-credentials-helper $@');
        gitSync(gitDir, 'config', `credential.${codeCommitUrl}.UseHttpPath`, 'true');

        if (exists) {
            gitSync(gitDir, 'remote', 'add', 'github', 'https://github.com/curquhart/ddcp.git');
            gitSync(gitDir, 'fetch', 'github', branchName);
            gitSync(gitDir, 'reset', '--hard', `github/${branchName}`);
            gitSync(gitDir, 'push', 'aws', `HEAD:${branchName}`);
        }
        else {
            gitSync(gitDir, 'push', 'aws', `:${branchName}`);
        }
    }

    async handle(event: unknown): Promise<void> {
        if (isWebhookPayloadPush(event) && event.ref.indexOf('refs/heads/') === 0) {
            const tmpDir = mkTempDir();
            try {
                await this.mirrorBranch(event.ref.replace(/^refs\/heads\//, ''), !event.deleted, tmpDir);
            }
            finally {
                rimraf.sync(tmpDir);
            }
        }
    }
}