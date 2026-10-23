import type { Server } from 'node:http';
import request from 'supertest';
import type { OrderResponseDto } from '../../src/orders/dto/order-response.dto';
import { TEST_API_KEY } from './test-env';
import type { WebhookPayload } from './builders';

export interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export const postWebhook = (
  server: Server,
  payload: unknown,
  apiKey: string | null = TEST_API_KEY,
) => {
  const req = request(server).post('/webhooks/orders');
  if (apiKey !== null) void req.set('x-api-key', apiKey);
  return req.send(payload as WebhookPayload);
};

export const authedGet = (server: Server, url: string) =>
  request(server).get(url).set('x-api-key', TEST_API_KEY);

export const getOrder = async (
  server: Server,
  id: string,
): Promise<OrderResponseDto> => {
  const res = await authedGet(server, `/orders/${id}`).expect(200);
  return res.body as OrderResponseDto;
};
