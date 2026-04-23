import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CatalogueSourceRuleService } from './catalogue-source-rule.service';
import { CatalogueSourceRule } from './entities/catalogue-source-rule.entity';

const mockRepository = () => ({
  find: jest.fn(),
});

describe('CatalogueSourceRuleService', () => {
  let service: CatalogueSourceRuleService;
  let repository: jest.Mocked<Repository<CatalogueSourceRule>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogueSourceRuleService,
        {
          provide: getRepositoryToken(CatalogueSourceRule),
          useFactory: mockRepository,
        },
      ],
    }).compile();

    service = module.get<CatalogueSourceRuleService>(
      CatalogueSourceRuleService,
    );
    repository = module.get(getRepositoryToken(CatalogueSourceRule));
    repository.find.mockReset();
  });

  it('blocks hosts matched by a block rule', async () => {
    repository.find.mockResolvedValue([
      {
        id: 'rule-1',
        label: 'amazon-retailer',
        host_pattern: 'amazon.',
        match_type: 'hostname_contains',
        effect: 'block',
        score_adjustment: 0,
        enabled: true,
        notes: null,
        created_at: new Date(),
        updated_at: new Date(),
        generateId: jest.fn(),
      },
    ]);

    const evaluation = await service.evaluateUrl(
      'https://www.amazon.com/example-product',
    );

    expect(evaluation.blocked).toBe(true);
    expect(evaluation.matchedLabels).toContain('amazon-retailer');
  });

  it('applies score penalties for informational hosts', async () => {
    repository.find.mockResolvedValue([
      {
        id: 'rule-1',
        label: 'incidecoder-informational',
        host_pattern: 'incidecoder.',
        match_type: 'hostname_contains',
        effect: 'penalize',
        score_adjustment: -80,
        enabled: true,
        notes: null,
        created_at: new Date(),
        updated_at: new Date(),
        generateId: jest.fn(),
      },
    ]);

    const evaluation = await service.evaluateUrl(
      'https://incidecoder.com/products/example-product',
    );

    expect(evaluation.blocked).toBe(false);
    expect(evaluation.scoreAdjustment).toBe(-80);
  });

  it('blocks unsafe external urls before repository rules are consulted', async () => {
    repository.find.mockResolvedValue([]);

    const evaluation = await service.evaluateUrl(
      'http://127.0.0.1:3000/private-product',
    );

    expect(evaluation.blocked).toBe(true);
    expect(evaluation.matchedLabels).toContain('unsafe-external-url');
    expect(repository.find).not.toHaveBeenCalled();
  });

  it('blocks suspicious country-code .com hosts before repository rules are consulted', async () => {
    repository.find.mockResolvedValue([]);

    const evaluation = await service.evaluateUrl(
      'https://theordinary.us.com/products/azelaic-acid-suspension-10',
    );

    expect(evaluation.blocked).toBe(true);
    expect(evaluation.matchedLabels).toContain(
      'suspicious-country-code-com-host',
    );
    expect(repository.find).not.toHaveBeenCalled();
  });
});
