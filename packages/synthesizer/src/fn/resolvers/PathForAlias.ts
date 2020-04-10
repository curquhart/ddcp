import {Base} from '../Base';
import {ParameterCountError} from '../errors/ParameterCountError';
import {ResolveResult} from '../../Resolver';

type IParameters = Array<string>

export class PathForAlias extends Base<unknown, IParameters> {
    private aliasCache: Record<string, unknown> = {};

    get name(): string {
        return '!PathForAlias';
    }

    resolve(parameters: IParameters, fullValue: unknown): ResolveResult<unknown> {
        if (parameters.length !== 1) {
            throw new ParameterCountError(this.name, 'exactly 1');
        }
        if (typeof parameters[0] !== 'string') {
            throw new Error('Expected a single string parameter.');
        }

        return {
            value: this.resolvePath(parameters[0], fullValue),
            performedWork: true
        };
    }

    private resolvePath(alias: string, input: unknown): unknown {
        if (typeof input !== 'object' || input === null || Array.isArray(input)) {
            throw new TypeError();
        }

        const checkResolved = [input];
        const paths: Array<[unknown, Array<string | number>]> = [];

        if (this.aliasCache[alias] !== undefined) {
            return this.aliasCache[alias];
        }

        // It is possible that something resolved into an alias (well, not currently but it could be in the future.)
        // To handle this, allow us to iterate multiple times when not found.
        while (checkResolved.length > 0) {
            const nextValue = checkResolved.shift();
            const currentPath = [];
            const objPath = paths.map(([obj, path]) => obj === nextValue ? path : undefined).find((path) => path !== undefined);
            if (objPath !== undefined) {
                currentPath.push(...objPath);
            }

            if (Array.isArray(nextValue)) {
                let index = 0;
                for (const entry of nextValue) {
                    paths.push([entry, [...currentPath, index]]);
                    checkResolved.push(entry);
                    index++;
                }
            }
            else if (typeof nextValue === 'object' && nextValue !== null) {
                const currentAlias = (nextValue as Record<string, unknown>)['!Alias'];
                if (typeof currentAlias === 'string') {
                    delete (nextValue as Record<string, unknown>)['!Alias'];
                    this.aliasCache[currentAlias] = currentPath;
                }

                for (const [key, entry] of Object.entries(nextValue)) {
                    paths.push([entry, [...currentPath, key]]);
                    checkResolved.push(entry);
                }
            }
        }

        if (this.aliasCache[alias] !== undefined) {
            return this.aliasCache[alias];
        }

        throw new Error(`Could not resolve ${alias}.`);
    }
}
