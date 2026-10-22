import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { QueueMetricsResponseDto } from './dto/queue-metrics-response.dto';
import { QueueMetricsService } from './queue-metrics.service';

@ApiTags('queue')
@ApiUnauthorizedResponse({ description: 'x-api-key ausente ou inválida' })
@Controller('queue')
export class QueueMetricsController {
  constructor(private readonly metrics: QueueMetricsService) {}

  @Get('metrics')
  @ApiOperation({
    summary: 'Métricas da fila',
    description:
      'Contagem de jobs da fila principal e da Dead Letter Queue, lida do Redis.',
  })
  @ApiOkResponse({ type: QueueMetricsResponseDto })
  @ApiServiceUnavailableResponse({ description: 'Redis indisponível' })
  getMetrics(): Promise<QueueMetricsResponseDto> {
    return this.metrics.getMetrics();
  }
}
