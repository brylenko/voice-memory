import { Injectable } from '@nestjs/common';
import { OpenAiService } from '../../common/services/openai.service';
import { EmbeddingPort } from '../ports/embedding.port';

@Injectable()
export class OpenAiEmbeddingAdapter implements EmbeddingPort {
  constructor(private readonly openai: OpenAiService) {}

  async embed(texts: string[]): Promise<number[][]> {
    const response = await this.openai.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });
    return response.data.map((item) => item.embedding);
  }
}
