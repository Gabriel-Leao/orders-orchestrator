export class QueueCountsDto {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
}

export class QueueSnapshotDto {
  name: string;
  is_paused: boolean;
  counts: QueueCountsDto;
}

export class QueueMetricsResponseDto {
  prefix: string;
  queue: QueueSnapshotDto;
  dead_letter_queue: QueueSnapshotDto;
}
