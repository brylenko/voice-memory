import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AudioTrackEntity, AudioTrackStatus } from '../../../../audio-track/audio-track.entity';
import type { ActionTask } from '../../../../audio-track/audio-track.entity';
import { Inject } from '@nestjs/common';
import { CHAT_COMPLETION_PORT, ChatCompletionPort } from '../../../../ai/ports/chat-completion.port';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(AudioTrackEntity)
    private readonly trackRepo: Repository<AudioTrackEntity>,
    @Inject(CHAT_COMPLETION_PORT) private readonly chat: ChatCompletionPort,
  ) {}

  async getOpenTasks(userId: string): Promise<ActionTask[]> {
    const tracks = await this.trackRepo
      .createQueryBuilder('t')
      .where('t.userId = :userId', { userId })
      .andWhere('t.status = :status', { status: AudioTrackStatus.COMPLETED })
      .andWhere("t.summaries IS NOT NULL")
      .select(['t.id', 't.summaries'])
      .orderBy('t.createdAt', 'DESC')
      .getMany();

    return tracks.flatMap((t) => (t.summaries?.tasks ?? []).filter((task) => !task.done));
  }

  /** Find the best matching open task by semantic similarity and mark it done. */
  async markDone(userId: string, taskHint: string): Promise<ActionTask | null> {
    const tracks = await this.trackRepo
      .createQueryBuilder('t')
      .where('t.userId = :userId', { userId })
      .andWhere('t.status = :status', { status: AudioTrackStatus.COMPLETED })
      .andWhere("t.summaries IS NOT NULL")
      .select(['t.id', 't.summaries'])
      .orderBy('t.createdAt', 'DESC')
      .getMany();

    const openTasks: Array<{ trackId: string; task: ActionTask; index: number }> = [];
    for (const track of tracks) {
      const tasks = track.summaries?.tasks ?? [];
      tasks.forEach((task, index) => {
        if (!task.done) openTasks.push({ trackId: track.id, task, index });
      });
    }

    if (openTasks.length === 0) return null;

    const matched = await this.findBestMatch(taskHint, openTasks.map((o) => o.task.text));
    if (matched === -1) return null;

    const { trackId, task, index } = openTasks[matched];
    const track = tracks.find((t) => t.id === trackId)!;
    const updatedTasks = [...(track.summaries!.tasks)];
    updatedTasks[index] = { ...task, done: true };

    await this.trackRepo.update(trackId, {
      summaries: { ...track.summaries!, tasks: updatedTasks },
    });

    this.logger.log(`markDone: task "${task.text}" on track ${trackId}`);
    return task;
  }

  private async findBestMatch(hint: string, candidates: string[]): Promise<number> {
    if (candidates.length === 0) return -1;

    const numbered = candidates.map((c, i) => `${i + 1}. ${c}`).join('\n');
    const raw = await this.chat.complete(
      [
        {
          role: 'system',
          content:
            'You match a user\'s description to the most relevant item in a list. ' +
            'Respond with ONLY the number of the best match (1-based). ' +
            'If nothing is a reasonable match, respond with 0.',
        },
        {
          role: 'user',
          content: `User said they completed: "${hint}"\n\nTask list:\n${numbered}`,
        },
      ],
      { temperature: 0 },
    );

    const num = parseInt(raw?.trim() ?? '0', 10);
    if (isNaN(num) || num < 1 || num > candidates.length) return -1;
    return num - 1;
  }
}
