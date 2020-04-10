process.env.BUILD_VERSION = '0.0.0';
process.env.LAMBDA_DIST_BUCKET_NAME = 'lambdadist';
process.env.CFN_DIST_BUCKET_NAME = 'cfndist';

import '../PublishPipelineStack';

describe('Example test', () => {
    it('is an example test', () => {
        expect(true).toBeTruthy();
    });
});
