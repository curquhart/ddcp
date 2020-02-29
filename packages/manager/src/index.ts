import {App} from '@aws-cdk/core';
import {ManagerStack} from './ManagerStack';

const app = new App();

new ManagerStack(app, 'ddcpmanager');
