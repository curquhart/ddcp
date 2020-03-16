import * as escapeStringRegexp from 'escape-string-regexp';

export interface Token {
    value: string;
    token: string;
}

const isString = (value: unknown): value is string => {
    return typeof value === 'string';
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isArray = (value: unknown): value is Array<unknown> => {
    return typeof value === 'object' && value !== null && Array.isArray(value);
};

export class Tokenizer {
    private counter = 0;

    constructor(private readonly tokens: Record<string, string> = {}) {
    }

    private getValueFromKey(key: string, type: string): string | undefined {
        const typePrefix = `${type.replace(/:/g, '-:-')}::`;
        if (key.indexOf(typePrefix) === 0) {
            return key.substr(typePrefix.length);
        }
        return undefined;
    }

    tokenize(type: string, value: string): string {
        const key = `${type.replace(/:/g, '-:-')}::${value}`;
        if (this.tokens[key] !== undefined) {
            return this.tokens[key];
        }

        const token = `{TOKEN::${key}::${this.counter++}}`;
        this.tokens[key] = token;
        return token;
    }

    getAllTokens(type: string, data: unknown): Record<string, Token> {
        const tokens: Record<string, Token> = {};

        if (isString(data)) {
            for (const [ key, token ] of Object.entries(this.tokens)) {
                const value = this.getValueFromKey(key, type);

                if (value !== undefined && data.indexOf(token) !== -1) {
                    tokens[key] = {
                        token,
                        value,
                    };
                }
            }
        }
        else if (isArray(data)) {
            if (Array.isArray(data)) {
                for (let index = 0; index < data.length; index++) {
                    Object.assign(tokens, this.getAllTokens(type, data[index]));
                }
            }
        }
        else if (isRecord(data)) {
            for (const entry of Object.values(data)) {
                Object.assign(tokens, this.getAllTokens(type, entry));
            }
        }

        return tokens;
    }

    /**
     * Finds tokens within the provided data.
     * @param type The type of token to resolve.
     * @param data The data to scan.
     * @param resolver The resolver.
     */
    async resolveAllTokens<T extends string | Record<string, unknown> | Array<unknown> | unknown>(
        type: string,
        data: T,
        resolver: (token: string, value: string) => unknown | Promise<unknown>
    ): Promise<T> {
        if (isString(data)) {
            const strData = data as string;

            for (const [ key, token ] of Object.entries(this.tokens)) {
                const value = this.getValueFromKey(key, type);

                if (value !== undefined && strData.indexOf(token) !== -1) {
                    const resolved = await resolver(token, value);
                    if (data === token) {
                        return resolved as T;
                    }
                    if (typeof resolved !== 'string') {
                        throw new Error('Only strings can be inlined within strings.');
                    }

                    data = strData.replace(new RegExp(escapeStringRegexp(token), 'g'), resolved) as T;
                }
            }
        }
        else if (isArray(data)) {
            const arrData = data;

            for (let index = 0; index < arrData.length; index++) {
                arrData[index] = await this.resolveAllTokens(type, arrData[index], resolver);
            }
        }
        else if (isRecord(data)) {
            const recData = data as Record<string, unknown>;

            for (const [key, entry] of Object.entries(recData)) {
                recData[key] = await this.resolveAllTokens(type, entry, resolver);
            }
        }

        return data;
    }
}