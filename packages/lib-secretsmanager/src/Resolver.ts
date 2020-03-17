import {Tokenizer} from '@ddcp/tokenizer';
import {SecretsManager} from 'aws-sdk';

export class Resolver {
    async resolve<T>(
        payload: T,
        tokenizer?: Tokenizer
    ): Promise<T> {
        if (tokenizer === undefined) {
            if (process.env.TOKENS === undefined) {
                tokenizer = new Tokenizer();
            }
            else {
                tokenizer = new Tokenizer(JSON.parse(process.env.TOKENS));
            }
        }
        return await tokenizer.resolveAllTokens('secret', payload, async (token: string, value: string) => {
            const secretsManager = new SecretsManager();
            const secretValue = await secretsManager.getSecretValue({
                SecretId: value
            }).promise();

            const resolved = secretValue.SecretString ?? Buffer.from(secretValue.SecretBinary?.toString() ?? '', 'base64').toString();

            if (resolved.startsWith('{') && resolved.endsWith('}')) {
                try {
                    return JSON.parse(resolved);
                } catch (err) {
                    return resolved;
                }
            }

            return resolved;
        });
    }
}
