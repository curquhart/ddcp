module.exports = {
  roots: [
    'src'
  ],
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverage: true,
  coverageReporters: ['json', 'html'],
  coverageDirectory: 'coverage'
};