import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { AxiosResponse } from 'axios';
import { NotFoundException } from '@nestjs/common';

describe('AppService', () => {
  let service: AppService;
  let httpService: HttpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
            post: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AppService>(AppService);
    httpService = module.get<HttpService>(HttpService);
  });

  describe('getModels', () => {
    beforeEach(() => {
      process.env.LLM_UPSTREAM = 'http://test-upstream';
      process.env.LLM_PROXY_PROVIDER = 'OpenaiAPI';
    });

    it('should transform provider-keyed format correctly', async () => {
      const mockResponse: AxiosResponse = {
        data: {
          Anthropic: ['claude-3-opus', 'claude-3-sonnet'],
          OpenaiAPI: ['gpt-4', 'claude-3-opus'],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(mockResponse));

      const result = await service.getModels({ authorization: 'Bearer test' });

      expect(result.object).toBe('list');
      // Should return 2 models that have OpenaiAPI provider: claude-3-opus and gpt-4
      // claude-3-sonnet is filtered out because it only has Anthropic
      expect(result.data).toHaveLength(2);

      // Find models by name
      const claudeOpus = result.data.find((m: any) => m.id === 'claude-3-opus');
      const gpt4 = result.data.find((m: any) => m.id === 'gpt-4');

      // Verify models exist
      expect(claudeOpus).toBeDefined();
      expect(gpt4).toBeDefined();

      // Verify claude-3-sonnet is not included (it only has Anthropic provider)
      const claudeSonnet = result.data.find(
        (m: any) => m.id === 'claude-3-sonnet',
      );
      expect(claudeSonnet).toBeUndefined();
    });

    it('should handle single provider format', async () => {
      const mockResponse: AxiosResponse = {
        data: {
          OpenaiAPI: ['gpt-4', 'gpt-3.5-turbo'],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(mockResponse));

      const result = await service.getModels({ authorization: 'Bearer test' });

      expect(result.object).toBe('list');
      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toMatch(/gpt-4|gpt-3.5-turbo/);
    });

    it('should maintain backward compatibility with array format', async () => {
      const mockResponse: AxiosResponse = {
        data: [
          { name: 'gpt-4', providers: ['OpenaiAPI'] },
          { name: 'gpt-3.5-turbo', providers: ['OpenaiAPI'] },
        ],
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(mockResponse));

      const result = await service.getModels({ authorization: 'Bearer test' });

      expect(result.object).toBe('list');
      expect(result.data).toHaveLength(2);
    });

    it('should throw NotFoundException when no models match provider', async () => {
      process.env.LLM_PROXY_PROVIDER = 'NonExistentProvider';

      const mockResponse: AxiosResponse = {
        data: {
          OpenaiAPI: ['gpt-4'],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(mockResponse));

      await expect(
        service.getModels({ authorization: 'Bearer test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle models appearing under multiple providers', async () => {
      const mockResponse: AxiosResponse = {
        data: {
          Anthropic: ['claude-3-opus'],
          OpenaiAPI: ['claude-3-opus', 'gpt-4'],
          AnyProvider: ['claude-3-opus'],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      jest.spyOn(httpService, 'get').mockReturnValue(of(mockResponse));

      const result = await service.getModels({ authorization: 'Bearer test' });

      expect(result.object).toBe('list');
      // Should have 2 unique models (claude-3-opus and gpt-4)
      expect(result.data).toHaveLength(2);

      const claudeOpus = result.data.find((m: any) => m.id === 'claude-3-opus');
      expect(claudeOpus).toBeDefined();
    });
  });
});
