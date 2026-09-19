import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC_ROUTE = 'isPublicRoute';
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_ROUTE, true);
