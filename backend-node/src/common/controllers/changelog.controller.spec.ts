import { Test, TestingModule } from '@nestjs/testing';
import { ChangelogController } from './changelog.controller';

describe('ChangelogController', () => {
  let controller: ChangelogController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChangelogController],
    }).compile();

    controller = module.get<ChangelogController>(ChangelogController);
  });

  it('returns changelog entries (default limit)', () => {
    const result = controller.getChangelog();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]).toHaveProperty('version');
    expect(result[0]).toHaveProperty('date');
    expect(result[0]).toHaveProperty('changes');
    expect(Array.isArray(result[0].changes)).toBe(true);
  });

  it('respects the limit query parameter', () => {
    const result = controller.getChangelog('1');

    expect(result).toHaveLength(1);
  });

  it('clamps limit to at least 1 even when given 0 or negative', () => {
    const resultZero = controller.getChangelog('0');
    expect(resultZero.length).toBeGreaterThanOrEqual(1);

    const resultNegative = controller.getChangelog('-5');
    expect(resultNegative.length).toBeGreaterThanOrEqual(1);
  });
});
