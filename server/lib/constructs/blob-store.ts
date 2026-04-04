import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, Billing, ProjectionType, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface BlobStoreProps {
  readonly environment: string;
}

export class BlobStore extends Construct {
  public readonly table: TableV2;

  constructor(scope: Construct, id: string, props: BlobStoreProps) {
    super(scope, id);

    this.table = new TableV2(this, 'Table', {
      tableName: `chaoskb-${props.environment}`,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billing: Billing.onDemand(),
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'expiresAt',
      globalSecondaryIndexes: [
        {
          indexName: 'updatedAt-index',
          partitionKey: { name: 'PK', type: AttributeType.STRING },
          sortKey: { name: 'updatedAt', type: AttributeType.STRING },
          projectionType: ProjectionType.ALL,
        },
      ],
    });
  }
}
