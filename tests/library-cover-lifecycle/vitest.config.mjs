export default { test: { include: ['lifecycle.test.js'], environment: 'jsdom', testTimeout: 15000, fileParallelism: false, reporters: ['default', 'json'], outputFile: { json: 'result.json' } } };
