---
title: 'NestJS'
description:
  'Integrate FirestoreORM into a NestJS module/service/controller stack with a shared Zod schema,
  DI, and an exception filter.'
---

Integrate the repository into a NestJS module/service/controller stack, letting a single Zod schema
drive both the DTOs and the repository's runtime validation. For the Express integration, see
[Express](/firestore-orm/guides/integrations/express/); for the error classes, see
[Error Handling](/firestore-orm/reference/errors/).

NestJS users often work with DTOs for request validation. Here's how to integrate with the ORM's Zod
schemas so a single schema drives both the DTOs and the repository's runtime validation.

## Shared schema strategy

Define one Zod schema — which must **not** declare a top-level `id` (the document name is the sole
source of `id`, see [Document Identity](/firestore-orm/guides/concepts/document-identity/)) — then
derive the create/update DTOs from it with `.omit()` and `.partial()`:

```typescript
// schemas/user.schema.ts
import { z } from 'zod';

export const userSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
  status: z.enum(['active', 'inactive', 'suspended']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type User = z.infer<typeof userSchema>;

// DTOs for NestJS (derived from same schema)
export const createUserSchema = userSchema.omit({ createdAt: true, updatedAt: true });
export const updateUserSchema = createUserSchema.partial();

export type CreateUserDto = z.infer<typeof createUserSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
```

## Repository module

Provide the `Firestore` instance through Nest's DI container as a global module:

```typescript
// modules/database/database.module.ts
import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

@Global()
@Module({
  providers: [
    {
      provide: 'FIRESTORE',
      useFactory: (config: ConfigService) => {
        const app = initializeApp({
          credential: cert(config.get('firebase.serviceAccount')),
        });
        return getFirestore(app);
      },
      inject: [ConfigService],
    },
  ],
  exports: ['FIRESTORE'],
})
export class DatabaseModule {}
```

Wrap the ORM repository in an injectable provider. Construct it with `withSchema(...)` (which
validates every write against the schema) and register any lifecycle hooks in the constructor:

```typescript
// modules/user/user.repository.ts
import { Injectable, Inject } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FirestoreRepository } from '@reggieofarrell/firestore-orm';
import { User, userSchema } from '../../schemas/user.schema';

@Injectable()
export class UserRepository {
  private repo: FirestoreRepository<User>;

  constructor(@Inject('FIRESTORE') private firestore: Firestore) {
    this.repo = FirestoreRepository.withSchema(firestore, 'users', userSchema);

    // Setup hooks
    this.setupHooks();
  }

  private setupHooks() {
    this.repo.on('afterCreate', async user => {
      console.log(`User created: ${user.id}`);
    });
  }

  async create(data: Omit<User, 'createdAt' | 'updatedAt'>) {
    return this.repo.create(
      {
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      { returnDoc: true },
    );
  }

  async findById(id: string) {
    return this.repo.getById(id);
  }

  async update(id: string, data: Partial<User>) {
    return this.repo.update(
      id,
      {
        ...data,
        updatedAt: new Date().toISOString(),
      },
      { returnDoc: true },
    );
  }

  async remove(id: string) {
    return this.repo.delete(id);
  }

  query() {
    return this.repo.query();
  }
}
```

The `afterCreate` hook receives the freshly created document (including its generated `id`). See
[Lifecycle hooks](/firestore-orm/guides/concepts/lifecycle-hooks/) for the full event list and
payload shapes.

## Service layer

Keep business logic in the service and map ORM errors to Nest's HTTP exceptions where you want
framework-native behavior:

```typescript
// modules/user/user.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRepository } from './user.repository';
import { CreateUserDto, UpdateUserDto } from '../../schemas/user.schema';
import { NotFoundError } from '@reggieofarrell/firestore-orm';

@Injectable()
export class UserService {
  constructor(private userRepository: UserRepository) {}

  async create(dto: CreateUserDto) {
    return this.userRepository.create(dto);
  }

  async findOne(id: string) {
    const user = await this.userRepository.findById(id);

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findActive(page: number = 1, limit: number = 20) {
    return this.userRepository
      .query()
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc')
      .offsetPaginate(page, limit);
  }

  async update(id: string, dto: UpdateUserDto) {
    try {
      return await this.userRepository.update(id, dto);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  async remove(id: string) {
    await this.userRepository.remove(id);
  }
}
```

## Controller with validation pipe

The controller stays declarative — validate incoming bodies with a Zod pipe and delegate to the
service:

```typescript
// modules/user/user.controller.ts
import { Controller, Get, Post, Body, Param, Patch, Delete, Query, UsePipes } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto, UpdateUserDto } from '../../schemas/user.schema';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { createUserSchema, updateUserSchema } from '../../schemas/user.schema';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(createUserSchema))
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Get()
  findAll(@Query('page') page: string = '1', @Query('limit') limit: string = '20') {
    return this.userService.findActive(Number(page), Number(limit));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Patch(':id')
  @UsePipes(new ZodValidationPipe(updateUserSchema))
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.update(id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.userService.remove(id);
  }
}
```

## Zod validation pipe (optional — since the ORM validates)

The ORM already validates on write, so this pipe is optional. It buys you an earlier `400` at the
HTTP boundary (before touching Firestore) with a framework-native `BadRequestException`:

```typescript
// pipes/zod-validation.pipe.ts
import { PipeTransform, BadRequestException } from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown) {
    try {
      return this.schema.parse(value);
    } catch (error) {
      throw new BadRequestException('Validation failed');
    }
  }
}
```

## Exception filter for ORM errors

Alternatively, let the ORM throw and translate its typed errors into HTTP responses with a Nest
exception filter. `ValidationError` exposes `.issues` (the underlying Zod issues):

```typescript
// filters/firestore-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ValidationError, NotFoundError, ConflictError } from '@reggieofarrell/firestore-orm';

@Catch(ValidationError, NotFoundError, ConflictError)
export class FirestoreExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof ValidationError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Validation Error',
        details: exception.issues,
      });
    } else if (exception instanceof NotFoundError) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: exception.message,
      });
    } else if (exception instanceof ConflictError) {
      response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: exception.message,
      });
    }
  }
}
```

## Register the filter globally

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FirestoreExceptionFilter } from './filters/firestore-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalFilters(new FirestoreExceptionFilter());

  await app.listen(3000);
}
bootstrap();
```

## See also

- [Express](/firestore-orm/guides/integrations/express/) — thin route handlers and the
  `errorHandler` middleware
- [Error Handling](/firestore-orm/reference/errors/) — the error classes and `parseFirestoreError`
- [Schema Validation](/firestore-orm/guides/concepts/schema-validation/) — deriving DTOs and the
  no-top-level-`id` rule
- [Lifecycle hooks](/firestore-orm/guides/concepts/lifecycle-hooks/) — the `afterCreate` and related
  events
- [Queries](/firestore-orm/guides/working-with-data/queries/) — pagination and the query builder
