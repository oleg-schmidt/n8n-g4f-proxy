import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom, map, Observable } from 'rxjs';
import { Readable } from 'stream';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(private readonly http: HttpService) {}

  private safeStringify(obj: any, max = 1000): string {
    try {
      const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
      return s.length > max ? s.slice(0, max) + '... (truncated)' : s;
    } catch {
      try {
        return String(obj);
      } catch {
        return '[unserializable]';
      }
    }
  }

  async getModels(headers: any): Promise<any> {
    const auth: string | null = headers['authorization'];

    const upstream = process.env.LLM_UPSTREAM;
    const providerKey = (process.env.LLM_PROXY_PROVIDER ?? '').toLowerCase();
    const url = `${upstream}/backend-api/v2/models`;

    const resp = await lastValueFrom(
      this.http.get<any>(url, {
        headers: auth ? { Authorization: auth } : {},
      }),
    );

    // Basic runtime info for debugging
    this.logger.debug(
      `Fetched models from upstream ${url} - status: ${resp?.status ?? 'unknown'}, dataType: ${typeof resp?.data}`,
    );

    // Normalize resp.data into an array of models
    let models: any[] = [];

    if (Array.isArray(resp.data)) {
      models = resp.data;
    } else if (resp.data && Array.isArray(resp.data.models)) {
      models = resp.data.models;
    } else if (resp.data && Array.isArray(resp.data.data)) {
      models = resp.data.data;
    } else if (typeof resp.data === 'string') {
      // Sometimes the response may be a JSON string
      try {
        const parsed = JSON.parse(resp.data);
        if (Array.isArray(parsed)) models = parsed;
        else if (parsed && Array.isArray(parsed.models)) models = parsed.models;
        else if (parsed && Array.isArray(parsed.data)) models = parsed.data;
      } catch (e) {
        this.logger.warn(
          `Unable to parse string response from upstream ${url}: ${this.safeStringify(resp.data, 500)}`,
          e,
        );
      }
    } else if (resp.data && typeof resp.data === 'object') {
      // Check if response is a provider-keyed object format
      // e.g., {"Anthropic": ["model1", "model2"], "OpenaiAPI": ["model3"]}
      const isProviderKeyedFormat = Object.values(resp.data).every(
        (value) =>
          Array.isArray(value) &&
          value.every((item) => typeof item === 'string'),
      );

      if (isProviderKeyedFormat) {
        // Transform provider-keyed format to array of model objects
        // Handle models that appear under multiple providers
        const modelMap = new Map<string, string[]>();

        for (const [providerName, modelNames] of Object.entries(resp.data)) {
          if (Array.isArray(modelNames)) {
            for (const modelName of modelNames) {
              if (typeof modelName === 'string') {
                const existingProviders = modelMap.get(modelName) || [];
                modelMap.set(modelName, [...existingProviders, providerName]);
              }
            }
          }
        }

        // Convert map to array of model objects
        models = Array.from(modelMap.entries()).map(([name, providers]) => ({
          name,
          providers,
        }));

        this.logger.debug(
          `Transformed provider-keyed format: ${modelMap.size} unique models from ${Object.keys(resp.data).length} providers`,
        );
      } else {
        // Unexpected shape
        this.logger.warn(
          `Unexpected models response shape from upstream ${url}: ${this.safeStringify(resp.data, 1000)}`,
        );
      }
    } else {
      // Unexpected shape
      this.logger.warn(
        `Unexpected models response shape from upstream ${url}: ${this.safeStringify(resp.data, 1000)}`,
      );
    }

    // If models array is still empty, surface a helpful error
    if (!models || models.length === 0) {
      const sample = this.safeStringify(resp.data, 1000);
      const msg = `No models found for provider '${providerKey}' from upstream ${upstream}. Upstream response shape: ${sample}`;
      this.logger.error(msg);
      throw new NotFoundException(msg);
    }

    // Filter models by provider key in a defensive way
    const filteredModels = models.filter((model: any) => {
      // Normalize providers to an array of strings
      let providers: string[] = [];

      if (Array.isArray(model.providers)) {
        providers = model.providers;
      } else if (model.providers && typeof model.providers === 'object') {
        // If providers is an object, treat its keys as provider identifiers
        providers = Object.keys(model.providers);
      } else if (typeof model.providers === 'string') {
        providers = [model.providers];
      }

      return providers.some(
        (provider: string) => String(provider).toLowerCase() === providerKey,
      );
    });

    // If filtering removed all models, give a descriptive error as well
    if (filteredModels.length === 0) {
      const sample = this.safeStringify(models.slice(0, 5), 1000);
      const msg = `No models matched provider '${providerKey}' in upstream ${upstream}. Sample upstream models: ${sample}`;
      this.logger.error(msg);
      throw new NotFoundException(msg);
    }

    return {
      object: 'list',
      data: filteredModels.map((model: any) => ({
        id: model.name,
        object: 'model',
        created: 0,
        owned_by: '',
        image: model.image || false,
        provider: true,
      })),
    };
  }

  async getProviders(): Promise<string> {
    const upstream = process.env.LLM_UPSTREAM;
    const url = `${upstream}/v1/providers`;

    const response = await lastValueFrom(this.http.get<string>(url));
    return response.data;
  }

  postCompletions(body: any, headers: any): Observable<Readable> {
    const auth: string | null = headers['authorization'];

    const upstream = process.env.LLM_UPSTREAM;
    const provider = process.env.LLM_PROXY_PROVIDER;
    const url = `${upstream}/v1/chat/completions`;

    body['provider'] = provider;

    return this.http
      .post(url, body, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: auth } : {}),
        },
        responseType: 'stream',
      })
      .pipe(map((resp) => resp.data as Readable));
  }
}
