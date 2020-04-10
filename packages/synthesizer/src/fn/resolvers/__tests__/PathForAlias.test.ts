import {PathForAlias} from '../PathForAlias';

describe('PathForAlias test', () => {
    it('reports error if parameters are incorrect', () => {
        const resolver = new PathForAlias({});

        expect(() => resolver.resolve([], {})).toThrow('Incorrect number of parameters for !PathForAlias: Expected exactly 1 parameters.');
        expect(() => resolver.resolve(['foo', 'bar'], {})).toThrow('Incorrect number of parameters for !PathForAlias: Expected exactly 1 parameters.');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(() => resolver.resolve([{} as any], {})).toThrow('Expected a single string parameter.');
    });

    it('reports error if lookup failed', () => {
        const resolver = new PathForAlias({});

        expect(() => resolver.resolve(['foo'], {})).toThrow('Could not resolve foo.');
    });

    it('reports error if input is non-object', () => {
        const resolver = new PathForAlias({});

        expect(() => resolver.resolve(['foo'], [])).toThrow(new TypeError());
        expect(() => resolver.resolve(['foo'], null)).toThrow(new TypeError());
        expect(() => resolver.resolve(['foo'], 'foo')).toThrow(new TypeError());
        expect(() => resolver.resolve(['foo'], 123)).toThrow(new TypeError());
    });

    it('resolves successfully', () => {
        const resolver = new PathForAlias({});

        const input = { '!Alias': 'foo', foo: 'bar' };
        expect(resolver.resolve(['foo'], input).value).toEqual([]);
    });

    it('deletes Alias after resolution', () => {
        const resolver = new PathForAlias({});

        const input = {
            '!Alias': 'foo',
            bar: 'baz',
        };
        expect(resolver.resolve(['foo'], input).value).toEqual([]);
        expect(input).toEqual({bar: 'baz'});
        // should be cached
        expect(resolver.resolve(['foo'], input).value).toEqual([]);
    });

    it('resolves within array', () => {
        const resolver = new PathForAlias({});

        const input = {
            foo: [
                {
                    '!Alias': 'foo',
                    bar: 'baz',
                }
            ],
        };
        expect(resolver.resolve(['foo'], input).value).toEqual(['foo', 0]);
    });

    it('resolves within object', () => {
        const resolver = new PathForAlias({});

        const input = {
            foo: {
                bar: {
                    '!Alias': 'foo',
                    bar: 'baz',
                }
            },
        };
        expect(resolver.resolve(['foo'], input).value).toEqual(['foo', 'bar']);
    });
});
