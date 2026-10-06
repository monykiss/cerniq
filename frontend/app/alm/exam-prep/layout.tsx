import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Exam Prep Dashboard | ALM Intelligence | CERNIQ',
  description:
    'COSSEC exam preparation dashboard with CAMEL score breakdown, readiness tracking, critical findings, recommended actions, and document checklist.',
  openGraph: {
    title: 'Exam Prep Dashboard | ALM Intelligence',
    description:
      'CAMEL self-assessment, examiner findings, and readiness scoring for credit union regulatory exams.',
  },
};

export default function ExamPrepLayout({ children }: { children: React.ReactNode }) {
  return children;
}
