import * as fs from 'fs';

if (process.argv[2] === undefined || process.argv.length < 4) {
    console.error(`Usage: ${process.argv.join(' ')} file [min=n] [max=n]`);
    process.exit(1);
}
const fileName = fs.realpathSync(process.argv[2]);
const params = process.argv.slice(3);

if (!fs.existsSync(fileName)) {
    console.error(`${fileName} does not exist.`)
    process.exit(1);
}

const stats = fs.statSync(fileName)

params.map((param) => param.split('=')).forEach(([name, val]) => {
    const numericVal = Number(val);

    if (isNaN(numericVal)) {
        console.error('Only numeric parameter values are supported.')
        process.exit(1);
    }
    if (name === 'min') {
        if (stats.size < numericVal) {
            console.error(`${fileName} is too small (${stats.size.toLocaleString()} < ${numericVal.toLocaleString()} bytes).`);
            process.exit(1);
        }
    }
    if (name === 'max') {
        if (stats.size > numericVal) {
            console.error(`${fileName} is too large (${stats.size.toLocaleString()} > ${numericVal.toLocaleString()} bytes).`);
            process.exit(1);
        }
    }
});


// min=1024 max=4096 dist/index.min.js