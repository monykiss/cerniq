import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (OTEL_ENDPOINT) {
  const sdk = new NodeSDK({
    resourceDetectors: [],
    resource: {
      attributes: {
        [ATTR_SERVICE_NAME]: 'cerniq-backend',
        [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '0.1.0',
      },
    } as any,
    traceExporter: new OTLPTraceExporter({
      url: `${OTEL_ENDPOINT}/v1/traces`,
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
        ? Object.fromEntries(
            process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',').map((h) => {
              const [k, ...v] = h.split('=');
              return [k.trim(), v.join('=').trim()];
            }),
          )
        : undefined,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisy fs instrumentation
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  const shutdown = () => {
    sdk.shutdown().catch(console.error);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  process.stdout.write(
    JSON.stringify({
      level: 'info',
      msg: `OpenTelemetry traces exporting to ${OTEL_ENDPOINT}`,
      timestamp: new Date().toISOString(),
    }) + '\n',
  );
}
