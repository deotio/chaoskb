import { describe, it, beforeAll } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BlobStore } from '../../lib/constructs/blob-store.js';
import { AdminApi } from '../../lib/constructs/admin-api.js';

describe('AdminApi construct', () => {
  function createTemplate(allowedOrigins: string[] = []): Template {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const blobStore = new BlobStore(stack, 'BlobStore', { environment: 'test' });
    new AdminApi(stack, 'AdminApi', {
      table: blobStore.table,
      environment: 'test',
      allowedOrigins,
    });
    return Template.fromStack(stack);
  }

  // Cache the default template — CDK synth + esbuild bundling is slow on
  // Windows Node 20 runners and can exceed the default 5s test timeout.
  let template: Template;
  beforeAll(() => {
    template = createTemplate();
  }, 30_000);

  it('should create a Lambda function with correct runtime, memory, and timeout', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      MemorySize: 256,
      Timeout: 30,
    });
  });

  it('should have ARM64 architecture', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Architectures: ['arm64'],
    });
  });

  it('should have reserved concurrency of 5', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      ReservedConcurrentExecutions: 5,
    });
  });

  it('should have X-Ray tracing enabled', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      TracingConfig: {
        Mode: 'Active',
      },
    });
  });

  it('should have environment variables set', () => {
    const custom = createTemplate(['https://chaoskb.com', 'https://dev.chaoskb.com']);

    custom.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          ENVIRONMENT: 'test',
          ALLOWED_ORIGINS: 'https://chaoskb.com,https://dev.chaoskb.com',
        }),
      },
    });
  });

  it('should create a Function URL with no auth', () => {
    template.hasResourceProperties('AWS::Lambda::Url', {
      AuthType: 'NONE',
    });
  });

  it('should have DynamoDB read permissions', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: ['dynamodb:Scan', 'dynamodb:Query', 'dynamodb:GetItem'],
          }),
        ]),
      },
    });
  });

  it('should have CloudWatch read permissions', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: ['cloudwatch:DescribeAlarms', 'cloudwatch:GetMetricData'],
          }),
        ]),
      },
    });
  });

  it('should have Cost Explorer permissions', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: ['ce:GetCostAndUsage', 'ce:GetCostForecast'],
          }),
        ]),
      },
    });
  });
});
