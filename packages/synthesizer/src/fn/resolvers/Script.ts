import {Base} from '../Base';
import {ResolveResult} from '../../Resolver';
import {ParameterCountError} from '../errors/ParameterCountError';
import {ArtifactStore} from '../../index';
import {createHash} from 'crypto';
import {Tokenizer} from '@ddcp/tokenizer';

type IParameters = Array<{Bin: string}>

/**
 * Script copies a script into S3 to reduce the buildspec (and cloudformation) filesize.
 */
export class Script extends Base<unknown, IParameters> {
    constructor(allResolvers: Record<string, Base<unknown, Array<unknown>>>, private readonly artifactStore: ArtifactStore, private readonly tokenizer: Tokenizer) {
        super(allResolvers);
    }

    get name(): string {
        return '!Script';
    }

    resolve(parameters: IParameters, fullValue: Record<string, unknown>): ResolveResult<unknown> {
        if (parameters.length !== 1) {
            throw new ParameterCountError(this.name, 'exactly 1');
        }
        if (parameters[0].Bin === undefined) {
            throw new Error('Bin parameter is missing.');
        }

        const fileHash = createHash('sha1').update(parameters[0].Bin).digest('hex');
        const fileName = `scripts/${fileHash}`;
        this.artifactStore[fileName] = Buffer.from(parameters[0].Bin);

        // May make the resolver support this later if need be, but for now a resolver cannot return unresolved values,
        // so just invoke the other required resolvers directly.
        //
        const s3Path = this.tokenizer.tokenize('s3', this.allResolvers['!Join'].resolve([
            this.allResolvers['!Param'].resolve(['AssetBucketName'], fullValue).value as string,
            `/assets/${fileName}`
        ], fullValue).value as string);

        return {
            value: `aws s3 cp s3://${s3Path} /tmp/${fileHash} && echo '${fileHash} /tmp/${fileHash}' | shasum -c && chmod +x /tmp/${fileHash} && /tmp/${fileHash}`,
            performedWork: true,
        };
    }
}
