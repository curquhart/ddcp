"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const tmp = require("tmp");
const path = require("path");
const yaml = require("js-yaml");
const outFile = process.argv[2];
if (outFile === undefined) {
    throw new Error(`Usage: ${process.argv.join(' ')} output-file`);
}
const outDir = path.dirname(outFile);
const tmpFile = tmp.fileSync();
process.openStdin()
    .pipe(fs.createWriteStream(tmpFile.name))
    .on('finish', () => {
    const yamlString = fs.readFileSync(tmpFile.name).toString();
    fs.unlinkSync(tmpFile.name);
    if (typeof yaml.safeLoad(yamlString) !== 'object') {
        console.error('Invalid YAML received.');
        process.exit(1);
    }
    fs.mkdirSync(outDir, {
        recursive: true
    });
    fs.writeFileSync(outFile, yamlString);
});
