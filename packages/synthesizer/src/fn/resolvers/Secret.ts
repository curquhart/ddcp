import {Base} from '../Base';
import {ResolveResult} from '../../Resolver';
import {ParameterCountError} from '../errors/ParameterCountError';
import {Tokenizer} from '../../../../lib-tokenizer';

type IParameters = Array<string>

export class Secret extends Base<unknown, IParameters> {
    constructor(allResolvers: Record<string, Base<unknown, Array<unknown>>>, private readonly tokenizer: Tokenizer) {
        super(allResolvers);
    }

    get name(): string {
        return '!Secret';
    }

    resolve(parameters: IParameters): ResolveResult<unknown> {
        if (parameters.length !== 1) {
            throw new ParameterCountError(this.name, 'exactly 1');
        }

        return {
            value: this.tokenizer.tokenize('secret', parameters[0]),
            performedWork: true
        };
    }
}
