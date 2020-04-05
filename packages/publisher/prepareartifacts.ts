import {InputArtifacts, LambdaInputArtifacts} from '@ddcp/module-collection';
import * as AdmZip from 'adm-zip';
import * as fs from 'fs';
import {errorLogger, infoLogger} from '@ddcp/logger';

// (1) Check dependencies
// eslint-disable-next-line @typescript-eslint/no-var-requires
const packageJson = require('./package.json');
const allArtifacts = Object.assign({}, LambdaInputArtifacts, InputArtifacts);
infoLogger('Checking artifacts...')
for (const [ moduleName, artifactFn ] of Object.entries(allArtifacts)) {
    if (packageJson.dependencies[moduleName] === undefined && packageJson.devDependencies[moduleName] === undefined) {
        errorLogger(`${artifactFn} [NOT DEPENDENCY]`);
        // eslint-disable-next-line no-process-exit
        process.exit(1);
    }

    if (!fs.existsSync(artifactFn)) {
        errorLogger(`${artifactFn} [NOT FOUND]`);
        // eslint-disable-next-line no-process-exit
        process.exit(1);
    }
    else {
        infoLogger(`${artifactFn} [OK]`);
    }
}

// (2) Prepare bundles
const lambdasOutFile = 'dist/dist-lambdas.zip';
if (fs.existsSync(lambdasOutFile)) {
    fs.unlinkSync(lambdasOutFile);
}
const managerOutFile = 'dist/dist-manager.zip';
if (fs.existsSync(managerOutFile)) {
    fs.unlinkSync(managerOutFile);
}

infoLogger('Creating lambdas zip...')
const lambdaZip = new AdmZip();
for (const artifactFn of Object.values(LambdaInputArtifacts)) {
    infoLogger(`Adding ${artifactFn}...`)
    lambdaZip.addLocalFile(artifactFn);
}
infoLogger(`Writing ${lambdasOutFile}...`)
lambdaZip.writeZip(lambdasOutFile);

infoLogger('Creating manager zip...')
const managerZip = new AdmZip();
for (const artifactFn of Object.values(InputArtifacts)) {
    infoLogger(`Adding ${artifactFn}...`)
    managerZip.addLocalFile(artifactFn);
}
infoLogger(`Writing ${managerOutFile}...`)
managerZip.writeZip(managerOutFile);
