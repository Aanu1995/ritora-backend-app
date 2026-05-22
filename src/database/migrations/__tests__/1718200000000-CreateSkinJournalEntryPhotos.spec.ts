import { QueryRunner } from 'typeorm';
import { CreateSkinJournalEntryPhotos1718200000000 } from '../1718200000000-CreateSkinJournalEntryPhotos';

describe('CreateSkinJournalEntryPhotos migration', () => {
  it('backfills legacy single-photo entries as front photos only', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new CreateSkinJournalEntryPhotos1718200000000().up(queryRunner);

    const backfillQuery = queries.find((query) =>
      query.includes('INSERT INTO "skin_journal_entry_photos"'),
    );
    expect(backfillQuery).toContain("'head_on'");
    expect(backfillQuery).not.toContain('COALESCE("angle"');
  });
});
