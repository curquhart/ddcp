const fs = require('fs');

// not sure if this mega config for consolidated coverage will end up working out but here's hoping!

const rootPath = `${__dirname}/packages`;
module.exports = {
  roots: [].concat(...fs.readdirSync(rootPath).map((path) => {
    const absPath = `${rootPath}/${path}`;
    if (fs.existsSync(`${absPath}/jest.config.js`)) {
      const jestConfig = require(`${absPath}/jest.config.js`);
      if (jestConfig.roots !== undefined) {
        return jestConfig.roots.map((root) => root.startsWith('/') ?root : `${absPath}/${root}`);
      }
      else {
        return [`${absPath}/src`];
      }
    }
    else if (fs.existsSync(`${absPath}/src`)) {
      console.warn(`${absPath} has no jest configuration.`);
    }
  })).filter((root) => root !== undefined),
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverage: true,
  coverageReporters: ['json', 'html'],
  reporters: [
    'default',
    [
      'jest-junit', {
        outputDirectory: 'reports',
      }
    ]
  ],
  coverageDirectory: 'reports/coverage'
};
