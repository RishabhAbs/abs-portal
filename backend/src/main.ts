import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { getISTISOString } from './utils/date.util';
import helmet from 'helmet';
import * as compression from 'compression';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // SECURE: Add Security Headers
  app.use(helmet());

  // PERFORMANCE: Enable Compression
  app.use(compression());

  // VALIDATION: Enable Global Pipes
  // VALIDATION: Enable Global Pipes
  // app.useGlobalPipes(new ValidationPipe({
  //   whitelist: true, // Strip properties not in DTO
  //   transform: true, // Transform payloads to DTO instances
  //   forbidNonWhitelisted: true, // Throw error if extra properties are found
  //   transformOptions: {
  //     enableImplicitConversion: true, // Auto-convert types (string -> number)
  //   },
  // }));

  // Enable CORS - Allow all origins for direct port access (cPanel without mod_proxy)
  app.enableCors({
    origin: process.env.CORS_ORIGIN || true, // true = allow all origins
    credentials: true,
  });

  // Swagger API Documentation
  const config = new DocumentBuilder()
    .setTitle('ABS Technologies API')
    .setDescription('Cloud Management System API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Global error handler - FIXED: Handles all exception types securely
  app.useGlobalFilters({
    catch(exception: any, host: any) {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse();
      const request = ctx.getRequest();

      // Determine status: Default to 500, check for HttpException, or handle specific codes
      let status = 500;
      try {
        if (exception.getStatus && typeof exception.getStatus === 'function') {
          status = exception.getStatus();
        } else if (exception.code === 'ENOENT') {
          status = 404;
        } else if (exception.status) {
          status = exception.status;
        }
      } catch (e) {
        console.error('[GlobalFilter] Error resolving status:', e.message);
      }

      const dbError = exception.dbError || (exception.response?.dbError);

      const errorResponse = {
        success: false,
        statusCode: status,
        message: exception.message || 'Internal server error',
        error: dbError ? {
          code: dbError.code,
          solution: dbError.solution,
        } : undefined,
        timestamp: getISTISOString(),
        path: request?.url || 'unknown',
      };

      // Ensure we don't crash the server if response is invalid or already sent
      if (response && typeof response.status === 'function') {
        try {
          response.status(status).json(errorResponse);
        } catch (sendError) {
          console.error('[GlobalFilter] Error sending response:', sendError.message);
        }
      } else {
        console.error('[GlobalFilter] Response object is invalid or unavailable');
      }
    },
  });

  const port = process.env.PORT || 5000;
  console.log(`[Bootstrap] Attempting to start server on port ${port}...`);
  console.log(`[Bootstrap] DB Host: ${process.env.DB_HOST}, DB Name: ${process.env.DB_DATABASE}`);
  
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 ABS Backend is running on: http://0.0.0.0:${port}`);
  console.log(`🔗 Health Check: http://0.0.0.0:${port}/api/auth/health`);
}
bootstrap();
