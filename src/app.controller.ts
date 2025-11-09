import { Controller, Get, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/v1/models')
  getModels(@Req() req: Request) {
    return this.appService.getModels(req.headers);
  }

  @Get('/v1/providers')
  getProviders(): Promise<string> {
    return this.appService.getProviders();
  }

  @Post('/v1/chat/completions')
  postCompletions(@Req() req: Request, @Res() res: Response) {
    this.appService
      .postCompletions(req.body, req.headers)
      .subscribe((stream) => {
        stream.pipe(res as any);
      });
  }
}
