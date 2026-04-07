import { describe, it, beforeAll } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BlobStore } from '../../lib/constructs/blob-store.js';
import { Auth } from '../../lib/constructs/auth.js';
import { Api } from '../../lib/constructs/api.js';

describe('Api construct', () => {
  function createTemplate(reservedConcurrency?: number): Template {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const blobStore = new BlobStore(stack, 'BlobStore', { environment: 'test' });
    const auth = new Auth(stack, 'Auth', { environment: 'test' });
    new Api(stack, 'Api', {
      table: blobStore.table,
      environment: 'test',
      signupsEnabledParam: auth.signupsEnabledParam,
      reservedConcurrency,
    });
    return Template.fromStack(stack);
  }

  // Cache the default template — CDK synth + esbuild bundling is slow on
  // Windows Node 20 runners and can exceed the default 5s test timeout.
  let template: Template;
  beforeAll(() => {
    template = createTemplate();
  }, 30_000);

  it('should create a Lambda function with Node.js 22 runtime', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      MemorySize: 256,
      Timeout: 30,
    });
  });

  it('should have environment variables set', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          ENVIRONMENT: 'test',
        }),
      },
    });
  });

  it('should have reserved concurrency (default 10)', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      ReservedConcurrentExecutions: 10,
    });
  });

  it('should allow configurable reserved concurrency', () => {
    const custom = createTemplate(25);

    custom.hasResourceProperties('AWS::Lambda::Function', {
      ReservedConcurrentExecutions: 25,
    });
  });

  it('should create a Function URL', () => {
    template.hasResourceProperties('AWS::Lambda::Url', {
      AuthType: 'NONE',
    });
  });

  it('should create a dead letter queue', () => {
    template.hasResource('AWS::SQS::Queue', {});
  });

  it('should have X-Ray tracing enabled', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      TracingConfig: {
        Mode: 'Active',
      },
    });
  });
});
