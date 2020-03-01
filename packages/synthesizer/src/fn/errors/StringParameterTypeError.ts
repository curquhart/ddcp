import {ParameterTypeError} from './ParameterTypeError';

export class StringParameterTypeError extends ParameterTypeError {
    constructor(parameterIndex: number) {
        super(parameterIndex, 'must be a string');
    }
}
