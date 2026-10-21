import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { OrderStatus } from '../enums/order-status.enum';

export interface OrderItem {
  sku: string;
  qty: number;
  unitPrice: number;
}

const numericTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? null : Number(value),
};

export const ORDER_IDEMPOTENCY_CONSTRAINT = 'UQ_orders_idempotency_key';
export const ORDER_EXTERNAL_ID_CONSTRAINT = 'UQ_orders_external_order_id';

@Entity('orders')
@Unique(ORDER_IDEMPOTENCY_CONSTRAINT, ['idempotencyKey'])
@Unique(ORDER_EXTERNAL_ID_CONSTRAINT, ['externalOrderId'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'external_order_id', type: 'varchar', length: 100 })
  externalOrderId: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  @Column({ name: 'customer_email', type: 'varchar', length: 255 })
  customerEmail: string;

  @Column({ name: 'customer_name', type: 'varchar', length: 255 })
  customerName: string;

  @Column({ type: 'jsonb' })
  items: OrderItem[];

  @Column({ type: 'char', length: 3 })
  currency: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  total: number;

  @Index('IDX_orders_status')
  @Column({ type: 'varchar', length: 32, default: OrderStatus.RECEIVED })
  status: OrderStatus;

  @Column({ name: 'target_currency', type: 'char', length: 3, nullable: true })
  targetCurrency: string | null;

  @Column({
    name: 'converted_total',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  convertedTotal: number | null;

  @Column({
    name: 'exchange_rate',
    type: 'numeric',
    precision: 18,
    scale: 8,
    nullable: true,
    transformer: numericTransformer,
  })
  exchangeRate: number | null;

  @Column({ name: 'exchange_rate_date', type: 'date', nullable: true })
  exchangeRateDate: string | null;

  @Column({ name: 'enriched_at', type: 'timestamptz', nullable: true })
  enrichedAt: Date | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
