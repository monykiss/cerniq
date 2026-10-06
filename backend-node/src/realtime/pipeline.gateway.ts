import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { isAllowedOrigin } from '../security/origin-allowlist';

export interface PipelineProgressPayload {
  step: string;
  stepNumber: number;
  totalSteps: number;
  percentComplete: number;
  message: string;
  messageEs: string;
}

export interface PipelineCompletePayload {
  reportUrl?: string | null;
  reportUrlEn?: string | null;
  manifestPath: string;
}

@WebSocketGateway({
  namespace: '/pipeline',
  cors: {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(
        new Error(`Pipeline socket origin not allowed: ${origin || 'unknown'}`),
        false,
      );
    },
    credentials: true,
  },
})
export class PipelineGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(PipelineGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Pipeline client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Pipeline client disconnected: ${client.id}`);
  }

  /**
   * Client joins a job room to receive progress updates for that job.
   */
  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() jobId: string,
  ) {
    const room = `job:${jobId}`;
    await client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);
    return { success: true, room };
  }

  /**
   * Client leaves a job room.
   */
  @SubscribeMessage('leave')
  async handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() jobId: string,
  ) {
    const room = `job:${jobId}`;
    await client.leave(room);
    this.logger.log(`Client ${client.id} left room ${room}`);
    return { success: true, room };
  }

  /**
   * Emit a progress update to all clients watching a specific job.
   */
  emitProgress(jobId: string, data: PipelineProgressPayload) {
    this.server.to(`job:${jobId}`).emit('pipeline:progress', {
      jobId,
      ...data,
      timestamp: new Date().toISOString(),
    });
    this.logger.log({
      event: 'pipeline:progress',
      jobId,
      step: data.step,
      percent: data.percentComplete,
    });
  }

  /**
   * Emit completion event with manifest metadata. Raw report URLs remain
   * compatibility-only fields for older clients.
   */
  emitComplete(jobId: string, data: PipelineCompletePayload) {
    this.server.to(`job:${jobId}`).emit('pipeline:complete', {
      jobId,
      ...data,
      timestamp: new Date().toISOString(),
    });
    this.logger.log({ event: 'pipeline:complete', jobId });
  }

  /**
   * Emit an error event for a specific job.
   */
  emitError(jobId: string, error: string) {
    this.server.to(`job:${jobId}`).emit('pipeline:error', {
      jobId,
      error,
      timestamp: new Date().toISOString(),
    });
    this.logger.log({ event: 'pipeline:error', jobId, error });
  }
}
