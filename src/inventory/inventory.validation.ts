import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { parseUtcDate } from '../common/utils/date';
import { assertSafeExternalHttpUrl } from '../common/utils/url-security';
import { CreateInventoryProductDto } from './dto/create-inventory-product.dto';

function firstValidationMessage(errors: ValidationError[]): string {
  for (const error of errors) {
    const constraint = error.constraints
      ? Object.values(error.constraints)[0]
      : null;
    if (constraint) {
      return constraint;
    }

    if (error.children && error.children.length > 0) {
      return firstValidationMessage(error.children);
    }
  }

  return 'Invalid inventory payload';
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function hasNonBlankItems(values: string[] | undefined): boolean {
  return (values ?? []).some((value) => value.trim().length > 0);
}

export function assertValidInventoryDraft(payload: unknown): void {
  const instance = plainToInstance(CreateInventoryProductDto, payload);
  const errors = validateSync(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  if (errors.length > 0) {
    throw new BadRequestException(firstValidationMessage(errors));
  }

  if (isBlank(instance.identity.brand)) {
    throw new BadRequestException('Brand is required');
  }

  if (isBlank(instance.identity.name)) {
    throw new BadRequestException('Product name is required');
  }

  if (isBlank(instance.identity.description)) {
    throw new BadRequestException('Product description is required');
  }

  if (!hasNonBlankItems(instance.identity.benefits)) {
    throw new BadRequestException('At least one product benefit is required');
  }

  if (!hasNonBlankItems(instance.identity.suitedFor)) {
    throw new BadRequestException('At least one suited-for value is required');
  }

  if (!hasNonBlankItems(instance.identity.inciIngredients)) {
    throw new BadRequestException('At least one INCI ingredient is required');
  }

  if (!hasNonBlankItems(instance.guidance.steps)) {
    throw new BadRequestException('At least one guidance step is required');
  }

  instance.identity.imageUrls.forEach((imageUrl, index) => {
    assertSafeExternalHttpUrl(imageUrl, `Identity image URL ${index + 1}`);
  });

  assertSafeExternalHttpUrl(
    instance.manufacturer.productUrl,
    'Manufacturer product URL',
  );
  assertSafeExternalHttpUrl(
    instance.manufacturer.websiteUrl,
    'Manufacturer website URL',
  );

  const openedAt = parseUtcDate(instance.userFields.openedAt);
  const expiresAt = parseUtcDate(instance.userFields.expiresAt);

  if (openedAt && expiresAt && expiresAt.isBefore(openedAt)) {
    throw new BadRequestException(
      'Expiry date cannot be earlier than opened date',
    );
  }
}
