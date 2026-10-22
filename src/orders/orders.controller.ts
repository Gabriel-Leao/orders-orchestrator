import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ListOrdersQueryDto } from './dto/list-orders.query.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { PaginatedOrdersResponseDto } from './dto/paginated-orders-response.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiUnauthorizedResponse({ description: 'x-api-key ausente ou inválida' })
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista pedidos',
    description:
      'Paginado, do mais recente para o mais antigo. Filtro opcional por status.',
  })
  @ApiOkResponse({ type: PaginatedOrdersResponseDto })
  @ApiBadRequestResponse({ description: 'Parâmetros de consulta inválidos' })
  async list(
    @Query() query: ListOrdersQueryDto,
  ): Promise<PaginatedOrdersResponseDto> {
    return PaginatedOrdersResponseDto.from(await this.orders.list(query));
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detalhes de um pedido',
    description:
      'Inclui os dados de enriquecimento, o número de tentativas e o motivo da falha (quando houver).',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiBadRequestResponse({ description: 'id não é um UUID' })
  @ApiNotFoundResponse({ description: 'Pedido não encontrado' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderResponseDto> {
    return OrderResponseDto.fromEntity(await this.orders.getById(id));
  }
}
