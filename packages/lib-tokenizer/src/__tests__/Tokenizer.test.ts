import {Tokenizer} from '../Tokenizer';

describe('Tokenizer class', () => {
    describe('strings', () => {
        it('returns the exact value from the tokenizer when the input is a known token', async () => {
            const tokens = {
                'type::a': 'b'
            };

            const tokenizer = new Tokenizer(tokens);
            const resolved = await tokenizer.resolveAllTokens('type', 'b', () => 'res');
            expect(resolved).toBe('res');
        });

        it('returns the replaced value from the tokenizer when the input contains a known token', async () => {
            const tokens = {
                'type::a': 'b'
            };

            const tokenizer = new Tokenizer(tokens);
            const resolved = await tokenizer.resolveAllTokens('type', 'abc', () => 'res');
            expect(resolved).toBe('aresc');
        });

        it('does not modify value when token does not match', async () => {
            const tokens = {
                'type::a': 'b'
            };

            const tokenizer = new Tokenizer(tokens);
            const resolved = await tokenizer.resolveAllTokens('type', 'ac', () => 'res');
            expect(resolved).toBe('ac');
        });

        it('replaces all instances of a duplicated token', async () => {
            const tokens = {
                'type::a': 'b'
            };

            const tokenizer = new Tokenizer(tokens);
            const resolved = await tokenizer.resolveAllTokens('type', 'abcb', () => 'res');
            expect(resolved).toBe('arescres');
        });

        it('forwards an exception thrown by the resolver', async () => {
            const tokens = {
                'type::a': 'b'
            };

            const tokenizer = new Tokenizer(tokens);

            await expect(tokenizer.resolveAllTokens('type', 'b', () => {
                throw new Error('testerr');
            })).rejects.toThrow('testerr');
        });
    });
});
