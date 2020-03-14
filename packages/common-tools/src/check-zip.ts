import * as childProcess from 'child_process';
import * as fs from 'fs';

const fileRegexp = /^\s*(\d+)\s+\d[\d-]+ [\d:]+\s+(.+)$/

const files: Record<string, number> = {}

if (process.argv[2] === undefined || process.argv.length < 4) {
    console.error(`Usage: ${process.argv.join(' ')} zip-file ...filenames`);
    process.exit(1);
}
const zipFileName = fs.realpathSync(process.argv[2]);
const fileNames = process.argv.slice(3);

childProcess.execSync(`unzip -l '${zipFileName}'`)
    .toString().split(/[\r\n]+/)
    .map((line) => line.match(fileRegexp))
    .filter((matchResult) => matchResult !== null)
    .forEach((matchResult) => {
        const [_, fileSize, fileName] = matchResult as RegExpMatchArray;
        files[fileName] = Number(fileSize);
    });

for (const fn of fileNames) {
    if (isNaN(files[fn]) || files[fn] === 0) {
        console.error(`${fn} is required and must be > 0 bytes.`);
        process.exit(1);
    }
    else {
        console.info(`${fn}: ${files[fn].toLocaleString()} bytes`);
    }
}
