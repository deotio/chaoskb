import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BlobStore } from '../../lib/constructs/blob-store.js';

describe('BlobStore construct', () => {
  function createTemplate(): Template {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    new BlobStore(stack, 'BlobStore', { environment: 'test' });
    return Template.fromStack(stack);
  }

  it('should create a DynamoDB table with correct key schema', () => {
    const template = createTemplate();

    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    });
  });

  it('should have a GSI named updatedAt-index', () => {
    const template = createTemplate();

    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      GlobalSecondaryIndexes: [
        {
          IndexName: 'updatedAt-index',
          KeySchema: [
            { AttributeName: 'PK', KeyType: 'HASH' },
            { AttributeName: 'updatedAt', KeyType: 'RANGE' },
          ],
        },
      ],
    });
  });

  it('should use on-demand billing', () => {
    const template = createTemplate();

    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('should have point-in-time recovery enabled', () => {
    const template = createTemplate();

    // TableV2 uses Replicas for PITR config
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      Replicas: [
        {
          PointInTimeRecoverySpecification: {
            PointInTimeRecoveryEnabled: true,
          },
        },
      ],
    });
  });

  it('should have RETAIN removal policy', () => {
    const template = createTemplate();

    // Check DeletionPolicy on the resource
    const resources = template.findResources('AWS::DynamoDB::GlobalTable');
    const tableKey = Object.keys(resources)[0];
    expect(resources[tableKey]['DeletionPolicy']).toBe('Retain');
  });
});
