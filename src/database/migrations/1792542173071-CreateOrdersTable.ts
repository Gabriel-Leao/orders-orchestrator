import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrdersTable1792542173071 implements MigrationInterface {
  name = 'CreateOrdersTable1792542173071';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "external_order_id" character varying(100) NOT NULL, "idempotency_key" character varying(128) NOT NULL, "customer_email" character varying(255) NOT NULL, "customer_name" character varying(255) NOT NULL, "items" jsonb NOT NULL, "currency" character(3) NOT NULL, "total" numeric(14,2) NOT NULL, "status" character varying(32) NOT NULL DEFAULT 'RECEIVED', "target_currency" character(3), "converted_total" numeric(14,2), "exchange_rate" numeric(18,8), "exchange_rate_date" date, "enriched_at" TIMESTAMP WITH TIME ZONE, "failure_reason" text, "attempts" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_orders_external_order_id" UNIQUE ("external_order_id"), CONSTRAINT "UQ_orders_idempotency_key" UNIQUE ("idempotency_key"), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_status" ON "orders"  ("status") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_orders_status"`);
    await queryRunner.query(`DROP TABLE "orders"`);
  }
}
