import { Logger } from '@nestjs/common';

/**
 * Method-level execution logging decorator.
 * Logs method entry, exit, execution time, and errors.
 * Useful for tracing service-layer operations without manual logging.
 *
 * @example
 * ```typescript
 * @LogExecution()
 * async createReport(data: CreateReportDto) { ... }
 * ```
 */
export function LogExecution(context?: string): MethodDecorator {
  return function (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;
    const methodName = String(propertyKey);
    const loggerContext = context || className;
    const logger = new Logger(loggerContext);

    descriptor.value = async function (...args: any[]) {
      const start = Date.now();
      const argsSummary = args.length > 0 ? `(${args.length} args)` : '()';

      logger.debug(`→ ${className}.${methodName}${argsSummary}`);

      try {
        const result = await originalMethod.apply(this, args);
        const elapsed = Date.now() - start;

        logger.debug(`← ${className}.${methodName} completed in ${elapsed}ms`);
        return result;
      } catch (error: any) {
        const elapsed = Date.now() - start;

        logger.error(
          `✗ ${className}.${methodName} failed after ${elapsed}ms: ${error.message}`,
        );
        throw error;
      }
    };

    return descriptor;
  };
}
