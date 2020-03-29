import * as aws4 from 'aws4';
import {errorLogger} from '@ddcp/logger';

const re = /^([^=]+)=(.*)$/gm;

const region = process.env.AWS_REGION;
if (region === undefined) {
    throw new Error('Could not determine region.');
}

const main = async(): Promise<void> => {
    let input = Buffer.from('');

    if (process.argv[2] !== 'get') {
        return;
    }

    process.stdin.on('data', function (chunk) {
        input = Buffer.concat([input, chunk]);
    });
    process.stdin.resume();

    await new Promise((resolve, reject) => {
        process.stdin.on('end', resolve);
        process.stdin.on('error', reject);
    });

    const inputStr = input.toString();
    let match: RegExpMatchArray | null = null;
    const params: Record<string, string> = {};
    do {
        match = re.exec(inputStr);
        if (match !== null) {
            params[match[1]] = match[2];
        }
    } while (match !== null);

    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const sessionToken = process.env.AWS_SESSION_TOKEN;

    const signer = new aws4.RequestSigner({
        host: params.host,
        path: params.path,
        method: 'GIT',
        service: 'codecommit',
    }, {
        accessKeyId,
        secretAccessKey,
        sessionToken,
    });

    process.stdout.write(`username=${accessKeyId}${sessionToken !== undefined ? `%${sessionToken}` : ''}\n`);
    process.stdout.write(`password=${signer.getDateTime()}Z${signer.signature()}\n`);
};

main()
.catch((err) => {
    errorLogger(err);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
});
