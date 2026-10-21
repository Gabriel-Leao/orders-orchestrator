import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsPositive,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CustomerDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'Ana' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;
}

export class OrderItemDto {
  @ApiProperty({ example: 'ABC123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sku: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  qty: number;

  @ApiProperty({
    example: 59.9,
    description: 'Preço unitário (até 2 casas decimais)',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unit_price: number;
}

export class CreateOrderWebhookDto {
  @ApiProperty({
    example: 'ext-123',
    description: 'Identificador do pedido no sistema de origem',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  order_id: string;

  @ApiProperty({ type: CustomerDto })
  @IsObject()
  @ValidateNested()
  @Type(() => CustomerDto)
  customer: CustomerDto;

  @ApiProperty({ type: [OrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ApiProperty({
    example: 'USD',
    description: 'Código ISO 4217 com 3 letras maiúsculas',
  })
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a 3-letter uppercase ISO 4217 code',
  })
  currency: string;

  @ApiProperty({
    example: '3f6c1c1e-8a4b-4a52-9d3e-0f9d2b1a7c10',
    description:
      'Chave de idempotência (uuid ou hash). O mesmo valor nunca gera dois pedidos.',
  })
  @IsString()
  @Length(8, 128)
  idempotency_key: string;
}
