import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private openai: OpenAI;
  private model: string;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
    });
    this.model = 'gpt-4-vision-preview';
  }

  /**
   * Analyze an image using GPT-4 Vision
   */
  async analyzeImage(imageUrl: string, prompt: string): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
      max_tokens: 1000,
    });

    return response.choices[0].message.content || '';
  }

  /**
   * Generate structured output using function calling
   */
  async generateStructured<T>(prompt: string, schema: any): Promise<T> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that extracts structured data.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      functions: [
        {
          name: 'extract_data',
          description: 'Extract structured data from the input',
          parameters: schema,
        },
      ],
      function_call: { name: 'extract_data' },
    });

    const functionCall = response.choices[0].message.function_call;
    if (!functionCall) {
      throw new Error('No function call in response');
    }

    return JSON.parse(functionCall.arguments);
  }

  /**
   * Categorize text using GPT-4
   */
  async categorize(text: string, categories: string[]): Promise<string> {
    const prompt = `Categorize the following text into one of these categories: ${categories.join(', ')}.
    
Text: ${text}

Respond with only the category name, nothing else.`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0,
      max_tokens: 50,
    });

    return response.choices[0].message.content?.trim() || categories[0];
  }
  /**
   * Generate market insights for a stock ticker
   */
  async generateStockInsight(
    ticker: string,
    currentPrice: number,
    changePercent: number,
  ): Promise<string> {
    const prompt = `Analyze the stock ${ticker} which is currently trading at $${currentPrice} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}%).
        Provide a concise, 2-3 sentence insight about its current market movement, potential catalysts, and what might be driving the price action today.
        Focus on technical levels or recent news if known. Keep it professional and financial.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [
          {
            role: 'system',
            content:
              'You are a senior financial analyst providing real-time market insights.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 150,
      });

      return response.choices[0].message.content || 'Analysis unavailable.';
    } catch (error) {
      this.logger.error({ err: error }, 'Error generating stock insight');
      return 'Unable to generate insight at this time.';
    }
  }
}
