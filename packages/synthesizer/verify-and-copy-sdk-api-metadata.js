// sdk-api-metadata.json is required by a couple cdk modules. Currently, it is the same in all of them, and I assume
// that it always will be, but for sanity, find all versions of this file in CDK, compare them, and error if any are
// different. If they do change, we will need another bundling strategy. Unfortunately, we do need to minify due to
// lambda size limitations, but we may be able to minify on a per-file basis.

// Note that this file (at the time of writing) is the one that the customresource module uses, and as such is only
// an issue there, but I have no reason to believe this won't change.

const fs = require('fs');
const glob = require('glob');

const pattern = 'node_modules/@aws-cdk/**/sdk-api-metadata.json';

console.info(`Searching for ${pattern}`);
let currentFile = null;
let currentFileName = null;

for (const nextFileName of glob.sync(pattern)) {
    console.info(`Found ${nextFileName}`);
    const nextFile = fs.readFileSync(nextFileName).toString();
    if (currentFile !== null && currentFile !== nextFile) {
        console.error(`Contents of ${nextFileName} != contents of ${currentFileName}.`);
        process.exit(1);
    }
    currentFile = nextFile;
    currentFileName = nextFileName;
}

if (currentFile !== null) {
    fs.writeFileSync('dist/sdk-api-metadata.json', currentFile);
}
else {
    console.warn(`No matches found for ${pattern}!`);
}
