'use client';

import { Check } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

interface ProgressTrackerProps {
  currentStep: number; // 1-5
  completedSteps: number[];
}

const STEPS = [
  { id: 1, labelEn: 'Account Active', labelEs: 'Cuenta Activa' },
  { id: 2, labelEn: 'Institution', labelEs: 'Institucion' },
  { id: 3, labelEn: 'Data', labelEs: 'Datos' },
  { id: 4, labelEn: 'Processing', labelEs: 'Procesando' },
  { id: 5, labelEn: 'Report Ready', labelEs: 'Informe Listo' },
];

export default function ProgressTracker({ currentStep, completedSteps }: ProgressTrackerProps) {
  const { locale } = useTranslation();

  return (
    <div className="w-full py-4">
      <div className="flex items-center justify-between relative">
        {/* Connecting line behind circles */}
        <div className="absolute top-5 left-0 right-0 h-0.5 bg-slate-200 z-0" />
        <div
          className="absolute top-5 left-0 h-0.5 z-0 transition-all duration-500"
          style={{
            width: `${((Math.max(currentStep, Math.max(...completedSteps, 0)) - 1) / (STEPS.length - 1)) * 100}%`,
            background: 'linear-gradient(90deg, #1B3A6B 0%, #1ABFFF 100%)',
          }}
        />

        {STEPS.map((step) => {
          const isCompleted = completedSteps.includes(step.id);
          const isCurrent = step.id === currentStep;

          return (
            <div
              key={step.id}
              className="relative z-10 flex flex-col items-center"
              style={{ flex: '1 1 0%' }}
            >
              {/* Circle */}
              <div
                className={`
                  flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-300
                  ${isCompleted
                    ? 'border-[#1B3A6B] bg-[#1B3A6B] text-white'
                    : isCurrent
                      ? 'border-[#1ABFFF] bg-[#1ABFFF] text-white shadow-[0_0_12px_rgba(26,191,255,0.4)]'
                      : 'border-slate-300 bg-white text-slate-400'
                  }
                `}
              >
                {isCompleted ? (
                  <Check className="h-5 w-5" strokeWidth={2.5} />
                ) : (
                  <span className="text-sm font-semibold">{step.id}</span>
                )}
              </div>

              {/* Labels */}
              <div className="mt-2 text-center">
                <p
                  className={`text-xs font-semibold leading-tight ${
                    isCompleted
                      ? 'text-[#1B3A6B]'
                      : isCurrent
                        ? 'text-[#1ABFFF]'
                        : 'text-slate-400'
                  }`}
                >
                  {locale === 'en' ? step.labelEn : step.labelEs}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
