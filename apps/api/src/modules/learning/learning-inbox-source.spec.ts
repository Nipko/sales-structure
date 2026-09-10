import { assertLearningContactsAllowed, LearningContactObjected, objectingLearningContacts } from './learning-inbox-source';

/**
 * The objection gate, without a database.
 *
 * What it reads is decided by the tenant schema in front of it: the compliance
 * tables belong to the canonical schema, but evaluation namespaces and the
 * synthetic schemas the suites build carry only what they need. The gate has to
 * behave correctly in both, and the difference between "nobody objected" and
 * "there was nowhere an objection could have been written" is exactly the kind
 * of distinction that turns into a silent permission.
 */
describe('who is allowed to keep teaching the agent', () => {
    const catalog = (over: Partial<Record<string, boolean>> = {}) =>
        ({ has_leads: true, has_opt_outs: true, has_deletions: true, ...over });

    /** Records every statement, answers the catalog probe, then the objection query. */
    const queryWith = (tables: Record<string, boolean>, objecting: string[] = []) => {
        const statements: string[] = [];
        const query = (async (sql: string, params?: any[]) => {
            statements.push(sql);
            if (sql.includes('to_regclass')) return [tables];
            void params;
            return objecting.map(contactId => ({ contact_id: contactId }));
        }) as any;
        return { query, statements };
    };

    const contact = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';

    it('asks nothing at all when there is no contact to ask about', async () => {
        const { query, statements } = queryWith(catalog(), [contact]);
        // A file import carries no contact. Probing the catalog for it would be
        // a query per turn that can only ever return the same empty answer.
        expect(await objectingLearningContacts(query, [null, undefined, ''])).toEqual([]);
        expect(statements).toEqual([]);
    });

    it('reports the contacts an objection was recorded against', async () => {
        const { query } = queryWith(catalog(), [contact]);
        expect(await objectingLearningContacts(query, [contact, other])).toEqual([contact]);
        await expect(assertLearningContactsAllowed(query, [contact])).rejects.toBeInstanceOf(LearningContactObjected);
    });

    it('names the objection rather than reusing the vocabulary of a withdrawal', async () => {
        const { query } = queryWith(catalog(), [contact]);
        // An operator reading `learning_release_source_withdrawn` would go looking
        // for a source somebody withdrew. Nobody withdrew anything here.
        await expect(assertLearningContactsAllowed(query, [contact])).rejects.toMatchObject({
            response: { error: 'learning_source_contact_objected', action: 'withdraw_source' },
        });
    });

    it('lets a contact with no objection through', async () => {
        const { query } = queryWith(catalog(), []);
        await expect(assertLearningContactsAllowed(query, [contact])).resolves.toBeUndefined();
    });

    it('does not query a table the schema does not have', async () => {
        // Referencing a missing relation would raise 42P01 and take down every
        // learning read in a schema that simply predates the compliance tables.
        const { query, statements } = queryWith(catalog({ has_leads: false }), [contact]);
        expect(await objectingLearningContacts(query, [contact])).toEqual([]);
        expect(statements).toHaveLength(1);

        const partial = queryWith(catalog({ has_deletions: false }), [contact]);
        expect(await objectingLearningContacts(partial.query, [contact])).toEqual([contact]);
        expect(partial.statements[1]).toContain('opt_out_records');
        expect(partial.statements[1]).not.toContain('deletion_requests');

        const none = queryWith(catalog({ has_opt_outs: false, has_deletions: false }), [contact]);
        expect(await objectingLearningContacts(none.query, [contact])).toEqual([]);
        expect(none.statements).toHaveLength(1);
    });

    it('excludes only the opt-out a person reviewed and rejected', async () => {
        const { query, statements } = queryWith(catalog(), []);
        await objectingLearningContacts(query, [contact]);
        // A `pending` opt-out is an unreviewed stop and still counts; only the
        // one somebody looked at and called a false positive does not.
        expect(statements[1]).toContain("COALESCE(o.status,'pending')<>'rejected'");
        // A deletion request counts from the moment it is filed: waiting for its
        // status would keep the words working for the length of the queue.
        expect(statements[1]).toMatch(/FROM deletion_requests d WHERE d\.lead_id=l\.id\)/);
    });
});
