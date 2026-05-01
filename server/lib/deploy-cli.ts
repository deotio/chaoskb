#!/usr/bin/env node

import { App } from 'aws-cdk-lib';
import { ChaosKBStack } from './chaoskb-stack.js';

function parseArgs(argv: string[]): { region: string; environment: string } {
  const args = argv.slice(2);
  let region = 'us-east-1';
  let environment = 'self-hosted';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--region' && args[i + 1]) {
      region = args[i + 1];
      i++;
    } else if (args[i] === '--environment' && args[i + 1]) {
      environment = args[i + 1];
      i++;
    }
  }

  return { region, environment };
}

function main(): void {
  const { region, environment } = parseArgs(process.argv);

  const app = new App();

  new ChaosKBStack(app, `ChaosKB-${environment}`, {
    environment,
    env: {
      region,
      account: process.env['CDK_DEFAULT_ACCOUNT'],
    },
  });

  console.log(`
ChaosKB CDK App created.

  Environment: ${environment}
  Region:      ${region}

To deploy, run:

  npx cdk deploy --app "npx ts-node lib/deploy-cli.ts"

Or with specific AWS profile:

  npx cdk deploy --app "npx ts-node lib/deploy-cli.ts" --profile <your-profile>
`);

  app.synth();
}

main();
