/**
 * The loan pipeline Meridian's underwriters work from.
 *
 * Shaped like a real loan origination system's underwriting summary rather than
 * like a fixture built to make one workflow pass: every ratio the screen shows
 * is a number a real LOS computes and displays (LTV, DTI, reserves), because a
 * workflow that had to compute them itself would be doing arithmetic Orbit
 * deliberately cannot do. What is on screen is what a rule can act on.
 *
 * The pipeline is deliberately a *matrix*, not a happy path. Each loan trips a
 * different combination of underwriting rules -- one clears everything, one is
 * over the PMI threshold only, one is over both PMI and DTI, one is in a flood
 * zone, one is self-employed with income that reads as seasonal, one is below
 * the credit floor -- so a recorded workflow run against different loans takes
 * genuinely different paths rather than the same path with different numbers.
 */

export type EmploymentType = 'w2' | 'self_employed' | 'contract' | 'retired';
export type Occupancy = 'primary' | 'second_home' | 'investment';
export type PropertyType = 'single_family' | 'condo' | 'multi_family_2_4' | 'manufactured';
export type LoanProgram = 'conventional' | 'fha' | 'va' | 'jumbo';
export type EducationStatus = 'completed' | 'enrolled' | 'none';

/**
 * FEMA flood zone designations, as they appear on a flood certificate.
 *
 * `X` is outside the mapped hazard area. Anything beginning `A` or `V` is a
 * Special Flood Hazard Area, which is what triggers the insurance requirement.
 */
export type FloodZone = 'X' | 'AE' | 'AO' | 'VE';

export type LoanStatus =
  'in_underwriting' | 'conditionally_approved' | 'approved' | 'referred_to_senior' | 'declined';

export interface Loan {
  readonly loanNumber: string;
  readonly borrowerName: string;
  readonly coBorrowerName: string | null;
  readonly firstTimeBuyer: boolean;
  readonly homebuyerEducation: EducationStatus;

  readonly employmentType: EmploymentType;
  /**
   * How the file's income analyst described the borrower's employment, in prose.
   *
   * Free text on purpose. Whether two years of returns are needed is not a
   * checkbox on any real file -- it is a judgement someone makes by reading
   * this, which is exactly the kind of condition a threshold comparison cannot
   * settle and a judged decision can.
   */
  readonly employmentNote: string;
  readonly yearsInRole: number;

  readonly propertyAddress: string;
  readonly propertyCity: string;
  readonly propertyState: string;
  readonly propertyType: PropertyType;
  readonly occupancy: Occupancy;
  readonly floodZone: FloodZone;

  readonly program: LoanProgram;
  readonly purchasePrice: number;
  readonly appraisedValue: number;
  readonly loanAmount: number;
  readonly monthlyIncome: number;
  readonly monthlyDebt: number;
  readonly creditScore: number;
  readonly reserveMonths: number;
  readonly noteRate: number;

  readonly status: LoanStatus;
  readonly submittedOn: string;
  readonly underwriter: string;
}

/**
 * The conforming loan limit for a one-unit property, 2026.
 *
 * On the screen as a labelled figure rather than hidden in a comparison, so a
 * workflow can read the threshold it is judged against instead of carrying a
 * number that silently goes stale when the FHFA publishes a new one.
 */
export const CONFORMING_LIMIT = 806_500;

export const LOANS: readonly Loan[] = [
  {
    loanNumber: 'ML-26-04471',
    borrowerName: 'Dana Okonkwo',
    coBorrowerName: null,
    firstTimeBuyer: false,
    homebuyerEducation: 'none',
    employmentType: 'w2',
    employmentNote:
      'Salaried registered nurse at St. Vincent Regional Medical Center. Base pay verified by written VOE; no bonus or overtime used in qualifying.',
    yearsInRole: 6,
    propertyAddress: '1420 Ashgrove Lane',
    propertyCity: 'Beaverton',
    propertyState: 'OR',
    propertyType: 'single_family',
    occupancy: 'primary',
    floodZone: 'X',
    program: 'conventional',
    purchasePrice: 495_000,
    appraisedValue: 500_000,
    loanAmount: 360_000,
    monthlyIncome: 11_400,
    monthlyDebt: 3_192,
    creditScore: 762,
    reserveMonths: 8,
    noteRate: 6.375,
    status: 'in_underwriting',
    submittedOn: '2026-08-24',
    underwriter: 'R. Alvarez',
  },
  {
    loanNumber: 'ML-26-04488',
    borrowerName: 'Priya Raghunathan',
    coBorrowerName: 'Sanjay Raghunathan',
    firstTimeBuyer: true,
    homebuyerEducation: 'completed',
    employmentType: 'w2',
    employmentNote:
      'Both borrowers salaried. Primary borrower is a systems engineer at Halcyon Semiconductor, 4 years; co-borrower is a public school teacher, 9 years. Standard W-2 documentation on file.',
    yearsInRole: 4,
    propertyAddress: '88 Winterberry Court',
    propertyCity: 'Hillsboro',
    propertyState: 'OR',
    propertyType: 'single_family',
    occupancy: 'primary',
    floodZone: 'X',
    program: 'conventional',
    purchasePrice: 432_000,
    appraisedValue: 430_000,
    loanAmount: 396_000,
    monthlyIncome: 12_800,
    monthlyDebt: 4_224,
    creditScore: 728,
    reserveMonths: 3,
    noteRate: 6.5,
    status: 'in_underwriting',
    submittedOn: '2026-08-26',
    underwriter: 'R. Alvarez',
  },
  {
    loanNumber: 'ML-26-04502',
    borrowerName: 'Marcus Whitfield',
    coBorrowerName: null,
    firstTimeBuyer: false,
    homebuyerEducation: 'none',
    employmentType: 'self_employed',
    employmentNote:
      'Borrower is sole member of Whitfield Grounds & Landscape LLC, operating 3 years. Income is materially seasonal — Q2 and Q3 deposits run roughly four times Q1. Most recent year shows growth over prior year but the analyst flagged the swing as unresolved on a single-year view.',
    yearsInRole: 3,
    propertyAddress: '2207 Kestrel Ridge Road',
    propertyCity: 'Bend',
    propertyState: 'OR',
    propertyType: 'single_family',
    occupancy: 'primary',
    floodZone: 'X',
    program: 'conventional',
    purchasePrice: 610_000,
    appraisedValue: 615_000,
    loanAmount: 457_500,
    monthlyIncome: 15_600,
    monthlyDebt: 5_070,
    creditScore: 744,
    reserveMonths: 11,
    noteRate: 6.625,
    status: 'in_underwriting',
    submittedOn: '2026-08-27',
    underwriter: 'T. Nakamura',
  },
  {
    loanNumber: 'ML-26-04513',
    borrowerName: 'Helena Vasquez-Byrne',
    coBorrowerName: 'Ronan Byrne',
    firstTimeBuyer: false,
    homebuyerEducation: 'none',
    employmentType: 'w2',
    employmentNote:
      'Primary borrower is a maritime logistics manager at Columbia River Freight, 12 years, salaried. Co-borrower draws a fixed public pension.',
    yearsInRole: 12,
    propertyAddress: '605 Tidewater Drive',
    propertyCity: 'Astoria',
    propertyState: 'OR',
    propertyType: 'single_family',
    occupancy: 'primary',
    floodZone: 'AE',
    program: 'conventional',
    purchasePrice: 389_000,
    appraisedValue: 392_000,
    loanAmount: 291_750,
    monthlyIncome: 10_200,
    monthlyDebt: 2_856,
    creditScore: 781,
    reserveMonths: 14,
    noteRate: 6.25,
    status: 'in_underwriting',
    submittedOn: '2026-08-28',
    underwriter: 'T. Nakamura',
  },
  {
    loanNumber: 'ML-26-04529',
    borrowerName: 'Elliot Sandoval',
    coBorrowerName: null,
    firstTimeBuyer: true,
    homebuyerEducation: 'enrolled',
    employmentType: 'contract',
    employmentNote:
      'Independent contract software developer, currently on a 14-month engagement with Alder Health Analytics. Prior engagement ended 2 months before the current one began. No guaranteed renewal in the contract.',
    yearsInRole: 2,
    propertyAddress: '317 Fremont Street, Unit 6B',
    propertyCity: 'Portland',
    propertyState: 'OR',
    propertyType: 'condo',
    occupancy: 'primary',
    floodZone: 'X',
    program: 'conventional',
    purchasePrice: 338_000,
    appraisedValue: 335_000,
    loanAmount: 318_250,
    monthlyIncome: 8_900,
    monthlyDebt: 4_183,
    creditScore: 691,
    reserveMonths: 2,
    noteRate: 6.875,
    status: 'in_underwriting',
    submittedOn: '2026-08-29',
    underwriter: 'R. Alvarez',
  },
  {
    loanNumber: 'ML-26-04534',
    borrowerName: 'Georgina Petrakis',
    coBorrowerName: null,
    firstTimeBuyer: false,
    homebuyerEducation: 'none',
    employmentType: 'w2',
    employmentNote:
      'Anaesthesiologist, hospital-employed, 9 years. Compensation is base plus a call-coverage stipend; only base was used in qualifying.',
    yearsInRole: 9,
    propertyAddress: '4 Cascadia Bluff',
    propertyCity: 'Lake Oswego',
    propertyState: 'OR',
    propertyType: 'single_family',
    occupancy: 'primary',
    floodZone: 'X',
    program: 'jumbo',
    purchasePrice: 1_240_000,
    appraisedValue: 1_250_000,
    loanAmount: 930_000,
    monthlyIncome: 34_500,
    monthlyDebt: 9_315,
    creditScore: 794,
    reserveMonths: 19,
    noteRate: 6.75,
    status: 'in_underwriting',
    submittedOn: '2026-08-30',
    underwriter: 'T. Nakamura',
  },
  {
    loanNumber: 'ML-26-04547',
    borrowerName: 'Trevor Mullane',
    coBorrowerName: null,
    firstTimeBuyer: true,
    homebuyerEducation: 'none',
    employmentType: 'w2',
    employmentNote:
      'Warehouse team lead at Rainier Distribution, 2 years. Prior employment gap of 7 months documented and explained as a relocation.',
    yearsInRole: 2,
    propertyAddress: '9912 Larkspur Avenue',
    propertyCity: 'Gresham',
    propertyState: 'OR',
    propertyType: 'single_family',
    occupancy: 'primary',
    floodZone: 'X',
    program: 'fha',
    purchasePrice: 342_000,
    appraisedValue: 340_000,
    loanAmount: 327_250,
    monthlyIncome: 6_450,
    monthlyDebt: 2_451,
    creditScore: 596,
    reserveMonths: 1,
    noteRate: 7.125,
    status: 'in_underwriting',
    submittedOn: '2026-08-31',
    underwriter: 'R. Alvarez',
  },
  {
    loanNumber: 'ML-26-04561',
    borrowerName: 'Aoife Brennan',
    coBorrowerName: null,
    firstTimeBuyer: false,
    homebuyerEducation: 'none',
    employmentType: 'retired',
    employmentNote:
      'Retired since 2023. Qualifying income is a fixed defined-benefit pension plus documented Social Security, both verified by award letters and 2 months of statements.',
    yearsInRole: 0,
    propertyAddress: '1130 Sunset Harbor Way',
    propertyCity: 'Newport',
    propertyState: 'OR',
    propertyType: 'condo',
    occupancy: 'second_home',
    floodZone: 'VE',
    program: 'conventional',
    purchasePrice: 452_000,
    appraisedValue: 448_000,
    loanAmount: 380_800,
    monthlyIncome: 9_100,
    monthlyDebt: 2_366,
    creditScore: 806,
    reserveMonths: 26,
    noteRate: 6.5,
    status: 'in_underwriting',
    submittedOn: '2026-09-01',
    underwriter: 'T. Nakamura',
  },
];

/**
 * Loan-to-value, as the LOS displays it: against the *lesser* of price and
 * appraised value, which is the rule every agency investor applies and the
 * reason an appraisal coming in low raises LTV rather than leaving it alone.
 */
export function loanToValue(loan: Loan): number {
  const basis = Math.min(loan.purchasePrice, loan.appraisedValue);
  return round(2, (loan.loanAmount / basis) * 100);
}

/** Back-end debt-to-income: all monthly obligations over gross monthly income. */
export function debtToIncome(loan: Loan): number {
  return round(2, (loan.monthlyDebt / loan.monthlyIncome) * 100);
}

export function isSpecialFloodHazardArea(zone: FloodZone): boolean {
  return zone !== 'X';
}

export function findLoan(loanNumber: string): Loan | undefined {
  const wanted = loanNumber.trim().toUpperCase();
  return LOANS.find((loan) => loan.loanNumber.toUpperCase() === wanted);
}

function round(places: number, value: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export const EMPLOYMENT_LABELS: Readonly<Record<EmploymentType, string>> = {
  w2: 'W-2 employee',
  self_employed: 'Self-employed',
  contract: 'Contract / 1099',
  retired: 'Retired',
};

export const OCCUPANCY_LABELS: Readonly<Record<Occupancy, string>> = {
  primary: 'Primary residence',
  second_home: 'Second home',
  investment: 'Investment property',
};

export const PROPERTY_LABELS: Readonly<Record<PropertyType, string>> = {
  single_family: 'Single family detached',
  condo: 'Condominium',
  multi_family_2_4: '2-4 unit',
  manufactured: 'Manufactured',
};

export const PROGRAM_LABELS: Readonly<Record<LoanProgram, string>> = {
  conventional: 'Conventional',
  fha: 'FHA',
  va: 'VA',
  jumbo: 'Jumbo',
};

export const EDUCATION_LABELS: Readonly<Record<EducationStatus, string>> = {
  completed: 'Completed',
  enrolled: 'Enrolled, not complete',
  none: 'Not enrolled',
};

export const STATUS_LABELS: Readonly<Record<LoanStatus, string>> = {
  in_underwriting: 'In underwriting',
  conditionally_approved: 'Conditionally approved',
  approved: 'Approved',
  referred_to_senior: 'Referred to senior underwriter',
  declined: 'Declined',
};
