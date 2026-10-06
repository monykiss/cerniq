import { PipeTransform, BadRequestException } from '@nestjs/common';
export class ParseUUIDPipe implements PipeTransform {
  transform(value: string) {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value))
      throw new BadRequestException(`Invalid UUID: ${value}`);
    return value;
  }
}
