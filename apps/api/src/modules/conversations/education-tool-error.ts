/** Domain failures are public codes. SQL/provider exceptions must not become dialogue. */
export function educationToolError(error: unknown): { error: string; persisted: false } {
    const codes: Record<string, string> = {
        'Course or cohort unavailable': 'course_or_cohort_unavailable',
        'cohortId and studentName are required': 'enrollment_fields_required',
        'A contact is required to join the waitlist': 'waitlist_contact_required',
        'Contact unavailable': 'contact_unavailable',
        'Cohort is not available for enrollment': 'cohort_unavailable',
        'Cohort has already started': 'cohort_already_started',
        'Course is unavailable': 'course_unavailable',
        'Cohort is full': 'cohort_full',
        'Enrollment not found': 'enrollment_not_found',
        'Enrollment cohort is missing': 'enrollment_cohort_unavailable',
        'You can only cancel your own enrollments': 'enrollment_ownership_mismatch',
        'Enrollment cannot be cancelled in its current status': 'enrollment_cancellation_unavailable',
    };
    const message = error instanceof Error ? error.message : '';
    return { error: codes[message] || 'enrollment_operation_failed', persisted: false };
}
