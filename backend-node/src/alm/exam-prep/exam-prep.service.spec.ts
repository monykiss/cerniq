import { ExamPrepService } from './exam-prep.service';

describe('ExamPrepService', () => {
  let service: ExamPrepService;
  const mockPrisma = {} as any;
  const mockCamelScorer = {
    scoreInstitution: jest.fn().mockResolvedValue({
      composite: 2,
      compositeRating: 'Satisfactory',
      compositeRatingEs: 'Satisfactorio',
      examReadiness: 'READY',
      components: [],
    }),
  } as any;

  beforeEach(() => {
    service = new ExamPrepService(mockPrisma, mockCamelScorer);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return exam prep with CAMEL scores', async () => {
    const result = await service.getExamPrep('inst-1');
    expect(result.camel).toBeDefined();
    expect(result.camel.composite).toBe(2);
    expect(mockCamelScorer.scoreInstitution).toHaveBeenCalledWith('inst-1');
  });

  it('should include 24 governance items', async () => {
    const result = await service.getExamPrep('inst-1');
    expect(result.governance.totalCount).toBe(24);
    expect(result.governance.items.length).toBe(24);
  });

  it('should compute governance completion percentage', async () => {
    const result = await service.getExamPrep('inst-1');
    expect(result.governance.completionPct).toBe(75); // 18/24 = 75%
    expect(result.governance.completedCount).toBe(18);
  });

  it('should include sample prior exam findings', async () => {
    const result = await service.getExamPrep('inst-1');
    expect(result.findings.length).toBe(3);
    expect(result.findings[0]).toHaveProperty('finding');
    expect(result.findings[0]).toHaveProperty('findingEs');
    expect(result.findings[0]).toHaveProperty('status');
  });

  it('should list 12 schedule statuses', async () => {
    const result = await service.getExamPrep('inst-1');
    expect(result.scheduleStatus.length).toBe(12);
    expect(result.scheduleStatus[0]).toHaveProperty('schedule');
    expect(result.scheduleStatus[0]).toHaveProperty('available');
  });
});
