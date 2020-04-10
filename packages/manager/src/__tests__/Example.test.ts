process.env.BUILD_VERSION = '0.0.0';
process.env.LAMBDA_DIST_BUCKET_NAME = 'lambdadist';

import '..';

describe('Example test', () => {
    it('is an example test', () => {
        expect(true).toBeTruthy();
    });
});
