import { SOP_GRAPH_SCHEMA_VERSION, type SopGraph } from '../sop-graph';

/**
 * Graphs the tests validate against.
 *
 * The escalation-review flow is the worked example from
 * `docs/tasks/phase-2-sop-graph-requirements.md`, transcribed as an actual
 * graph. It is here rather than in a single test because it is the realistic
 * target: login, a cardinality decision, nested decisions, a derived value, a
 * conditional sub-path, an optional extraction beside required ones, a
 * cross-system consistency check, three manual-review paths, and a final
 * outcome whose payload includes a value only some runs produce.
 *
 * Terminal steps sit at the end of the array. Only decisions branch explicitly;
 * everything else falls through to the next step in order, so keeping the
 * terminals together makes the fall-through path readable top to bottom.
 */
export function escalationReviewGraph(): SopGraph {
  return {
    schemaVersion: SOP_GRAPH_SCHEMA_VERSION,
    title: 'Service request escalation review',
    description: 'Review an open service request and decide whether it is a stale escalation.',
    entryStepId: 'open_portal',
    inputs: [
      { id: 'userId', label: 'Login ID', type: 'string', required: true, minLength: 1 },
      { id: 'password', label: 'Password', type: 'secret', required: true },
      {
        id: 'requestNumber',
        label: 'Request number',
        type: 'string',
        required: true,
        minLength: 1,
        example: 'SR-1001',
      },
      { id: 'reportingStartDate', label: 'Reporting start date', type: 'date', required: true },
      { id: 'reportingEndDate', label: 'Reporting end date', type: 'date', required: true },
      {
        id: 'staleDaysThreshold',
        label: 'Days without update before a request is considered stale',
        type: 'number',
        required: true,
        default: 5,
        min: 1,
        max: 90,
      },
    ],
    outputs: [
      { name: 'status', label: 'Status' },
      { name: 'priority', label: 'Priority' },
      { name: 'assignedTeam', label: 'Assigned team' },
      { name: 'teamManagerName', label: 'Team manager' },
      { name: 'teamManagerEmail', label: 'Team manager email' },
      { name: 'onCallEngineer', label: 'On-call engineer' },
      { name: 'isStaleEscalation', label: 'Stale escalation' },
    ],
    steps: [
      {
        id: 'open_portal',
        kind: 'navigate',
        urlHint: 'https://service-portal.example.com/login',
        purpose: 'Open the service request portal sign-in page',
      },
      {
        id: 'enter_login_id',
        kind: 'fill',
        fieldHint: 'Login ID',
        value: '${inputs.userId}',
        purpose: 'Provide the login ID',
      },
      {
        id: 'enter_password',
        kind: 'fill',
        fieldHint: 'Password',
        value: '${inputs.password}',
        sensitive: true,
        purpose: 'Provide the portal password at run time',
      },
      { id: 'sign_in', kind: 'click', targetHint: 'Sign in', purpose: 'Sign in to the portal' },
      {
        id: 'check_password_expired',
        kind: 'decision',
        question: 'Does the portal show a password-expired notice?',
        branches: [
          { when: 'password expired', nextStepId: 'credential_expired' },
          { when: 'signed in normally', nextStepId: 'open_advanced_search' },
        ],
      },
      {
        id: 'open_advanced_search',
        kind: 'click',
        targetHint: 'Advanced Search',
        purpose: 'Open the advanced search form',
      },
      {
        id: 'enter_request_number',
        kind: 'fill',
        fieldHint: 'Request Number',
        value: '${inputs.requestNumber}',
        purpose: 'Provide the request number for advanced search',
      },
      {
        id: 'enter_date_from',
        kind: 'fill',
        fieldHint: 'Date From',
        value: '${inputs.reportingStartDate}',
        purpose: 'Limit the search to the reporting period',
      },
      {
        id: 'enter_date_to',
        kind: 'fill',
        fieldHint: 'Date To',
        value: '${inputs.reportingEndDate}',
        purpose: 'Limit the search to the reporting period',
      },
      { id: 'run_search', kind: 'click', targetHint: 'Search', purpose: 'Run the advanced search' },
      {
        id: 'check_result_count',
        kind: 'decision',
        question: 'How many matching service requests were returned?',
        branches: [
          { when: 'no results', nextStepId: 'not_found' },
          { when: 'more than one result', nextStepId: 'ambiguous_request_number' },
          { when: 'exactly one result', nextStepId: 'open_request' },
        ],
      },
      {
        id: 'open_request',
        kind: 'click',
        targetHint: 'The matching request',
        purpose: 'Open the matching service request',
      },
      {
        id: 'extract_request_details',
        kind: 'extract',
        fields: [
          { name: 'status', labelHint: 'Status', required: true },
          { name: 'priority', labelHint: 'Priority', required: true },
          { name: 'assignedTeam', labelHint: 'Assigned Team', required: true },
          { name: 'openedDate', labelHint: 'Opened Date', required: true },
          { name: 'lastUpdatedDate', labelHint: 'Last Updated Date', required: true },
        ],
        purpose: 'Extract request details',
      },
      {
        id: 'check_closed',
        kind: 'decision',
        question: 'Is the request closed?',
        usesVariables: ['status'],
        branches: [
          { when: 'closed', nextStepId: 'closed_no_review' },
          { when: 'still open', nextStepId: 'decide_stale_escalation' },
        ],
      },
      {
        id: 'decide_stale_escalation',
        kind: 'decision',
        question: 'Decide whether this is a stale escalation',
        usesInputs: ['staleDaysThreshold'],
        usesVariables: ['priority', 'lastUpdatedDate'],
        produces: [{ name: 'isStaleEscalation', type: 'boolean' }],
        branches: [
          { when: 'stale escalation', nextStepId: 'open_team_directory' },
          { when: 'not a stale escalation', nextStepId: 'open_team_directory' },
        ],
      },
      {
        id: 'open_team_directory',
        kind: 'navigate',
        urlHint: 'https://directory.example.com/teams',
        purpose: 'Open the team directory system',
      },
      {
        id: 'search_team_directory',
        kind: 'fill',
        fieldHint: 'Team search',
        value: '${variables.assignedTeam}',
        purpose: 'Search the team directory for the assigned team',
      },
      {
        id: 'submit_directory_search',
        kind: 'click',
        targetHint: 'Search directory',
        purpose: 'Run the directory search',
      },
      {
        id: 'check_directory_entry',
        kind: 'decision',
        question: 'Was a directory entry found for the assigned team?',
        branches: [
          { when: 'no entry found', nextStepId: 'team_unmapped' },
          { when: 'entry found', nextStepId: 'extract_directory_record' },
        ],
      },
      {
        id: 'extract_directory_record',
        kind: 'extract',
        fields: [
          { name: 'teamManagerName', labelHint: 'Manager', required: true },
          { name: 'teamManagerEmail', labelHint: 'Manager email', required: true },
          { name: 'directoryTeamName', labelHint: 'Team name', required: true },
        ],
        purpose: 'Extract the directory record for the team',
      },
      {
        id: 'check_team_name_match',
        kind: 'decision',
        question: 'Does the directory team name match the assigned team on the request?',
        usesVariables: ['assignedTeam', 'directoryTeamName'],
        branches: [
          { when: 'names do not match', nextStepId: 'team_name_mismatch' },
          { when: 'names match', nextStepId: 'check_is_stale' },
        ],
      },
      {
        id: 'check_is_stale',
        kind: 'decision',
        question: 'Decide whether this is a stale escalation needing on-call details',
        usesVariables: ['isStaleEscalation'],
        branches: [
          { when: 'not stale', nextStepId: 'completed' },
          { when: 'stale', nextStepId: 'open_on_call_schedule' },
        ],
      },
      {
        id: 'open_on_call_schedule',
        kind: 'navigate',
        urlHint: 'https://oncall.example.com/schedule',
        purpose: 'Open the on-call schedule page',
      },
      {
        id: 'search_on_call',
        kind: 'fill',
        fieldHint: 'Team lookup',
        value: '${variables.assignedTeam}',
        purpose: 'Look up the on-call engineer',
      },
      {
        id: 'extract_on_call',
        kind: 'extract',
        fields: [{ name: 'onCallEngineer', labelHint: 'Current on-call', required: false }],
        onMissing: 'continue_with_note',
        purpose: 'Collect the on-call engineer if the team is listed',
      },
      {
        id: 'completed',
        kind: 'outcome',
        outcome: 'completed',
        message: 'Escalation review complete',
        returns: [
          { name: 'status' },
          { name: 'priority' },
          { name: 'assignedTeam' },
          { name: 'openedDate' },
          { name: 'lastUpdatedDate' },
          { name: 'teamManagerName' },
          { name: 'teamManagerEmail' },
          // Produced only on the stale sub-path, so it must say it may be absent.
          { name: 'onCallEngineer', optional: true },
          { name: 'isStaleEscalation' },
        ],
      },
      {
        id: 'credential_expired',
        kind: 'manual_review',
        reason: 'credential_expired',
        message: 'The portal reports the password has expired',
        handoff: 'Route to the service desk for a credential reset',
      },
      {
        id: 'not_found',
        kind: 'outcome',
        outcome: 'not_found',
        message: 'No matching service request was found in the reporting date range',
      },
      {
        id: 'ambiguous_request_number',
        kind: 'manual_review',
        reason: 'ambiguous_request_number',
        message: 'More than one request matched, and a request number should be unique',
      },
      {
        id: 'closed_no_review',
        kind: 'outcome',
        outcome: 'closed_no_review',
        message: 'The request is closed, so no escalation review is needed',
        returns: [{ name: 'status' }, { name: 'priority' }, { name: 'assignedTeam' }],
      },
      {
        id: 'team_unmapped',
        kind: 'manual_review',
        reason: 'team_unmapped',
        message: 'The team directory has no entry for the assigned team',
      },
      {
        id: 'team_name_mismatch',
        kind: 'manual_review',
        reason: 'team_name_inconsistent',
        message: 'The assigned team on the request does not match the team directory record',
        handoff: 'Route to the service desk lead for team mapping confirmation',
      },
    ],
    assumptions: [
      {
        id: 'assumption_read_only',
        statement: 'Every step is read-only and changes nothing in any system.',
      },
      {
        id: 'assumption_session',
        statement: 'The portal session persists across the directory and on-call navigations.',
      },
    ],
    clarificationQuestions: [
      {
        id: 'question_password_expired',
        question: 'What visibly indicates a password-expired notice rather than a failed sign-in?',
        aboutStepId: 'check_password_expired',
      },
      {
        id: 'question_still_open',
        question: 'What counts as still open — any status that is not Closed, or a specific list?',
        aboutStepId: 'check_closed',
      },
    ],
    risks: [
      {
        id: 'risk_directory_access',
        statement: 'The team directory may require separate access from the portal.',
        severity: 'medium',
      },
    ],
  };
}

/** The smallest valid graph: an entry step falling through to one outcome. */
export function minimalGraph(): SopGraph {
  return {
    schemaVersion: SOP_GRAPH_SCHEMA_VERSION,
    title: 'Minimal workflow',
    entryStepId: 'open_page',
    inputs: [],
    outputs: [],
    steps: [
      {
        id: 'open_page',
        kind: 'navigate',
        urlHint: 'https://example.com/',
        purpose: 'Open the page',
      },
      { id: 'done', kind: 'outcome', outcome: 'completed', message: 'Finished' },
    ],
    assumptions: [],
    clarificationQuestions: [],
    risks: [],
  };
}

/** A deep clone, so a test can mutate a fixture without affecting another. */
export function cloneGraph(graph: SopGraph): SopGraph {
  return JSON.parse(JSON.stringify(graph)) as SopGraph;
}

/**
 * The branching demo workflow: borrow a title, or place a hold on it.
 *
 * The first graph in this repository whose decision is meant to *execute*
 * rather than only validate. It targets `apps/library-portal` (port 3020),
 * whose catalog row renders a Borrow form only when a title is available and a
 * Hold form only when it is on loan — two mutually exclusive, visually
 * distinguishable states, which is precisely what `browser.expect_one_of`
 * resolves by waiting for whichever one appears.
 *
 * Step order matters and is not incidental: the borrow path is written
 * immediately after the decision so it is the fall-through, and it ends in a
 * terminal outcome so control never runs on into the hold path below it.
 */
export function borrowOrHoldGraph(): SopGraph {
  return {
    schemaVersion: SOP_GRAPH_SCHEMA_VERSION,
    title: 'Borrow a library title, or place a hold',
    description:
      'Search the catalog for a title. Borrow it if it is available; place a hold if it is on loan.',
    entryStepId: 'open_catalog',
    inputs: [
      {
        id: 'bookIsbn',
        label: 'ISBN',
        type: 'string',
        required: true,
        minLength: 1,
        example: '978-0-13-235088-4',
      },
      {
        id: 'memberId',
        label: 'Member ID',
        type: 'string',
        required: true,
        minLength: 1,
        example: 'LIB-1001',
      },
    ],
    outputs: [
      { name: 'borrowConfirmation', label: 'Borrow confirmation' },
      { name: 'holdConfirmation', label: 'Hold confirmation' },
    ],
    steps: [
      {
        id: 'open_catalog',
        kind: 'navigate',
        urlHint: 'http://localhost:3020/catalog',
        purpose: 'Open the library catalog search page',
      },
      {
        id: 'enter_isbn',
        kind: 'fill',
        fieldHint: 'Search the catalog',
        value: '${inputs.bookIsbn}',
        purpose: 'Search for the title by its ISBN',
      },
      {
        id: 'search_catalog',
        kind: 'click',
        targetHint: 'Search',
        purpose: 'Run the catalog search',
      },
      {
        id: 'check_availability',
        kind: 'decision',
        question: 'Is the title available to borrow, or already on loan?',
        purpose: 'Decide whether to borrow the title or join the queue for it',
        branches: [
          { when: 'the title is available to borrow', nextStepId: 'enter_borrow_member_id' },
          { when: 'the title is on loan', nextStepId: 'enter_hold_member_id' },
        ],
      },
      {
        id: 'enter_borrow_member_id',
        kind: 'fill',
        fieldHint: 'Member ID to borrow',
        value: '${inputs.memberId}',
        purpose: 'Identify the member borrowing the title',
      },
      {
        id: 'borrow_title',
        kind: 'click',
        targetHint: 'Borrow',
        purpose: 'Borrow the available title',
      },
      {
        id: 'read_borrow_confirmation',
        kind: 'extract',
        fields: [
          { name: 'borrowConfirmation', labelHint: 'Borrow confirmation message', required: true },
        ],
        purpose: 'Record what the library said about the loan',
      },
      {
        id: 'borrowed',
        kind: 'outcome',
        outcome: 'borrowed',
        message: 'The title was borrowed.',
        returns: [{ name: 'borrowConfirmation' }],
      },
      {
        id: 'enter_hold_member_id',
        kind: 'fill',
        fieldHint: 'Member ID to place a hold',
        value: '${inputs.memberId}',
        purpose: 'Identify the member joining the queue',
      },
      {
        id: 'place_hold',
        kind: 'click',
        targetHint: 'Place a hold',
        purpose: 'Place a hold on the title that is out',
      },
      {
        id: 'read_hold_confirmation',
        kind: 'extract',
        fields: [
          { name: 'holdConfirmation', labelHint: 'Hold confirmation message', required: true },
        ],
        purpose: 'Record the queue position the library reported',
      },
      {
        id: 'held',
        kind: 'outcome',
        outcome: 'held',
        message: 'A hold was placed on the title.',
        returns: [{ name: 'holdConfirmation' }],
      },
    ],
    assumptions: [],
    clarificationQuestions: [],
    risks: [],
  };
}
