import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CreateOrderWebhookDto } from '../dto/create-order-webhook.dto';
import { OrderResponseDto } from '../dto/order-response.dto';
import { OrdersService } from '../orders.service';

@ApiTags('webhooks')
@Controller('webhooks/orders')
export class WebhooksController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Recebe um pedido via webhook',
    description:
      'Valida, persiste como RECEIVED e agenda o processamento assíncrono. ' +
      'É idempotente: reenviar a mesma idempotency_key devolve o pedido já existente.',
  })
  @ApiAcceptedResponse({
    type: OrderResponseDto,
    description: 'Pedido novo, aceito para processamento',
  })
  @ApiOkResponse({
    type: OrderResponseDto,
    description:
      'idempotency_key já recebida (replay): pedido existente, sem reprocessar',
  })
  @ApiBadRequestResponse({ description: 'Payload inválido' })
  @ApiUnauthorizedResponse({ description: 'x-api-key ausente ou inválida' })
  @ApiConflictResponse({
    description: 'order_id já recebido com outra idempotency_key',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Pedido gravado, mas a fila não respondeu a tempo: reenvie a mesma idempotency_key',
  })
  async receive(
    @Body() dto: CreateOrderWebhookDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderResponseDto> {
    const { order, created } = await this.orders.receive(dto);
    if (!created) res.status(HttpStatus.OK);
    return OrderResponseDto.fromEntity(order);
  }
}
